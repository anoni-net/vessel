"""Work on the nodes. Each job runs inside a transaction that holds its row lock, so the API (which tries a job
right away) and the worker never run the same job twice."""

import re
import sys
from datetime import UTC, datetime, time

import psycopg
from psycopg.types.json import Jsonb

from app import auth, clientconfig
from app.nodes import NodeError, get_node

MAX_ATTEMPTS = 10
# Taking a device off the node is never given up: a deleted device that stays on the node keeps working, which matters
# most when the phone was lost or taken. These retry every ten minutes at most until the node answers; while they
# wait, /internal/health counts them as stuck.
# A speed limit is put on and taken off until the node answers, too: a device left slow after a new month, or left fast
# over the quota, would be wrong for as long as nobody noticed. poll_usage also puts back what a node lost on a restart.
UNTIL_DONE = frozenset({"remove", "suspend", "throttle", "unthrottle"})
# how often the worker compares each node's peers with the devices table (reconcile_peers)
RECONCILE_MINUTES = 60
RECONCILE_MAX = 5
# how long a finished job stays (forget_finished_jobs)
JOBS_KEEP_HOURS = 24
DEVICE_ID = re.compile(r"^d-[a-z0-9]{12}$")
# A session's keys stop working this long after its handshake (WireGuard's REJECT_AFTER_TIME, 180 s), plus a margin.
# A device whose last handshake is older than that, counted from the reading before, could not have sent any data since:
# whatever the node received from it is handshakes that did not complete (failing).
SESSION_SECONDS = 210


def failing(handshake: int, received: int, previous_read: float | None) -> bool:
    """Whether a device keeps trying to connect without getting through: since the node was last read
    (`previous_read`, epoch seconds), it received `received` bytes from the device, and the device's last handshake
    (`handshake`, 0 for never) is too old for any of them to be data. Tested with AmneziaWG: when a network drops the
    node's replies, the node still counts the device's handshakes and keeps its last handshake as it was. When the
    device's own packets are dropped the node receives nothing, and this cannot tell."""
    return previous_read is not None and received > 0 and handshake < previous_read - SESSION_SECONDS


