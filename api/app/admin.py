"""Maintainer commands, run on the portal host. There is no admin web UI.

  python -m app.admin invites create [--count N] [--days D]   print new invite codes, one per line
  python -m app.admin settings [KEY VALUE]                     show or change a setting
  python -m app.admin pickups [list]                           requests for an invite waiting for a decision
                                                               (toomore/anoni-net-ws#441): what each asked for
  python -m app.admin pickups approve ID [ID ...]              the number becomes an invite, good for 14 days
  python -m app.admin pickups decline ID [ID ...]              the number says declined for 14 days, then goes
  python -m app.admin stats                                    counts only, no per-account data
  python -m app.admin report [--days N]                        totals for reviewing the test (it reads the nodes
                                                               for the accounts connected in the last 24 hours),
                                                               and the daily stats of the last N days (default 14)
  python -m app.admin regions [set ID --node-host HOST (--open|--closed) [--exit-ip IP]]
                                                               list regions, or add/change one; the exit IP
                                                               is the node's public address, for /api/exit
  python -m app.admin regions move ID --node-host HOST --exit-ip IP --until YYYY-MM-DD
                                                               the region moves to a new host; its devices ask
                                                               for a new config, and the old host's exit counts
                                                               for /api/exit until the given day
                                                               (a relay of the region forwards to the old host
                                                               until its forward is changed by hand on the relay)

  python -m app.admin relays [list]                            relay routes: an entry that forwards to a region's node
  python -m app.admin relays set ID --region REGION --endpoint HOST:PORT (--open|--closed)
                                                               add or change one; the endpoint goes into the
                                                               configs of devices made through it

  python -m app.admin groups [list]                            groups: codes, settings and totals, nothing about
                                                               their people (toomore/anoni-net-ws#464)
  python -m app.admin groups create CODE --accounts N --ends-on YYYY-MM-DD [--devices N] [--quota-gb N] [--inspections N]
                                                               --accounts is how many members it can invite;
                                                               --devices and --quota-gb are per account;
                                                               --inspections is how many device inspections its
                                                               leaders can ask for at once (default 0, none)
  python -m app.admin groups set CODE [--accounts N] [--devices N] [--quota-gb N] [--inspections N] [--ends-on YYYY-MM-DD]
                                                               a new end date moves its devices' date too
  python -m app.admin groups leader-invite CODE --label ALIAS [--days D]
                                                               print a code that makes a leader's account; the same
                                                               alias again replaces a code not used yet

  python -m app.admin groups remove-leader CODE --label ALIAS --confirm ALIAS
                                                               delete a leader's account and devices, for a leader
                                                               who left or is no longer trusted
  python -m app.admin groups close CODE [--until YYYY-MM-DD]   stop new invites, void unused ones, and on that day
                                                               (default in 30 days) delete its accounts and devices
  python -m app.admin groups close CODE --now --confirm CODE   the same today, with no time to move elsewhere
  python -m app.admin groups close CODE --cancel               it goes on; voided invites do not come back

  python -m app.admin notices [list]                           notices on the status page, newest first
  python -m app.admin notices add (REGION|all) KIND [--start ISO] [--minutes N]
                                                               KIND is restart, maintenance or outage; without
                                                               --minutes it stays open until `notices end`
  python -m app.admin notices end ID [--at ISO]
  python -m app.admin notices delete ID

Settings: account_cap (0 means no cap), redeem_paused (true/false), user_invites (how many invites each account
may make, 0 turns it off; toomore/anoni-net-ws#458), monthly_quota_gb (personal accounts' monthly quota, read by the
portal and the worker within minutes; a group keeps the quota it was made with), pickup_open (true/false: whether
/pickup/ takes requests; numbers already given still work when it is false).
"""

import argparse
import re
import sys
import time
from datetime import date, timedelta

import psycopg

