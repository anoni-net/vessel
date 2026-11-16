"""The inbox: announcements maintainers wrote with `admin messages add` or a group's leaders on /group/, and notes about the account worked out from
what the portal already keeps (a report to download, a leader's request, invites to give, a slowed month, a region
moving, a group closing).

Who an announcement is for is a condition, read when the inbox is opened: every account, the accounts with a device in
a region, or a group's accounts. No row says which accounts got it. What the account has read is one number, the
newest announcement it has seen, with no time; announcements from before the account was made count as read.

A note is not kept anywhere: it is worked out each time from its source, and goes when the source does (a report
deleted, invites used up). Each has a key that changes when the note says something new; which keys were seen is kept
in the browser."""

import psycopg
from fastapi import APIRouter, Depends, Response

from app import invites
from app.auth import Account, Conn, require_app_header, setting

router = APIRouter(prefix="/api")

LOCALES = ("zh-TW", "zh-CN", "en")
TITLE_MAX = 80
BODY_MAX = 2000
LEADER_BODY_MAX = 1000
SHOWN = 50

# the announcements an account can see now; the region is checked against the devices it has today
VISIBLE = (
    "FROM messages m JOIN accounts a ON a.id = %s WHERE m.expires_on >= current_date "
    "AND (m.group_code IS NULL OR m.group_code = a.group_code) "
    "AND (m.region_id IS NULL OR EXISTS (SELECT 1 FROM devices d WHERE d.account_id = a.id "
    "AND d.region_id = m.region_id AND d.status <> 'revoking'))"
)
UNREAD = "m.id > a.messages_read AND m.created_at >= a.created_on"


def notes(conn: psycopg.Connection, account_id: int) -> list[dict]:
    """What the account may want to know about its own devices and invites, only ever its own: a member's inspection
    shows in the member's inbox, never in a leader's."""
    found: list[dict] = []
    for device_id, name, until in conn.execute(
        "SELECT d.id, d.name, i.report_until FROM device_inspections i JOIN devices d ON d.id = i.device_id "
        "WHERE d.account_id = %s AND i.status = 'ended' AND i.report_until >= current_date ORDER BY d.created_on, d.id",
        (account_id,),
    ):
        found.append({"key": f"report:{device_id}:{until}", "kind": "report", "device": device_id, "name": name,
                      "until": until.isoformat()})
    for device_id, name, requested_on, until in conn.execute(
        "SELECT d.id, d.name, g.requested_on, g.until FROM group_inspections g JOIN devices d ON d.id = g.device_id "
        "WHERE d.account_id = %s AND g.status = 'requested' AND g.until >= current_date AND d.status = 'active' "
        "ORDER BY d.created_on, d.id",
        (account_id,),
    ):
        found.append({"key": f"inspect_request:{device_id}:{requested_on}", "kind": "inspect_request",
                      "device": device_id, "name": name, "until": until.isoformat()})
    for region, until, names in conn.execute(
        "SELECT d.region_id, r.previous_until, array_agg(d.name ORDER BY d.created_on, d.id) FROM devices d "
        "JOIN regions r ON r.id = d.region_id WHERE d.account_id = %s AND d.moved AND r.previous_until IS NOT NULL "
        "AND d.status IN ('active', 'suspended') GROUP BY d.region_id, r.previous_until ORDER BY d.region_id",
        (account_id,),
    ):
        found.append({"key": f"moved:{region}:{until}", "kind": "moved", "region": region, "names": names,
                      "until": until.isoformat()})
    throttled = conn.execute(
        "SELECT to_char(current_date, 'YYYY-MM'), (date_trunc('month', current_date) + interval '1 month')::date "
        "WHERE EXISTS (SELECT 1 FROM devices WHERE account_id = %s AND throttled AND status <> 'revoking')",
        (account_id,),
    ).fetchone()
    if throttled:
        found.append({"key": f"throttled:{throttled[0]}", "kind": "throttled", "until": throttled[1].isoformat()})
    closing = conn.execute(
        "SELECT g.closing_on FROM accounts a JOIN groups g ON g.code = a.group_code "
        "WHERE a.id = %s AND g.closing_on IS NOT NULL",
        (account_id,),
    ).fetchone()
    if closing:
        found.append({"key": f"group_closing:{closing[0]}", "kind": "group_closing", "until": closing[0].isoformat()})
    # most accounts: invites are off for every account, and the rest of the reckoning is not needed
    if int(setting(conn, "user_invites") or 0) > 0:
        state = invites.allowance(conn, account_id)
        if state["reason"] is None and state["left"] > 0:
            # seen once, it stays seen until the maintainers give each account more
            found.append({"key": f"invites:{state['per_account']}", "kind": "invites", "left": state["left"]})
    return found


def unread(conn: psycopg.Connection, account_id: int) -> int:
    return conn.execute(f"SELECT count(*) {VISIBLE} AND {UNREAD}", (account_id,)).fetchone()[0]


def summary(conn: psycopg.Connection, account_id: int) -> dict:
    """For /api/me, which every page asks: enough for a mark beside the account's menu. The browser compares the keys
    with the ones it has seen."""
    return {"unread": unread(conn, account_id), "notes": [n["key"] for n in notes(conn, account_id)]}


@router.get("/inbox")
def inbox(account_id: Account, conn: Conn, response: Response) -> dict:
    response.headers["Cache-Control"] = "no-store"
    rows = conn.execute(
        "SELECT m.id, m.texts, m.created_at, m.expires_on, m.region_id, m.group_code IS NOT NULL, m.from_leader, "
        f"{UNREAD} {VISIBLE} ORDER BY m.id DESC LIMIT %s",
        (account_id, SHOWN),
    ).fetchall()
    return {
        "messages": [
            {"id": r[0], "texts": r[1], "created_at": r[2].isoformat(), "expires_on": r[3].isoformat(),
             "region": r[4], "group": r[5], "from_leader": r[6], "unread": r[7]}
            for r in rows
        ],
        "notes": notes(conn, account_id),
    }


@router.post("/inbox/read", dependencies=[Depends(require_app_header)])
def mark_read(account_id: Account, conn: Conn) -> dict[str, int]:
    """Everything the account can see now has been read. The number comes from here, never from the browser."""
    conn.execute(
        f"UPDATE accounts SET messages_read = greatest(messages_read, (SELECT coalesce(max(m.id), 0) {VISIBLE})) "
        "WHERE id = %s",
        (account_id, account_id),
    )
    return {"unread": 0}