def run_job(conn: psycopg.Connection, job_id: int) -> str:
    """Try one queued job. Returns its status afterwards: done, queued or failed."""
    with conn.transaction():
        row = conn.execute(
            "SELECT j.action, j.device_id, j.payload, j.attempts, r.node_host FROM jobs j "
            "JOIN regions r ON r.id = j.region_id WHERE j.id = %s AND j.status = 'queued' FOR UPDATE OF j SKIP LOCKED",
            (job_id,),
        ).fetchone()
        if row is None:
            status = conn.execute("SELECT status FROM jobs WHERE id = %s", (job_id,)).fetchone()
            return status[0] if status else "done"
        action, device_id, payload, attempts, host = row
        node = get_node()
        if action != "remove":
            device = conn.execute("SELECT status, throttled FROM devices WHERE id = %s", (device_id,)).fetchone()
            # an add for a device still waiting for it; a suspend or resume for a device still suspended; a throttle or
            # unthrottle for a device that still should be slow, or fast. Anything else changed meanwhile: a deleted or
            # expiring device has its remove job, and a suspend that waited past the device's resume, or a throttle
            # that waited past a new month, must not undo what came after it
            if action in ("throttle", "unthrottle"):
                stale = device is None or device[0] == "revoking" or device[1] != (action == "throttle")
            else:
                stale = device is None or device[0] != ("pending" if action == "add" else "suspended")
            if stale:
                conn.execute("UPDATE jobs SET status = 'done', payload = NULL, done_at = now(), updated_at = now() "
                             "WHERE id = %s", (job_id,))
                return "done"
        try:
            if action == "add":
                try:
                    result = node.add_pubkey(host, device_id, payload["public_key"], payload["psk"], payload["dns_filter"])
                except NodeError as e:
                    if "already exists" not in str(e):
                        raise
                    # an earlier try reached the node but its answer was lost; start the peer over
                    node.remove(host, device_id)
                    result = node.add_pubkey(host, device_id, payload["public_key"], payload["psk"], payload["dns_filter"])
                clientconfig.check(result)
                conn.execute(
                    "UPDATE devices SET status = 'active', tunnel_address = %s, ipv6 = %s WHERE id = %s AND status = 'pending'",
                    # "10.8.1.7/32, fd60:f74e:973c::7/128": the IPv4 address first, then the private IPv6 one
                    (result["interface"]["Address"].split("/")[0], ":" in result["interface"]["Address"], device_id),
                )
                conn.execute(
                    "UPDATE jobs SET status = 'done', payload = NULL, result = %s, done_at = now(), updated_at = now() "
                    "WHERE id = %s",
                    (Jsonb(result), job_id),
                )
            elif action == "suspend":
                node.suspend(host, device_id)
                conn.execute("UPDATE jobs SET status = 'done', done_at = now(), updated_at = now() WHERE id = %s", (job_id,))
            elif action in ("throttle", "unthrottle"):
                if action == "throttle":
                    node.throttle_on(host, device_id)
                else:
                    node.throttle_off(host, device_id)
                conn.execute("UPDATE jobs SET status = 'done', done_at = now(), updated_at = now() WHERE id = %s", (job_id,))
            elif action == "resume":
                node.resume(host, device_id)
                conn.execute("UPDATE devices SET status = 'active' WHERE id = %s AND status = 'suspended'", (device_id,))
                conn.execute("UPDATE jobs SET status = 'done', done_at = now(), updated_at = now() WHERE id = %s", (job_id,))
            else:
                node.remove(host, device_id)
                conn.execute("DELETE FROM devices WHERE id = %s", (device_id,))
                conn.execute(
                    "UPDATE jobs SET status = 'done', done_at = now(), updated_at = now() WHERE id = %s", (job_id,)
                )
            return "done"
        except (NodeError, KeyError, ValueError) as e:
            failed = attempts + 1 >= MAX_ATTEMPTS and action not in UNTIL_DONE
            conn.execute(
                "UPDATE jobs SET attempts = attempts + 1, last_error = %s, updated_at = now(), "
                "status = CASE WHEN %s THEN 'failed' ELSE 'queued' END, "
                "payload = CASE WHEN %s THEN NULL ELSE payload END, "
                "next_try_at = now() + make_interval(secs => least(600, 15 * power(2, attempts))) WHERE id = %s",
                (str(e)[:500], failed, failed, job_id),
            )
            return "failed" if failed else "queued"


def beat(conn: psycopg.Connection, name: str) -> None:
    """Record that `name` just happened, for /internal/health."""
    conn.execute(
        "INSERT INTO heartbeats (name, at) VALUES (%s, now()) ON CONFLICT (name) DO UPDATE SET at = EXCLUDED.at",
        (name,),
    )