from app import auth, crypto, policy
from app.config import load
from app.nodes import NodeError, get_node


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="python -m app.admin")
    sub = parser.add_subparsers(dest="cmd", required=True)
    inv = sub.add_parser("invites").add_subparsers(dest="action", required=True).add_parser("create")
    inv.add_argument("--count", type=int, default=1)
    inv.add_argument("--days", type=int, default=policy.INVITE_DAYS)
    st = sub.add_parser("settings")
    st.add_argument("key", nargs="?")
    st.add_argument("value", nargs="?")
    pk = sub.add_parser("pickups").add_subparsers(dest="action")
    pk.add_parser("list")
    for name in ("approve", "decline"):
        pk.add_parser(name).add_argument("ids", type=int, nargs="+")
    sub.add_parser("stats")
    rp = sub.add_parser("report")
    rp.add_argument("--days", type=int, default=14)
    rg = sub.add_parser("regions")
    rg_sub = rg.add_subparsers(dest="action")
    rs = rg_sub.add_parser("set")
    rs.add_argument("id")
    rs.add_argument("--node-host", required=True)
    state = rs.add_mutually_exclusive_group(required=True)
    state.add_argument("--open", dest="is_open", action="store_true")
    state.add_argument("--closed", dest="is_open", action="store_false")
    rs.add_argument("--exit-ip")
    # a region moving to a new host: devices made before now ask for a new config, the old host goes away after --until
    rm = rg_sub.add_parser("move")
    rm.add_argument("id")
    rm.add_argument("--node-host", required=True)
    rm.add_argument("--exit-ip", required=True)
    rm.add_argument("--until", required=True, type=date.fromisoformat)
    rl = sub.add_parser("relays").add_subparsers(dest="action")
    rl.add_parser("list")
    rls = rl.add_parser("set")
    rls.add_argument("id")
    rls.add_argument("--region", required=True)
    rls.add_argument("--endpoint", required=True)
    rstate = rls.add_mutually_exclusive_group(required=True)
    rstate.add_argument("--open", dest="is_open", action="store_true")
    rstate.add_argument("--closed", dest="is_open", action="store_false")
    gr = sub.add_parser("groups").add_subparsers(dest="action")
    gr.add_parser("list")
    gc = gr.add_parser("create")
    gc.add_argument("code")
    gc.add_argument("--accounts", type=int, required=True)
    gc.add_argument("--ends-on", type=date.fromisoformat, required=True)
    gc.add_argument("--devices", type=int, default=policy.DEVICE_LIMIT)
    gc.add_argument("--quota-gb", type=int, help="per account; personal accounts' quota if left out")
    gc.add_argument("--inspections", type=int, default=0, help="inspections the leaders can ask for at once; 0 is none")
    gs = gr.add_parser("set")
    gs.add_argument("code")
    gs.add_argument("--accounts", type=int)
    gs.add_argument("--ends-on", type=date.fromisoformat)
    gs.add_argument("--devices", type=int)
    gs.add_argument("--quota-gb", type=int)
    gs.add_argument("--inspections", type=int)
    gi = gr.add_parser("leader-invite")
    gi.add_argument("code")
    gi.add_argument("--label", required=True)
    gi.add_argument("--days", type=int, default=policy.INVITE_DAYS)
    gm = gr.add_parser("remove-leader")
    gm.add_argument("code")
    gm.add_argument("--label", required=True)
    gm.add_argument("--confirm")
    gl = gr.add_parser("close")
    gl.add_argument("code")
    when = gl.add_mutually_exclusive_group()
    when.add_argument("--until", type=date.fromisoformat)
    when.add_argument("--now", action="store_true")
    when.add_argument("--cancel", action="store_true")
    gl.add_argument("--confirm")
    nt = sub.add_parser("notices").add_subparsers(dest="action")
    nt.add_parser("list")
    na = nt.add_parser("add")
    na.add_argument("region")
    na.add_argument("kind", choices=["restart", "maintenance", "outage"])
    na.add_argument("--start")
    na.add_argument("--minutes", type=int)
    ne = nt.add_parser("end")
    ne.add_argument("id", type=int)
    ne.add_argument("--at")
    nt.add_parser("delete").add_argument("id", type=int)
    args = parser.parse_args(argv)

    settings = load()
    with psycopg.connect(settings.database_url) as conn:
        if args.cmd == "invites":
            for _ in range(args.count):
                code = crypto.new_invite_code()
                conn.execute(
                    "INSERT INTO invites (code_hmac, expires_at) VALUES (%s, now() + make_interval(days => %s))",
                    (crypto.keyed_hash(settings.hmac_key, crypto.normalize_invite_code(code)), args.days),
                )
                print(code)
        elif args.cmd == "settings":
            if args.key and args.value is not None:
                if args.key not in ("account_cap", "redeem_paused", "user_invites", "monthly_quota_gb", "pickup_open"):
                    sys.exit(f"unknown setting {args.key}")
                if args.key in ("redeem_paused", "pickup_open") and args.value not in ("true", "false"):
                    sys.exit(f"{args.key} is true or false")
                if args.key in ("account_cap", "user_invites", "monthly_quota_gb") and not args.value.isdigit():
                    sys.exit(f"{args.key} is a number")
                if args.key == "monthly_quota_gb" and int(args.value) <= 0:
                    sys.exit("monthly_quota_gb must be above zero")
                conn.execute("UPDATE settings SET value = %s WHERE key = %s", (args.value, args.key))
            for key, value in conn.execute("SELECT key, value FROM settings ORDER BY key"):
                print(f"{key} = {value}")
        elif args.cmd == "regions":
            if args.action == "set":
                # leaving out --exit-ip keeps the one already set
                conn.execute(
                    "INSERT INTO regions (id, node_host, is_open, exit_ip) VALUES (%s, %s, %s, %s) "
                    "ON CONFLICT (id) DO UPDATE SET node_host = EXCLUDED.node_host, is_open = EXCLUDED.is_open, "
                    "exit_ip = coalesce(EXCLUDED.exit_ip, regions.exit_ip)",
                    (args.id, args.node_host, args.is_open, args.exit_ip),
                )
            elif args.action == "move":
                with conn.transaction():
                    moved = conn.execute(
                        "UPDATE regions SET previous_exit_ip = exit_ip, previous_until = %s, node_host = %s, "
                        "exit_ip = %s WHERE id = %s RETURNING id",
                        (args.until, args.node_host, args.exit_ip, args.id),
                    ).fetchone()
                    if moved is None:
                        raise SystemExit(f"no region {args.id}")
                    # a device made through a relay keeps the relay's address: once the relay forwards to the new
                    # host, its config works as it is
                    n = conn.execute(
                        "UPDATE devices SET moved = true WHERE region_id = %s AND NOT moved AND relay_id IS NULL",
                        (args.id,),
                    ).rowcount
                print(f"{args.id}: {n} devices asked for a new config, the old host until {args.until}")
                # a relay forwards to the node's public address, set on the relay itself, outside this repo
                for (rid,) in conn.execute("SELECT id FROM relays WHERE region_id = %s ORDER BY id", (args.id,)):
                    print(f"relay {rid} forwards to {args.id}: point its forward at {args.exit_ip} by hand")
            for rid, host, is_open, exit_ip, prev, until in conn.execute(
                "SELECT id, node_host, is_open, exit_ip, previous_exit_ip, previous_until FROM regions ORDER BY id"
            ):
                line = f"{rid}  {host}  {'open' if is_open else 'closed'}  exit {exit_ip or '-'}"
                print(line + (f"  previous {prev} until {until}" if prev and until else ""))
        elif args.cmd == "pickups":
            pickups(conn, args)
        elif args.cmd == "stats":
            queries = {
                "accounts": "SELECT count(*) FROM accounts",
                "invites unused": "SELECT count(*) FROM invites WHERE redeemed_at IS NULL AND expires_at > now()",
                "invites redeemed": "SELECT count(*) FROM invites WHERE redeemed_at IS NOT NULL",
                "invites expired": "SELECT count(*) FROM invites WHERE redeemed_at IS NULL AND expires_at <= now()",
                "devices": "SELECT count(*) FROM devices",
            }
            for label, sql in queries.items():
                print(f"{label}: {conn.execute(sql).fetchone()[0]}")
        elif args.cmd == "report":
            report(conn, args.days)
        elif args.cmd == "notices":
            notices(conn, args)
        elif args.cmd == "relays":
            relays(conn, args)
        elif args.cmd == "groups":
            groups(conn, args, settings.hmac_key)


