"""How the worker is doing, for deploy/health_warn.py on the host.

Served only on the API's own port (bound to 127.0.0.1); nginx forwards /api/ alone, so /internal/ cannot
be reached from outside.
"""

from fastapi import APIRouter

from app import policy
from app.auth import Conn
from app.status import REACH_STALE_HOURS

router = APIRouter()

STUCK_MINUTES = 15
# An account whose devices send more than they receive is unusual: browsing, video and messages mostly come in. A
# server, seeding or a proxy for others goes the other way. Below this much sent in the month it says nothing.
UPLOAD_FLOOR = 10**9
# The hourly counts worth a notice when they rise (probe_hours, node/host/vessel-probe-watch.sh), compared over the
# last 24 hours and the 7 days before them. A count needs this many hours in those 7 days to have a usual level.
PROBE_METRICS = ("probe_packets", "handshake_sources", "handshake_china", "china", "dropped")
PROBE_USUAL_HOURS = 72


def probe_levels(conn) -> dict:
    """Per open region and count: `day`, its total over the last 24 hours that ended (None when the node has not
    counted it), and `usual`, its average per 24 hours over the 7 days before (None with too little to compare with).
    Where the region has a control (probe_controls), `control` is that host's total over the same 24 hours."""
    sums = ", ".join(
        f"sum({m}) FILTER (WHERE recent), sum({m}) FILTER (WHERE NOT recent), count({m}) FILTER (WHERE NOT recent)"
        for m in PROBE_METRICS
    )
    levels = {}
    for region, *found in conn.execute(
        # hours are named by their start: the last 24 that ended, and the 168 before them
        f"SELECT region_id, {sums} FROM (SELECT p.*, p.hour > now() - interval '25 hours' AS recent "
        "FROM probe_hours p JOIN regions r ON r.id = p.region_id WHERE r.is_open AND NOT p.control "
        "AND p.hour > now() - interval '193 hours') h "
        "GROUP BY 1 ORDER BY 1"
    ):
        day, usual = {}, {}
        for i, metric in enumerate(PROBE_METRICS):
            recent, before, hours = found[i * 3:i * 3 + 3]
            day[metric] = None if recent is None else int(recent)
            usual[metric] = round(float(before) * 24 / hours, 1) if hours >= PROBE_USUAL_HOURS else None
        levels[region] = {"day": day, "usual": usual}
    for region, *found in conn.execute(
        f"SELECT p.region_id, {', '.join(f'sum({m})' for m in PROBE_METRICS)} FROM probe_hours p "
        "JOIN regions r ON r.id = p.region_id WHERE r.is_open AND p.control AND p.hour > now() - interval '25 hours' "
        "GROUP BY 1"
    ):
        if region in levels:
            levels[region]["control"] = {m: None if v is None else int(v) for m, v in zip(PROBE_METRICS, found, strict=True)}
    return levels