def reconcile_peers(conn: psycopg.Connection) -> int:
    """Queue the removal of a node's peers that no device row knows any more, once every RECONCILE_MINUTES per
    region. A row is written before its peer is added and deleted only after the peer is removed, so a peer without
    one was left behind (a remove that ran before a late add, or one lost some other way). Peers made by hand on the
    node (names not shaped like a device id) are left alone. Returns how many removals were queued."""
    node = get_node()
    queued = 0
    due = conn.execute(
        "SELECT r.id, r.node_host FROM regions r WHERE NOT EXISTS "
        "(SELECT 1 FROM heartbeats WHERE name = 'reconcile:' || r.id AND at > now() - make_interval(mins => %s))",
        (RECONCILE_MINUTES,),
    ).fetchall()
    for region_id, host in due:
        try:
            names = [p["name"] for p in node.list_peers(host)]
        except (NodeError, KeyError, TypeError, ValueError):
            continue
        ids = [n for n in names if isinstance(n, str) and DEVICE_ID.match(n)]
        known = {r[0] for r in conn.execute("SELECT id FROM devices WHERE id = ANY(%s)", (ids,))}
        removing = {r[0] for r in conn.execute(
            "SELECT device_id FROM jobs WHERE device_id = ANY(%s) AND action = 'remove' AND status = 'queued'", (ids,)
        )}
        orphans = [n for n in ids if n not in known and n not in removing]
        # more than a few at once looks like the wrong database (a restored backup, a test one) rather than leftovers;
        # a person decides then
        if len(orphans) > max(RECONCILE_MAX, len(ids) // 4):
            print(f"reconcile: {region_id} has {len(orphans)} peers without a device, left alone", file=sys.stderr)
            orphans = []
        with conn.transaction():
            for name in orphans:
                conn.execute("INSERT INTO jobs (region_id, device_id, action) VALUES (%s, %s, 'remove')",
                             (region_id, name))
        queued += len(orphans)
        beat(conn, f"reconcile:{region_id}")
    return queued


def run_due_jobs(conn: psycopg.Connection, limit: int = 50) -> int:
    ids = [r[0] for r in conn.execute(
        "SELECT id FROM jobs WHERE status = 'queued' AND next_try_at <= now() ORDER BY id LIMIT %s", (limit,)
    )]
    return sum(run_job(conn, i) == "done" for i in ids)


def expire_devices(conn: psycopg.Connection) -> int:
    """Queue removal of devices whose account has not signed in for DEVICE_DAYS. A group's devices stay until the
    group is closed or they are revoked, even past the date they show."""
    with conn.transaction():
        rows = conn.execute(
            "UPDATE devices SET status = 'revoking' WHERE expires_on < current_date AND status <> 'revoking' "
            "AND account_id IN (SELECT id FROM accounts WHERE group_code IS NULL) RETURNING id, region_id"
        ).fetchall()
        for device_id, region_id in rows:
            conn.execute(
                "INSERT INTO jobs (region_id, device_id, action) VALUES (%s, %s, 'remove')", (region_id, device_id)
            )
            conn.execute(
                "INSERT INTO daily_stats (day, region_id, expired_devices) VALUES (current_date, %s, 1) "
                "ON CONFLICT (day, region_id) DO UPDATE SET expired_devices = daily_stats.expired_devices + 1",
                (region_id,),
            )
    return len(rows)


def close_groups(conn: psycopg.Connection) -> int:
    """On a closing group's last day: its accounts go, their peers leave the nodes through the remove jobs, then the
    group. Nothing of it stays but the daily totals, which never knew about groups (toomore/anoni-net-ws#464)."""
    due = conn.execute("SELECT code FROM groups WHERE closing_on <= current_date").fetchall()
    for (code,) in due:
        with conn.transaction():
            for (account_id,) in conn.execute("SELECT id FROM accounts WHERE group_code = %s", (code,)).fetchall():
                auth.remove_account(conn, account_id)
            conn.execute("DELETE FROM groups WHERE code = %s", (code,))
    return len(due)


def forget_expired_invites(conn: psycopg.Connection) -> None:
    """An account's invite that expired unused no longer says which account made it (app/invites.py). A pickup number
    that ran out unused, waiting, approved or declined, goes altogether, with what the person wrote (app/pickups.py)."""
    conn.execute(
        "UPDATE invites SET created_by = NULL WHERE created_by IS NOT NULL AND redeemed_at IS NULL AND expires_at <= now()"
    )
    conn.execute("DELETE FROM invites WHERE pickup_state IS NOT NULL AND redeemed_at IS NULL AND expires_at <= now()")


def clear_stale_results(conn: psycopg.Connection) -> None:
    conn.execute("UPDATE jobs SET result = NULL WHERE result IS NOT NULL AND done_at < now() - interval '1 hour'")


def forget_finished_jobs(conn: psycopg.Connection) -> None:
    """A finished job says to the second when a device was added, removed, suspended or resumed, which the rest of the
    database keeps to the day, and its error may name a node's tailnet address. Finished jobs go after JOBS_KEEP_HOURS.
    A failed add stays while its device does: the device page reads it to say the node could not add the device
    (app/devices.py, device_config)."""
    conn.execute(
        "DELETE FROM jobs WHERE status = 'done' AND coalesce(done_at, updated_at) < now() - make_interval(hours => %s)",
        (JOBS_KEEP_HOURS,),
    )
    conn.execute(
        "DELETE FROM jobs j WHERE status = 'failed' AND updated_at < now() - make_interval(hours => %s) "
        "AND (action <> 'add' OR NOT EXISTS (SELECT 1 FROM devices d WHERE d.id = j.device_id))",
        (JOBS_KEEP_HOURS,),
    )


def poll_usage(conn: psycopg.Connection) -> None:
    """Add what each peer moved since the last poll to its account's monthly usage.

    The node's counters are cumulative since its interface came up, and since the peer was last added (a
    resume or a re-add starts them over), so a change of interface_started or a counter going down means
    the current value is all new traffic.
    """
    node = get_node()
    for region_id, host in conn.execute("SELECT id, node_host FROM regions").fetchall():
        try:
            data = node.usage(host)
        except NodeError:
            continue
        started = data["interface_started"]
        row = conn.execute("SELECT extract(epoch FROM at) FROM heartbeats WHERE name = %s", (f"usage:{region_id}",)).fetchone()
        previous_read = float(row[0]) if row else None
        stuck = 0
        # the node's own totals (node/awgctl, node_totals), replaced as a whole; older nodes send none
        if isinstance(data.get("totals"), dict):
            with conn.transaction():
                conn.execute("DELETE FROM node_totals WHERE region_id = %s", (region_id,))
                for name, value in data["totals"].items():
                    if isinstance(value, int):
                        conn.execute("INSERT INTO node_totals (region_id, name, value, since) VALUES (%s, %s, %s, %s)",
                                     (region_id, name, value, started))
        # for daily_stats: today's traffic on this node, and the devices whose last handshake is today
        day_start = datetime.combine(datetime.now(UTC).date(), time.min, tzinfo=UTC).timestamp()
        day_rx = day_tx = active = 0
        for peer in data["peers"]:
            with conn.transaction():
                device = conn.execute(
                    "SELECT account_id, region_id, throttled, status FROM devices WHERE id = %s FOR UPDATE", (peer["name"],)
                ).fetchone()
                if device is None:
                    continue  # peers created outside the portal, or already deleted here
                handshake = peer.get("latest_handshake", 0)
                if device[1] == region_id and handshake >= day_start:
                    active += 1
                # a node that restarted has lost its speed limits, and one may have been left by hand: whatever the node
                # says that the device row does not, and no job is on its way to change, is put right
                if (isinstance(peer.get("throttled"), bool) and peer["throttled"] != device[2]
                        and device[3] in ("active", "suspended")
                        and not conn.execute(
                            "SELECT 1 FROM jobs WHERE device_id = %s AND action IN ('throttle', 'unthrottle') "
                            "AND status = 'queued'", (peer["name"],)).fetchone()):
                    conn.execute("INSERT INTO jobs (region_id, device_id, action) VALUES (%s, %s, %s)",
                                 (region_id, peer["name"], "throttle" if device[2] else "unthrottle"))
                if handshake > 0:
                    # yes or no only, for counting devices that never connected (admin report)
                    conn.execute("UPDATE devices SET connected = true WHERE id = %s AND NOT connected", (peer["name"],))
                prev = conn.execute(
                    "SELECT interface_started, rx_bytes, tx_bytes, blocked, blocked_ads FROM device_counters "
                    "WHERE device_id = %s",
                    (peer["name"],),
                ).fetchone()
                # lookups the malware list and the ad list blocked, counted per tunnel address on the node
                # (node/start.sh); older nodes omit them
                rx, tx = peer["rx"], peer["tx"]
                blocked, ads = peer.get("blocked", 0), peer.get("blocked_ads", 0)
                same = prev is not None and prev[0] == started
                if same and rx >= prev[1] and tx >= prev[2]:
                    d_rx, d_tx = rx - prev[1], tx - prev[2]
                else:
                    d_rx, d_tx = rx, tx
                # the blocked counter belongs to the address, so it carries on across a suspend and resume
                d_blocked = blocked - prev[3] if same and blocked >= prev[3] else blocked
                # counted against the node's previous counters only: after a restart everything is new and says nothing.
                # The device keeps the yes or no for its page (devices.failing) until it next connects.
                if same and device[1] == region_id and device[3] == "active" and failing(handshake, d_rx, previous_read):
                    stuck += 1
                    conn.execute("UPDATE devices SET failing = true WHERE id = %s AND NOT failing", (peer["name"],))
                elif previous_read is not None and handshake >= previous_read:
                    conn.execute("UPDATE devices SET failing = false WHERE id = %s AND failing", (peer["name"],))
                d_ads = ads - prev[4] if same and ads >= prev[4] else ads
                conn.execute(
                    "INSERT INTO device_counters (device_id, interface_started, rx_bytes, tx_bytes, blocked, blocked_ads) "
                    "VALUES (%s, %s, %s, %s, %s, %s) "
                    "ON CONFLICT (device_id) DO UPDATE SET interface_started = EXCLUDED.interface_started, "
                    "rx_bytes = EXCLUDED.rx_bytes, tx_bytes = EXCLUDED.tx_bytes, blocked = EXCLUDED.blocked, "
                    "blocked_ads = EXCLUDED.blocked_ads",
                    (peer["name"], started, rx, tx, blocked, ads),
                )
                if d_rx or d_tx or d_blocked or d_ads:
                    conn.execute(
                        "INSERT INTO account_usage (account_id, period, rx_bytes, tx_bytes, blocked, blocked_ads) "
                        "VALUES (%s, date_trunc('month', current_date), %s, %s, %s, %s) "
                        "ON CONFLICT (account_id, period) DO UPDATE SET "
                        "rx_bytes = account_usage.rx_bytes + EXCLUDED.rx_bytes, "
                        "tx_bytes = account_usage.tx_bytes + EXCLUDED.tx_bytes, "
                        "blocked = account_usage.blocked + EXCLUDED.blocked, "
                        "blocked_ads = account_usage.blocked_ads + EXCLUDED.blocked_ads",
                        (device[0], d_rx, d_tx, d_blocked, d_ads),
                    )
                day_rx += d_rx
                day_tx += d_tx
                if d_rx or d_tx or d_blocked or d_ads:
                    conn.execute(
                        "INSERT INTO device_usage (device_id, period, rx_bytes, tx_bytes, blocked, blocked_ads) "
                        "VALUES (%s, date_trunc('month', current_date), %s, %s, %s, %s) "
                        "ON CONFLICT (device_id, period) DO UPDATE SET "
                        "rx_bytes = device_usage.rx_bytes + EXCLUDED.rx_bytes, "
                        "tx_bytes = device_usage.tx_bytes + EXCLUDED.tx_bytes, "
                        "blocked = device_usage.blocked + EXCLUDED.blocked, "
                        "blocked_ads = device_usage.blocked_ads + EXCLUDED.blocked_ads",
                        (peer["name"], d_rx, d_tx, d_blocked, d_ads),
                    )
        # handshakes only move forward within a day, but a node restart forgets them: keep the day's highest count
        # the same for the devices that keep failing to connect: the most at one reading
        conn.execute(
            "INSERT INTO daily_stats (day, region_id, active_devices, rx_bytes, tx_bytes, failing_devices) "
            "VALUES (current_date, %s, %s, %s, %s, %s) "
            "ON CONFLICT (day, region_id) DO UPDATE SET "
            "active_devices = greatest(daily_stats.active_devices, EXCLUDED.active_devices), "
            "rx_bytes = daily_stats.rx_bytes + EXCLUDED.rx_bytes, tx_bytes = daily_stats.tx_bytes + EXCLUDED.tx_bytes, "
            "failing_devices = greatest(daily_stats.failing_devices, EXCLUDED.failing_devices)",
            (region_id, active, day_rx, day_tx, stuck),
        )
        beat(conn, f"usage:{region_id}")
    # devices show this month only; earlier months are not kept. The account's monthly totals last a year.
    conn.execute("DELETE FROM device_usage WHERE period < date_trunc('month', current_date)")
    conn.execute("DELETE FROM account_usage WHERE period < date_trunc('month', current_date) - interval '11 months'")
    conn.execute("DELETE FROM daily_stats WHERE day < current_date - 400")


def enforce_quota(conn: psycopg.Connection, quota: int) -> None:
    """Slow down the devices of accounts over this month's quota, and bring them back to full speed once a new month
    starts or the quota goes up. `quota` is for personal accounts; an account in a group has its group's. A device over
    the quota stays online at a low speed (node/awgctl, throttle): messages and maps still work. Devices suspended
    before this come back online, slowed down while still over."""
    with conn.transaction():
        usage = (
            "(SELECT coalesce(sum(rx_bytes + tx_bytes), 0) FROM account_usage u "
            "WHERE u.account_id = d.account_id AND u.period = date_trunc('month', current_date))"
        )
        allowed = (
            "coalesce((SELECT g.monthly_quota_bytes FROM accounts a JOIN groups g ON g.code = a.group_code "
            "WHERE a.id = d.account_id), %s)"
        )
        for device_id, region_id in conn.execute(
            f"UPDATE devices d SET throttled = true WHERE status IN ('active', 'suspended') AND NOT throttled "
            f"AND {usage} >= {allowed} RETURNING id, region_id",
            (quota,),
        ).fetchall():
            conn.execute("INSERT INTO jobs (region_id, device_id, action) VALUES (%s, %s, 'throttle')",
                         (region_id, device_id))
        for device_id, region_id in conn.execute(
            f"UPDATE devices d SET throttled = false WHERE throttled AND {usage} < {allowed} RETURNING id, region_id",
            (quota,),
        ).fetchall():
            conn.execute("INSERT INTO jobs (region_id, device_id, action) VALUES (%s, %s, 'unthrottle')",
                         (region_id, device_id))
        # queued after the throttle above, so a device still over comes back already slow
        for device_id, region_id in conn.execute(
            "SELECT id, region_id FROM devices d WHERE status = 'suspended' AND NOT EXISTS "
            "(SELECT 1 FROM jobs j WHERE j.device_id = d.id AND j.action = 'resume' AND j.status = 'queued')"
        ).fetchall():
            conn.execute("INSERT INTO jobs (region_id, device_id, action) VALUES (%s, %s, 'resume')",
                         (region_id, device_id))


REACH_EVERY_MINUTES = 30
REACH_KEEP_HOURS = 48
REACH_STATES = frozenset({"ok", "challenge", "blocked"})
SITE_ID = re.compile(r"^[a-z0-9]{1,32}$")


def poll_reach(conn: psycopg.Connection) -> None:
    """Read each open region's check of the sites its node can open (node/host/vessel-reach.py) into reach. The node
    checks every hour; a region read in the last half hour is skipped. A node without the check yet, or one that
    cannot be reached, keeps what was read before. Each check also goes into reach_history, kept for two days."""
    node = get_node()
    due = conn.execute(
        "SELECT r.id, r.node_host FROM regions r WHERE r.is_open AND NOT EXISTS "
        "(SELECT 1 FROM reach WHERE region_id = r.id AND fetched_at > now() - make_interval(mins => %s))",
        (REACH_EVERY_MINUTES,),
    ).fetchall()
    for region_id, host in due:
        try:
            data = node.reach(host)
            checked_at = datetime.fromisoformat(data["checked_at"])
            sites = {site: state for site, state in data["sites"].items()
                     if isinstance(site, str) and SITE_ID.match(site) and state in REACH_STATES}
        except (NodeError, KeyError, TypeError, ValueError, AttributeError):
            continue
        with conn.transaction():
            conn.execute("DELETE FROM reach WHERE region_id = %s", (region_id,))
            for site, state in sites.items():
                conn.execute("INSERT INTO reach (region_id, site, state, checked_at) VALUES (%s, %s, %s, %s)",
                             (region_id, site, state, checked_at))
                # the same check read again half an hour later is already there
                conn.execute("INSERT INTO reach_history (region_id, site, state, checked_at) VALUES (%s, %s, %s, %s) "
                             "ON CONFLICT DO NOTHING", (region_id, site, state, checked_at))
    conn.execute("DELETE FROM reach_history WHERE checked_at < now() - make_interval(hours => %s)", (REACH_KEEP_HOURS,))