ENDPOINT = re.compile(r"^(\[[0-9A-Fa-f:]+\]|[A-Za-z0-9.-]+):([0-9]{1,5})$")


def relays(conn: psycopg.Connection, args: argparse.Namespace) -> None:
    if args.action == "set":
        m = ENDPOINT.match(args.endpoint)
        if not m or not 0 < int(m.group(2)) < 65536:
            sys.exit(f"{args.endpoint} is not host:port")
        if not conn.execute("SELECT 1 FROM regions WHERE id = %s", (args.region,)).fetchone():
            sys.exit(f"no region {args.region}")
        conn.execute(
            "INSERT INTO relays (id, region_id, endpoint, is_open) VALUES (%s, %s, %s, %s) "
            "ON CONFLICT (id) DO UPDATE SET region_id = EXCLUDED.region_id, endpoint = EXCLUDED.endpoint, "
            "is_open = EXCLUDED.is_open",
            (args.id, args.region, args.endpoint, args.is_open),
        )
    for rid, region, endpoint, is_open in conn.execute(
        "SELECT id, region_id, endpoint, is_open FROM relays ORDER BY id"
    ):
        devices = one(conn, "SELECT count(*) FROM devices WHERE relay_id = %s AND status <> 'revoking'", (rid,))
        print(f"{rid}  -> {region}  {endpoint}  {'open' if is_open else 'closed'}  {devices} devices")


