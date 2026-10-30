"""Maintainer commands, run on the portal host. There is no admin web UI.

  python -m app.admin invites create [--count N] [--days D]   print new invite codes, one per line
  python -m app.admin settings [KEY VALUE]                     show or change a setting
  python -m app.admin stats                                    counts only, no per-account data
  python -m app.admin report [--days N]                        totals for reviewing the test, and the daily
                                                               stats of the last N days (default 14)
  python -m app.admin regions [set ID --node-host HOST (--open|--closed) [--exit-ip IP]]
                                                               list regions, or add/change one; the exit IP
                                                               is the node's public address, for /api/exit
  python -m app.admin regions move ID --node-host HOST --exit-ip IP --until YYYY-MM-DD
                                                               the region moves to a new host; its devices ask
                                                               for a new config, and the old host's exit counts
                                                               for /api/exit until the given day

  python -m app.admin notices [list]                           notices on the status page, newest first
  python -m app.admin notices add (REGION|all) KIND [--start ISO] [--minutes N]
                                                               KIND is restart, maintenance or outage; without
                                                               --minutes it stays open until `notices end`
  python -m app.admin notices end ID [--at ISO]
  python -m app.admin notices delete ID

Settings: account_cap (0 means no cap), redeem_paused (true/false).
"""

import argparse
import sys
from datetime import date

import psycopg

from app import crypto, policy
from app.config import load


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="python -m app.admin")
    sub = parser.add_subparsers(dest="cmd", required=True)
    inv = sub.add_parser("invites").add_subparsers(dest="action", required=True).add_parser("create")
    inv.add_argument("--count", type=int, default=1)
    inv.add_argument("--days", type=int, default=policy.INVITE_DAYS)
    st = sub.add_parser("settings")
    st.add_argument("key", nargs="?")
    st.add_argument("value", nargs="?")
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
                if args.key not in ("account_cap", "redeem_paused"):
                    sys.exit(f"unknown setting {args.key}")
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
                    n = conn.execute(
                        "UPDATE devices SET moved = true WHERE region_id = %s AND NOT moved", (args.id,)
                    ).rowcount
                print(f"{args.id}: {n} devices asked for a new config, the old host until {args.until}")
            for rid, host, is_open, exit_ip, prev, until in conn.execute(
                "SELECT id, node_host, is_open, exit_ip, previous_exit_ip, previous_until FROM regions ORDER BY id"
            ):
                line = f"{rid}  {host}  {'open' if is_open else 'closed'}  exit {exit_ip or '-'}"
                print(line + (f"  previous {prev} until {until}" if prev and until else ""))
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
    print("invites: " + counts(
        conn,
        "SELECT CASE WHEN redeemed_at IS NOT NULL THEN 'redeemed' WHEN expires_at <= now() THEN 'expired' "
        "ELSE 'unused' END AS k, count(*) FROM invites GROUP BY k ORDER BY k",
    ))
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
    rows = conn.execute(
        "SELECT d.region_id, sum(u.rx_bytes + u.tx_bytes) FROM device_usage u JOIN devices d ON d.id = u.device_id "
        f"WHERE u.period = {MONTH} GROUP BY 1 ORDER BY 1"
    ).fetchall()
    by_region = ", ".join(f"{region} {size(b)}" for region, b in rows) or "-"
    print(f"traffic this month: {by_region} (total {size(sum(b for _, b in rows))})")
    full = one(
        conn,
        f"SELECT count(*) FROM account_usage WHERE period = {MONTH} AND rx_bytes + tx_bytes >= %s",
        (policy.MONTHLY_QUOTA_BYTES,),
    )
    print(f"accounts at the monthly quota: {full}")
    print(f"daily, UTC, last {days} days (active: devices with a handshake that day):")
    print(f"  {'day':10}  {'region':6}  {'active':>6}  {'traffic':>9}  {'expired':>7}")
    for day, region, active, rx, tx, expired in conn.execute(
        "SELECT day, region_id, active_devices, rx_bytes, tx_bytes, expired_devices FROM daily_stats "
        "WHERE day > current_date - %s ORDER BY day, region_id",
        (days,),
    ):
        print(f"  {day.isoformat():10}  {region:6}  {active:6}  {size(rx + tx):>9}  {expired:7}")

if __name__ == "__main__":
    main()
