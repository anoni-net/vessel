"""How the worker is doing, for deploy/health_warn.py on the host.

Served only on the API's own port (bound to 127.0.0.1); nginx forwards /api/ alone, so /internal/ cannot
be reached from outside.
"""

from fastapi import APIRouter

from app.auth import Conn

router = APIRouter()

STUCK_MINUTES = 15


@router.get("/internal/health")
def internal_health(conn: Conn) -> dict:
    ages = dict(conn.execute("SELECT name, extract(epoch FROM now() - at)::int FROM heartbeats").fetchall())
    regions = [r[0] for r in conn.execute("SELECT id FROM regions ORDER BY id").fetchall()]
    stuck = conn.execute(
        "SELECT count(*) FROM jobs WHERE status = 'queued' AND created_at < now() - make_interval(mins => %s)",
        (STUCK_MINUTES,),
    ).fetchone()[0]
    return {
        # seconds since the worker last finished a round, or since it last read each region's node
        "worker_age": ages.get("worker"),
        "usage_age": {r: ages.get(f"usage:{r}") for r in regions},
        "stuck_jobs": stuck,
    }