GROUP_CODE = re.compile(r"^[a-z0-9][a-z0-9-]{0,31}$")
GROUP_ENDING_DAYS = 30


def remove_leader(conn: psycopg.Connection, args: argparse.Namespace) -> None:
    """Leaders cannot remove each other from the group's page, so one under someone's control cannot lock the other out.
    Replacing a leader is the maintainer's: it deletes the account, so the alias is typed twice."""
    if args.confirm != args.label:
        sys.exit(f"this deletes the account and its devices; repeat the alias with --confirm {args.label}")
    with conn.transaction():
        row = conn.execute(
            "SELECT id FROM accounts WHERE group_code = %s AND group_label = %s AND group_role = 'leader'",
            (args.code, args.label),
        ).fetchone()
        if row is None:
            sys.exit(f"{args.code} has no leader called {args.label}")
        auth.remove_account(conn, row[0])
    left = one(conn, "SELECT count(*) FROM accounts WHERE group_code = %s AND group_role = 'leader'", (args.code,))
    print(f"{args.code}: removed {args.label}, {left} leaders left; the worker takes its devices off the nodes")
    if left == 0:
        print(f"nobody can manage {args.code} now: `groups leader-invite {args.code} --label ALIAS` for a new leader")


def close_group(conn: psycopg.Connection, args: argparse.Namespace, closing_on: date | None, ends_on: date) -> None:
    move_devices = (
        "UPDATE devices SET expires_on = %s WHERE status <> 'revoking' "
        "AND account_id IN (SELECT id FROM accounts WHERE group_code = %s)"
    )
    if args.cancel:
        if closing_on is None:
            sys.exit(f"{args.code} is not closing")
        with conn.transaction():
            conn.execute("UPDATE groups SET closing_on = NULL WHERE code = %s", (args.code,))
            conn.execute(move_devices, (ends_on, args.code))
        print(f"{args.code}: goes on until {ends_on.isoformat()}; invites voided when it was closed do not come back")
        return
    if args.now:
        # everyone in the group loses their connection within seconds: the code typed twice is the second look
        if args.confirm != args.code:
            sys.exit(f"--now deletes its accounts at once; repeat the group with --confirm {args.code}")
        day = date.today()
    else:
        day = args.until or date.today() + timedelta(days=policy.GROUP_CLOSE_DAYS)
        if day <= date.today():
            sys.exit("--until is a later day; --now closes it today")
    with conn.transaction():
        conn.execute("UPDATE groups SET closing_on = %s WHERE code = %s", (day, args.code))
        conn.execute("DELETE FROM invites WHERE group_code = %s", (args.code,))
        conn.execute(move_devices, (day, args.code))
    print(f"{args.code}: closes on {day.isoformat()}, unused invites voided; the worker deletes its accounts that day")
    print(f"when it is gone, delete {args.code}.age from the file of who each code is")


