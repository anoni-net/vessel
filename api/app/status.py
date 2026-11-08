"""The status page (/status/): whether the worker can still read each open region's node, the notices
maintainers wrote with `admin notices`, and which common sites each node can open (jobs.poll_reach). Public, no
session; nothing about the visitor is involved."""

from fastapi import APIRouter, Response

from app.auth import Conn

router = APIRouter(prefix="/api")

# the same limits as deploy/health_warn.py: the worker finishes a round every 10 seconds and reads the nodes
# every 5 minutes. A node not read for 20 minutes is down; a worker silent for 5 means nobody is reading the
# nodes, so their state is unknown
STALE_MINUTES = 20
WORKER_STALE_MINUTES = 5
NOTICE_DAYS = 30
# the nodes check every hour; a check older than this is from a node whose timer stopped, and is left out
REACH_STALE_HOURS = 3


@router.get("/status")
def status(conn: Conn, response: Response) -> dict:
    response.headers["Cache-Control"] = "no-store"
    ages = dict(conn.execute("SELECT name, extract(epoch FROM now() - at)::int FROM heartbeats").fetchall())
    worker_age = ages.get("worker")
    known = worker_age is not None and worker_age < WORKER_STALE_MINUTES * 60

    def state(region: str) -> str:
        if not known:
            return "unknown"
        age = ages.get(f"usage:{region}")
        return "ok" if age is not None and age < STALE_MINUTES * 60 else "down"

    regions = [{"id": r[0], "state": state(r[0])} for r in conn.execute("SELECT id FROM regions WHERE is_open ORDER BY id")]
    notices = [
        {"region": r[0], "kind": r[1], "starts_at": r[2].isoformat(), "ends_at": r[3].isoformat() if r[3] else None}
        for r in conn.execute(
            "SELECT region_id, kind, starts_at, ends_at FROM notices "
            "WHERE starts_at > now() - make_interval(days => %s) ORDER BY starts_at DESC LIMIT 20",
            (NOTICE_DAYS,),
        )
    ]
    reach: dict[str, dict] = {}
    for region, site, state, checked_at in conn.execute(
        "SELECT r.region_id, r.site, r.state, r.checked_at FROM reach r JOIN regions g ON g.id = r.region_id "
        "WHERE g.is_open AND r.checked_at > now() - make_interval(hours => %s) ORDER BY r.region_id, r.site",
        (REACH_STALE_HOURS,),
    ):
        entry = reach.setdefault(region, {"region": region, "checked_at": checked_at.isoformat(), "sites": {}})
        entry["sites"][site] = state
    return {"regions": regions, "notices": notices, "reach": list(reach.values())}
