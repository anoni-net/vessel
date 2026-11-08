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
# the status page shows each site that had trouble on some node in the last day, an hour to a slot
HISTORY_HOURS = 24


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
    return {"regions": regions, "notices": notices, "reach": list(reach.values()), "reach_history": history(conn)}


def history(conn) -> dict:
    """Each site that some open node could not open, or had to pass a check for, in the last HISTORY_HOURS: per region,
    one state a slot from the oldest hour to the current one, null where the node did not check (a node checks once an
    hour, at a minute of its own, so a slot can also hold none). The latest check of a slot wins."""
    now = conn.execute("SELECT now()").fetchone()[0]
    rows = conn.execute(
        "SELECT h.region_id, h.site, h.state, h.checked_at FROM reach_history h JOIN regions g ON g.id = h.region_id "
        "WHERE g.is_open AND h.checked_at > now() - make_interval(hours => %s) ORDER BY h.checked_at",
        (HISTORY_HOURS,),
    ).fetchall()
    troubled = {site for _, site, state, _ in rows if state != "ok"}
    sites: dict[str, dict[str, list]] = {}
    for region, site, state, checked_at in rows:
        if site not in troubled:
            continue
        slot = HISTORY_HOURS - 1 - int((now - checked_at).total_seconds() // 3600)
        if 0 <= slot < HISTORY_HOURS:
            sites.setdefault(site, {}).setdefault(region, [None] * HISTORY_HOURS)[slot] = state
    return {"hours": HISTORY_HOURS, "until": now.isoformat(), "sites": sites}