def groups(conn: psycopg.Connection, args: argparse.Namespace, hmac_key: str) -> None:
    """Totals only, for the maintainer: the aliases, device names and states belong to the group's own page."""
    for name in ("accounts", "devices", "quota_gb"):
        value = getattr(args, name, None)
        if value is not None and value <= 0:
            sys.exit(f"--{name.replace('_', '-')} must be above zero")
    if getattr(args, "inspections", None) is not None and args.inspections < 0:
        sys.exit("--inspections is 0 or more")
    state = None
    if args.action in ("set", "leader-invite", "close", "remove-leader"):
        state = conn.execute("SELECT closing_on, ends_on FROM groups WHERE code = %s", (args.code,)).fetchone()
        if state is None:
            sys.exit(f"no group {args.code}")
    if args.action == "close":
        close_group(conn, args, *state)
        return
    if args.action == "remove-leader":
        remove_leader(conn, args)
        return
    if state and state[0] and (args.action == "leader-invite" or args.ends_on):
        sys.exit(f"{args.code} closes on {state[0].isoformat()}: `groups close {args.code} --cancel` first")
    if args.action == "create":
        if not GROUP_CODE.match(args.code):
            sys.exit(f"{args.code}: a code is lowercase letters, digits and dashes, up to 32")
        if conn.execute("SELECT 1 FROM groups WHERE code = %s", (args.code,)).fetchone():
            sys.exit(f"group {args.code} already exists")
        conn.execute(
            "INSERT INTO groups (code, account_limit, device_limit, monthly_quota_bytes, ends_on, inspection_limit) "
            "VALUES (%s, %s, %s, %s, %s, %s)",
            (args.code, args.accounts, args.devices,
             args.quota_gb * 10**9 if args.quota_gb else policy.personal_quota(conn), args.ends_on, args.inspections),
        )
    elif args.action == "set":
        with conn.transaction():
            conn.execute(
                "UPDATE groups SET account_limit = coalesce(%s, account_limit), device_limit = coalesce(%s, device_limit), "
                "monthly_quota_bytes = coalesce(%s, monthly_quota_bytes), ends_on = coalesce(%s, ends_on), "
                "inspection_limit = coalesce(%s, inspection_limit) WHERE code = %s",
                (args.accounts, args.devices, args.quota_gb * 10**9 if args.quota_gb else None, args.ends_on,
                 args.inspections, args.code),
            )
            if args.ends_on:
                conn.execute(
                    "UPDATE devices SET expires_on = %s WHERE status <> 'revoking' "
                    "AND account_id IN (SELECT id FROM accounts WHERE group_code = %s)",
                    (args.ends_on, args.code),
                )
    elif args.action == "leader-invite":
        label = args.label.strip()
        if not 1 <= len(label) <= 40:
            sys.exit("--label is 1 to 40 characters")
        if args.days <= 0:
            sys.exit("--days must be above zero")
        if conn.execute("SELECT 1 FROM accounts WHERE group_code = %s AND group_label = %s", (args.code, label)).fetchone():
            sys.exit(f"{args.code} already has an account called {label}")
        code = crypto.new_invite_code()
        with conn.transaction():
            # the code itself cannot be shown again, so issuing it again replaces the one not used yet
            conn.execute("DELETE FROM invites WHERE group_code = %s AND group_label = %s", (args.code, label))
            conn.execute(
                "INSERT INTO invites (code_hmac, expires_at, group_code, group_role, group_label) "
                "VALUES (%s, now() + make_interval(days => %s), %s, 'leader', %s)",
                (crypto.keyed_hash(hmac_key, crypto.normalize_invite_code(code)), args.days, args.code, label),
            )
        print(code)
        return
    for code, account_limit, device_limit, quota, ends_on, closing_on, inspections, members, leaders, devices, used in conn.execute(
        "SELECT g.code, g.account_limit, g.device_limit, g.monthly_quota_bytes, g.ends_on, g.closing_on, g.inspection_limit, "
        "(SELECT count(*) FROM accounts a WHERE a.group_code = g.code AND a.group_role = 'member'), "
        "(SELECT count(*) FROM accounts a WHERE a.group_code = g.code AND a.group_role = 'leader'), "
        "(SELECT count(*) FROM devices d JOIN accounts a ON a.id = d.account_id "
        " WHERE a.group_code = g.code AND d.status <> 'revoking'), "
        "(SELECT coalesce(sum(u.rx_bytes + u.tx_bytes), 0) FROM account_usage u JOIN accounts a ON a.id = u.account_id "
        f" WHERE a.group_code = g.code AND u.period = {MONTH}) "
        "FROM groups g ORDER BY g.ends_on, g.code"
    ):
        left = (ends_on - date.today()).days
        note = (f"  CLOSING {closing_on.isoformat()}" if closing_on
                else "  ENDED" if left < 0 else f"  ends in {left} days" if left <= GROUP_ENDING_DAYS else "")
        print(f"{code}  members {members}/{account_limit}  leaders {leaders}  devices {devices} ({device_limit} each)  "
              f"quota {size(quota)}  this month {size(used)}  inspections {inspections}  until {ends_on.isoformat()}{note}")


