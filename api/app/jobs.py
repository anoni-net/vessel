"""Work on the nodes. Each job runs inside a transaction that holds its row lock, so the API (which tries a job
right away) and the worker never run the same job twice."""

import psycopg
from psycopg.types.json import Jsonb

from app.nodes import NodeError, get_node

MAX_ATTEMPTS = 10


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
        if action in ("suspend", "resume"):
            device = conn.execute("SELECT status FROM devices WHERE id = %s", (device_id,)).fetchone()
            if device is None or device[0] == "revoking":
                # deleted or expiring meanwhile; its remove job takes care of the node
                conn.execute("UPDATE jobs SET status = 'done', done_at = now(), updated_at = now() WHERE id = %s",
                             (job_id,))
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
                conn.execute(
                    "UPDATE devices SET status = 'active', tunnel_address = %s WHERE id = %s AND status = 'pending'",
                    (result["interface"]["Address"].split("/")[0], device_id),
                )
                conn.execute(
                    "UPDATE jobs SET status = 'done', payload = NULL, result = %s, done_at = now(), updated_at = now() "
                    "WHERE id = %s",
                    (Jsonb(result), job_id),
                )
            elif action == "suspend":
                node.suspend(host, device_id)
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
            failed = attempts + 1 >= MAX_ATTEMPTS
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


def run_due_jobs(conn: psycopg.Connection, limit: int = 50) -> int:
    ids = [r[0] for r in conn.execute(
        "SELECT id FROM jobs WHERE status = 'queued' AND next_try_at <= now() ORDER BY id LIMIT %s", (limit,)
    )]
    return sum(run_job(conn, i) == "done" for i in ids)


def expire_devices(conn: psycopg.Connection) -> int:
    """Queue removal of devices whose account has not signed in for DEVICE_DAYS."""
    with conn.transaction():
        rows = conn.execute(
            "UPDATE devices SET status = 'revoking' WHERE expires_on < current_date AND status <> 'revoking' "
            "RETURNING id, region_id"
        ).fetchall()
        for device_id, region_id in rows:
            conn.execute(
                "INSERT INTO jobs (region_id, device_id, action) VALUES (%s, %s, 'remove')", (region_id, device_id)
            )
    return len(rows)


def clear_stale_results(conn: psycopg.Connection) -> None:
    conn.execute("UPDATE jobs SET result = NULL WHERE result IS NOT NULL AND done_at < now() - interval '1 hour'")


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
        for peer in data["peers"]:
            with conn.transaction():
                device = conn.execute(
                    "SELECT account_id FROM devices WHERE id = %s FOR UPDATE", (peer["name"],)
                ).fetchone()
                if device is None:
                    continue  # peers created outside the portal, or already deleted here
                prev = conn.execute(
                    "SELECT interface_started, rx_bytes, tx_bytes, blocked FROM device_counters WHERE device_id = %s",
                    (peer["name"],),
                ).fetchone()
                # blocked: malware lookups counted per tunnel address on the node (node/start.sh); older nodes omit it
                rx, tx, blocked = peer["rx"], peer["tx"], peer.get("blocked", 0)
                same = prev is not None and prev[0] == started
                if same and rx >= prev[1] and tx >= prev[2]:
                    d_rx, d_tx = rx - prev[1], tx - prev[2]
                else:
                    d_rx, d_tx = rx, tx
                # the blocked counter belongs to the address, so it carries on across a suspend and resume
                d_blocked = blocked - prev[3] if same and blocked >= prev[3] else blocked
                conn.execute(
                    "INSERT INTO device_counters (device_id, interface_started, rx_bytes, tx_bytes, blocked) "
                    "VALUES (%s, %s, %s, %s, %s) "
                    "ON CONFLICT (device_id) DO UPDATE SET interface_started = EXCLUDED.interface_started, "
                    "rx_bytes = EXCLUDED.rx_bytes, tx_bytes = EXCLUDED.tx_bytes, blocked = EXCLUDED.blocked",
                    (peer["name"], started, rx, tx, blocked),
                )
                if d_rx or d_tx:
                    conn.execute(
                        "INSERT INTO account_usage (account_id, period, rx_bytes, tx_bytes) "
                        "VALUES (%s, date_trunc('month', current_date), %s, %s) "
                        "ON CONFLICT (account_id, period) DO UPDATE SET "
                        "rx_bytes = account_usage.rx_bytes + EXCLUDED.rx_bytes, "
                        "tx_bytes = account_usage.tx_bytes + EXCLUDED.tx_bytes",
                        (device[0], d_rx, d_tx),
                    )
                if d_rx or d_tx or d_blocked:
                    conn.execute(
                        "INSERT INTO device_usage (device_id, period, rx_bytes, tx_bytes, blocked) "
                        "VALUES (%s, date_trunc('month', current_date), %s, %s, %s) "
                        "ON CONFLICT (device_id, period) DO UPDATE SET "
                        "rx_bytes = device_usage.rx_bytes + EXCLUDED.rx_bytes, "
                        "tx_bytes = device_usage.tx_bytes + EXCLUDED.tx_bytes, "
                        "blocked = device_usage.blocked + EXCLUDED.blocked",
                        (peer["name"], d_rx, d_tx, d_blocked),
                    )
        beat(conn, f"usage:{region_id}")
    # devices show this month only; earlier months are not kept
    conn.execute("DELETE FROM device_usage WHERE period < date_trunc('month', current_date)")


def enforce_quota(conn: psycopg.Connection, quota: int) -> None:
    """Suspend the devices of accounts over this month's quota, and resume them once a new month starts."""
    with conn.transaction():
        usage = (
            "(SELECT coalesce(sum(rx_bytes + tx_bytes), 0) FROM account_usage u "
            "WHERE u.account_id = d.account_id AND u.period = date_trunc('month', current_date))"
        )
        for device_id, region_id in conn.execute(
            f"UPDATE devices d SET status = 'suspended' WHERE status = 'active' AND {usage} >= %s "
            "RETURNING id, region_id",
            (quota,),
        ).fetchall():
            conn.execute("INSERT INTO jobs (region_id, device_id, action) VALUES (%s, %s, 'suspend')",
                         (region_id, device_id))
        for device_id, region_id in conn.execute(
            f"SELECT id, region_id FROM devices d WHERE status = 'suspended' AND {usage} < %s "
            "AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.device_id = d.id AND j.action = 'resume' "
            "AND j.status = 'queued')",
            (quota,),
        ).fetchall():
            conn.execute("INSERT INTO jobs (region_id, device_id, action) VALUES (%s, %s, 'resume')",
                         (region_id, device_id))