def usage_flags(conn) -> dict:
    """How many accounts this month look unusual, as counts only: the maintainer looks into them on the host.
    upload: sends more than it receives, past UPLOAD_FLOOR. pace: has used a third of its quota and, at the rate so
    far this month, will use it all before the month ends. quota: has used it all, and is slowed down."""
    return dict(zip(("upload", "pace", "quota"), conn.execute(
        "WITH u AS (SELECT u.rx_bytes AS sent, u.rx_bytes + u.tx_bytes AS used, "
        "coalesce(g.monthly_quota_bytes, %s) AS quota FROM account_usage u JOIN accounts a ON a.id = u.account_id "
        "LEFT JOIN groups g ON g.code = a.group_code WHERE u.period = date_trunc('month', current_date)), "
        "m AS (SELECT greatest(extract(epoch FROM now() - date_trunc('month', now())) / 86400, 1) AS gone, "
        "extract(day FROM date_trunc('month', current_date) + interval '1 month - 1 day') AS days) "
        "SELECT count(*) FILTER (WHERE sent > used - sent AND sent >= %s), "
        "count(*) FILTER (WHERE used < quota AND used * 3 >= quota AND used * m.days / m.gone >= quota), "
        "count(*) FILTER (WHERE used >= quota) FROM u, m",
        (policy.personal_quota(conn), UPLOAD_FLOOR),
    ).fetchone(), strict=True))


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
    # each open region's exit address, and the old host's while configs made before a move still use it, for
    # health_warn.py to look up in DNS blocklists; the endpoint is reachable from the host alone
    exits = [
        {"region": region, "ip": str(ip), "previous": previous}
        for region, ip, previous in conn.execute(
            "SELECT id, exit_ip, false FROM regions WHERE is_open AND exit_ip IS NOT NULL "
            "UNION ALL SELECT id, previous_exit_ip, true FROM regions "
            "WHERE is_open AND previous_exit_ip IS NOT NULL AND previous_until >= current_date ORDER BY 1, 3"
        )
    ]
    totals = {}
    for region, name, value, since in conn.execute(
        "SELECT t.region_id, t.name, t.value, t.since FROM node_totals t JOIN regions r ON r.id = t.region_id "
        "WHERE r.is_open ORDER BY 1, 2"
    ):
        totals.setdefault(region, {"since": since, "counts": {}})["counts"][name] = value
    return {
        # seconds since the worker last finished a round, or since it last read each region's node
        "worker_age": ages.get("worker"),
        "usage_age": {r: ages.get(f"usage:{r}") for r in regions},
        "stuck_jobs": stuck,
        # seconds since the analysis host last answered, while a device inspection is running; otherwise nothing to check
        "analysis_age": ages.get("analysis") if conn.execute(
            "SELECT 1 FROM device_inspections WHERE status = 'active' LIMIT 1"
        ).fetchone() else None,
        # seconds since the analysis host's oldest list was downloaded, while a device inspection is running
        "lists_age": ages.get("inspect-lists") if conn.execute(
            "SELECT 1 FROM device_inspections WHERE status = 'active' LIMIT 1"
        ).fetchone() else None,
        # seconds since each node with a device under inspection was last seen connected to the analysis host
        "stream_age": {r[0]: ages.get(f"stream:{r[0]}") for r in conn.execute(
            "SELECT DISTINCT d.region_id FROM device_inspections i JOIN devices d ON d.id = i.device_id WHERE i.status = 'active'"
        ).fetchall()},
        # seconds since each node last checked the common sites; a node that never did is left out
        "reach_age": reach_age,
        # the sites a node cannot open while another node can, as the status page lists them
        "reach_blocked": {
            region: sorted(s for s, state in sites.items()
                           if state == "blocked" and any(o.get(s) == "ok" for r, o in states.items() if r != region))
            for region, sites in sorted(states.items())
        },
        "exits": exits,
        # accounts that look unusual this month, counts only (usage_flags)
        "usage_flags": usage_flags(conn),
        # each open node's totals since its container started, as the worker last read them (node/awgctl, node_totals)
        "node_totals": totals,
        # today's most devices at once, per open region, whose handshakes reach the node without connecting (jobs.failing)
        "failing": dict(conn.execute(
            "SELECT s.region_id, s.failing_devices FROM daily_stats s JOIN regions r ON r.id = s.region_id "
            "WHERE r.is_open AND s.day = current_date ORDER BY 1"
        ).fetchall()),
        # seconds since the end of the last hour each open node counted what reached its port from addresses that are
        # not a device's; a node never read is left out. A region's control is `<region>-control`
        "probe_age": dict(conn.execute(
            "SELECT p.region_id || CASE WHEN p.control THEN '-control' ELSE '' END, "
            "extract(epoch FROM now() - max(p.hour) - interval '1 hour')::int FROM probe_hours p "
            "JOIN regions r ON r.id = p.region_id WHERE r.is_open GROUP BY 1 ORDER BY 1"
        ).fetchall()),
        # those counts over the last 24 hours, next to their usual level (probe_levels)
        "probe": probe_levels(conn),
    }