def notices(conn: psycopg.Connection, args: argparse.Namespace) -> None:
    if args.action == "add":
        region = None if args.region == "all" else args.region
        start = args.start or "now"
        row = conn.execute(
            "INSERT INTO notices (region_id, kind, starts_at, ends_at) VALUES (%s, %s, %s::timestamptz, "
            "CASE WHEN %s::int IS NULL THEN NULL ELSE %s::timestamptz + make_interval(mins => %s::int) END) RETURNING id",
            (region, args.kind, start, args.minutes, start, args.minutes),
        ).fetchone()
        print(f"added notice {row[0]}")
    elif args.action == "end":
        if conn.execute(
            "UPDATE notices SET ends_at = %s::timestamptz WHERE id = %s", (args.at or "now", args.id)
        ).rowcount == 0:
            sys.exit(f"no notice {args.id}")
    elif args.action == "delete":
        conn.execute("DELETE FROM notices WHERE id = %s", (args.id,))
    for nid, region, kind, start, end in conn.execute(
        "SELECT id, region_id, kind, starts_at, ends_at FROM notices ORDER BY starts_at DESC LIMIT 20"
    ):
        until = end.isoformat(timespec="minutes") if end else "ongoing"
        print(f"{nid}  {region or 'all'}  {kind}  {start.isoformat(timespec='minutes')}  {until}")


def size(n: float) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1000:
            return f"{n:.0f} {unit}" if unit == "B" else f"{n:.1f} {unit}"
        n /= 1000
    return f"{n:.1f} TB"


def one(conn: psycopg.Connection, sql: str, params: tuple = ()) -> int:
    return conn.execute(sql, params).fetchone()[0]


def counts(conn: psycopg.Connection, sql: str) -> str:
    return ", ".join(f"{k} {v}" for k, v in conn.execute(sql).fetchall()) or "-"


MONTH = "date_trunc('month', current_date)"


