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
