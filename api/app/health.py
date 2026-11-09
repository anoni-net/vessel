"""How the worker is doing, for deploy/health_warn.py on the host.

Served only on the API's own port (bound to 127.0.0.1); nginx forwards /api/ alone, so /internal/ cannot
be reached from outside.
"""

from fastapi import APIRouter

from app.auth import Conn
from app.status import REACH_STALE_HOURS

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
    # each open region's latest check of common sites (node/host/vessel-reach.py), and its results while fresh
    reach_age, states = {}, {}
    for region, site, state, age in conn.execute(
        "SELECT r.region_id, r.site, r.state, extract(epoch FROM now() - r.checked_at)::int FROM reach r "
        "JOIN regions g ON g.id = r.region_id WHERE g.is_open"
    ):
        reach_age[region] = age
        if age < REACH_STALE_HOURS * 3600:
            states.setdefault(region, {})[site] = state
    return {
        # seconds since the worker last finished a round, or since it last read each region's node
        "worker_age": ages.get("worker"),
        "usage_age": {r: ages.get(f"usage:{r}") for r in regions},
        "stuck_jobs": stuck,
        # seconds since the analysis host last answered, while a device inspection is running; otherwise nothing to check
        "analysis_age": ages.get("analysis") if conn.execute(
            "SELECT 1 FROM device_inspections WHERE status = 'active' LIMIT 1"
        ).fetchone() else None,
        # seconds since each node last checked the common sites; a node that never did is left out
        "reach_age": reach_age,
        # the sites a node cannot open while another node can, as the status page lists them
        "reach_blocked": {
            region: sorted(s for s, state in sites.items()
                           if state == "blocked" and any(o.get(s) == "ok" for r, o in states.items() if r != region))
            for region, sites in sorted(states.items())
        },
    }