def pickups(conn: psycopg.Connection, args: argparse.Namespace) -> None:
    """The requests on /pickup/ waiting for a decision, oldest first, and deciding them (app/pickups.py). Deciding deletes
    what the person wrote: once decided there is nothing left to read."""
    if args.action in ("approve", "decline"):
        state = "approved" if args.action == "approve" else "declined"
        with conn.transaction():
            done = [r[0] for r in conn.execute(
                "UPDATE invites SET pickup_state = %s, expires_at = now() + make_interval(days => %s) "
                "WHERE id = ANY(%s) AND pickup_state = 'waiting' AND expires_at > now() RETURNING id",
                (state, policy.PICKUP_KEEP_DAYS, args.ids),
            ).fetchall()]
            conn.execute("DELETE FROM pickup_requests WHERE invite_id = ANY(%s)", (done,))
        missed = sorted(set(args.ids) - set(done))
        print(f"{state}: {' '.join(map(str, sorted(done))) or '-'}"
              + (f"; not waiting (decided already, run out, or no such request): {' '.join(map(str, missed))}" if missed else ""))
        return
    rows = conn.execute(
        "SELECT i.id, i.created_at::date, r.purpose, r.network, r.note FROM invites i "
        "JOIN pickup_requests r ON r.invite_id = i.id WHERE i.pickup_state = 'waiting' AND i.expires_at > now() "
        "ORDER BY i.id"
    ).fetchall()
    for rid, day, purpose, network, note in rows:
        print(f"{rid}  {day.isoformat()}  {purpose:11}  {network:11}  {note}")
    print(f"{len(rows)} waiting; requests {'open' if auth.setting(conn, 'pickup_open') == 'true' else 'closed'}")


def connected_lately(conn: psycopg.Connection, seconds: int = 86400) -> tuple[int, list[str]]:
    """How many accounts have a device whose last handshake, as its node tells it now, is within `seconds`; and the
    regions whose node could not be read. Read from the nodes when asked, as the worker does for the daily stats:
    no handshake time is kept for a device."""
    owner = dict(conn.execute("SELECT id, account_id FROM devices").fetchall())
    node, since, accounts, unread = get_node(), time.time() - seconds, set(), []
    for region, host in conn.execute("SELECT id, node_host FROM regions ORDER BY id").fetchall():
        try:
            peers = node.usage(host)["peers"]
        except NodeError:
            unread.append(region)
            continue
        accounts |= {owner[p["name"]] for p in peers if p["name"] in owner and p.get("latest_handshake", 0) >= since}
    return len(accounts), unread


def report(conn: psycopg.Connection, days: int) -> None:
    """Totals only, for the weekly review of the test: nothing here names or singles out an account or device."""
    accounts = one(conn, "SELECT count(*) FROM accounts")
    new = one(conn, "SELECT count(*) FROM accounts WHERE created_on > current_date - 7")
    print(f"accounts: {accounts} (new in the last 7 days: {new})")
    print("last used the portal: " + counts(
        conn,
        "SELECT CASE WHEN last_login_on > current_date - 7 THEN 'within 7 days' "
        "WHEN last_login_on > current_date - 30 THEN 'within 30 days' ELSE 'longer ago' END AS k, count(*) "
        "FROM accounts GROUP BY k ORDER BY k DESC",
    ))
    state = ("SELECT CASE WHEN redeemed_at IS NOT NULL THEN 'redeemed' WHEN expires_at <= now() THEN 'expired' "
             "ELSE 'unused' END AS k, count(*) FROM invites WHERE {} GROUP BY k ORDER BY k")
    print("invites from maintainers: " + counts(conn, state.format("NOT from_account AND pickup_state IS NULL")))
    print("invites from accounts: " + counts(conn, state.format("from_account")))
    # pickup numbers (app/pickups.py): the worker deletes those that run out, so only the ones still there
    print("pickup numbers: " + counts(
        conn,
        "SELECT CASE WHEN redeemed_at IS NOT NULL THEN 'redeemed' ELSE pickup_state END AS k, count(*) FROM invites "
        "WHERE pickup_state IS NOT NULL GROUP BY k ORDER BY k",
    ))
    made = one(conn, "SELECT count(*) FROM invites WHERE from_account")
    if made:
        redeemed = one(conn, "SELECT count(*) FROM invites WHERE from_account AND redeemed_at IS NOT NULL")
        print(f"  redeemed {redeemed} of {made} ({redeemed * 100 // made}%)")
    print(f"devices: {one(conn, 'SELECT count(*) FROM devices')}")
    for label, column in (("by region", "region_id"), ("by filter", "dns_filter"), ("by status", "status")):
        print(f"  {label}: " + counts(conn, f"SELECT {column}, count(*) FROM devices GROUP BY 1 ORDER BY 1"))
    idle = one(
        conn,
        "SELECT count(*) FROM devices d WHERE d.created_on < current_date AND d.status <> 'revoking' "
        "AND NOT EXISTS (SELECT 1 FROM device_usage u WHERE u.device_id = d.id "
        f"AND u.period = {MONTH} AND u.rx_bytes + u.tx_bytes > 0)",
    )
    print(f"devices older than a day with no traffic this month: {idle}")
    live = "status <> 'revoking'"
    ever = one(conn, f"SELECT count(*) FROM devices WHERE {live} AND connected")
    total = one(conn, f"SELECT count(*) FROM devices WHERE {live}")
    week = "created_on > current_date - 7"
    ever_new = one(conn, f"SELECT count(*) FROM devices WHERE {live} AND {week} AND connected")
    total_new = one(conn, f"SELECT count(*) FROM devices WHERE {live} AND {week}")
    print(f"devices that have connected at least once: {ever} of {total} (created in the last 7 days: {ever_new} of {total_new})")
    with_device = one(conn, f"SELECT count(DISTINCT account_id) FROM devices WHERE {live}")
    connected = one(conn, f"SELECT count(DISTINCT account_id) FROM devices WHERE {live} AND connected")
    print(f"accounts: with a device {with_device}, with a device that connected {connected}, of {accounts}")
    used = one(conn, f"SELECT count(*) FROM account_usage WHERE period = {MONTH} AND rx_bytes + tx_bytes > 0")
    recent, unread = connected_lately(conn)
    print(f"active accounts: with traffic this month {used}, connected in the last 24 hours {recent}"
          + (f" (nodes not read: {', '.join(unread)})" if unread else ""))
    rows = conn.execute(
        "SELECT d.region_id, sum(u.rx_bytes + u.tx_bytes) FROM device_usage u JOIN devices d ON d.id = u.device_id "
        f"WHERE u.period = {MONTH} GROUP BY 1 ORDER BY 1"
    ).fetchall()
    by_region = ", ".join(f"{region} {size(b)}" for region, b in rows) or "-"
    print(f"traffic this month: {by_region} (total {size(sum(b for _, b in rows))})")
    full = one(
        conn,
        "SELECT count(*) FROM account_usage u JOIN accounts a ON a.id = u.account_id "
        "LEFT JOIN groups g ON g.code = a.group_code "
        f"WHERE u.period = {MONTH} AND u.rx_bytes + u.tx_bytes >= coalesce(g.monthly_quota_bytes, %s)",
        (policy.personal_quota(conn),),
    )
    print(f"accounts at the monthly quota: {full}")
    print(f"daily, UTC, last {days} days (active: devices with a handshake that day; failing: the most devices at once"
          " whose handshakes reached the node without a connection being made):")
    print(f"  {'day':10}  {'region':6}  {'active':>6}  {'traffic':>9}  {'expired':>7}  {'failing':>7}")
    for day, region, active, rx, tx, expired, stuck in conn.execute(
        "SELECT day, region_id, active_devices, rx_bytes, tx_bytes, expired_devices, failing_devices FROM daily_stats "
        "WHERE day > current_date - %s ORDER BY day, region_id",
        (days,),
    ):
        print(f"  {day.isoformat():10}  {region:6}  {active:6}  {size(rx + tx):>9}  {expired:7}  {stuck:7}")

if __name__ == "__main__":
    main()
