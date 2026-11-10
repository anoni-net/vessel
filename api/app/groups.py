"""A group's page for its leaders (toomore/anoni-net-ws#464): who has places, the state of their devices, and revoking.

A leader sees aliases, device names and a state for each device. How much was used, how many lookups were blocked, the
account numbers and anything about accounts outside the group are not here. A state says something needs checking and
carries no counts."""

from datetime import timedelta
from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from app import auth, crypto, devices, jobs, policy
from app.auth import Account, Conn, Recent, error, require_app_header
from app.config import load

router = APIRouter(prefix="/api")

# an invite that is still open: it holds a place and its alias
OPEN = "redeemed_at IS NULL AND expires_at > now()"


class NewInvites(BaseModel):
    labels: Annotated[list[str], Field(min_length=1, max_length=50)]


class Member(BaseModel):
    label: str


def group_of_leader(conn, account_id: int) -> str:
    row = conn.execute(
        "SELECT group_code FROM accounts WHERE id = %s AND group_role = 'leader'", (account_id,)
    ).fetchone()
    if row is None:
        raise error(403, "not_leader")
    return row[0]


def issues_of(status: str, not_connected: bool, moved: bool, ipv6: bool | None, blocked_many: bool,
              throttled: bool = False) -> list[str]:
    """What needs checking on a device."""
    if status not in ("active", "suspended"):
        return []
    found = []
    if not_connected:
        found.append("not_connected")
    if status == "suspended":
        found.append("suspended")
    elif throttled:
        found.append("throttled")
    if moved or ipv6 is False:
        found.append("new_config")
    if blocked_many:
        found.append("blocked_many")
    return found


def devices_by_account(conn, where: str, param) -> dict[int, list[dict]]:
    by_account: dict[int, list[dict]] = {}
    for row in conn.execute(
        "SELECT d.account_id, d.id, d.name, d.region_id, d.dns_filter, d.status, d.expires_on, "
        # a device made today has not had the time to be a problem
        "d.status = 'active' AND NOT d.connected AND d.created_on < current_date, "
        "d.moved AND r.previous_until IS NOT NULL, d.ipv6, coalesce(u.blocked, 0) >= %s, d.throttled "
        "FROM devices d JOIN accounts a ON a.id = d.account_id JOIN regions r ON r.id = d.region_id "
        "LEFT JOIN device_usage u ON u.device_id = d.id AND u.period = date_trunc('month', current_date) "
        f"WHERE {where} ORDER BY d.created_on, d.id",
        (policy.GROUP_BLOCKED_ALERT, param),
    ):
        by_account.setdefault(row[0], []).append({
            "id": row[1], "name": row[2], "region": row[3], "dns_filter": row[4], "status": row[5],
            "expires_on": row[6].isoformat(), "issues": issues_of(row[5], row[7], row[8], row[9], row[10], row[11]),
        })
    return by_account


@router.get("/group/mine")
def my_view(account_id: Account, conn: Conn) -> dict:
    """What the leaders see about this account, for its own page: the same fields as an entry of /group."""
    row = conn.execute(
        "SELECT group_role, group_label, created_on FROM accounts WHERE id = %s AND group_code IS NOT NULL",
        (account_id,),
    ).fetchone()
    if row is None:
        raise error(404, "not_found")
    return {
        "label": row[1], "role": row[0], "joined_on": row[2].isoformat(),
        "devices": devices_by_account(conn, "a.id = %s", account_id).get(account_id, []),
    }


@router.get("/group")
def group(account_id: Account, conn: Conn) -> dict:
    code = group_of_leader(conn, account_id)
    account_limit, device_limit, ends_on, closing_on = conn.execute(
        "SELECT account_limit, device_limit, ends_on, closing_on FROM groups WHERE code = %s", (code,)
    ).fetchone()
    by_account = devices_by_account(conn, "a.group_code = %s", code)
    accounts = [
        {"label": r[2], "role": r[1], "joined_on": r[3].isoformat(), "devices": by_account.get(r[0], [])}
        for r in conn.execute(
            "SELECT id, group_role, group_label, created_on FROM accounts WHERE group_code = %s "
            "ORDER BY created_on, group_label",
            (code,),
        )
    ]
    invites = [
        {"id": r[0], "label": r[1], "created_at": r[2].isoformat(), "expires_at": r[3].isoformat(), "expired": r[4]}
        for r in conn.execute(
            # a leader's invite belongs to the maintainer who made it
            "SELECT id, group_label, created_at, expires_at, expires_at <= now() FROM invites "
            "WHERE group_code = %s AND group_role = 'member' AND redeemed_at IS NULL ORDER BY created_at, id",
            (code,),
        )
    ]
    members = sum(a["role"] == "member" for a in accounts)
    return {
        "code": code,
        "ends_on": ends_on.isoformat(),
        "closing_on": closing_on.isoformat() if closing_on else None,
        "account_limit": account_limit,
        "device_limit": device_limit,
        "places_left": max(0, account_limit - members - sum(not i["expired"] for i in invites)),
        "invite_days": policy.USER_INVITE_DAYS,
        "accounts": accounts,
        "invites": invites,
    }


@router.post("/group/invites", dependencies=[Depends(require_app_header)])
def make_invites(body: NewInvites, account_id: Account, conn: Conn) -> dict:
    code = group_of_leader(conn, account_id)
    labels = [label.strip() for label in body.labels]
    if any(not 1 <= len(label) <= 40 for label in labels) or len(set(labels)) != len(labels):
        raise error(400, "invalid_label")
    hmac_key = load().hmac_key
    made = []
    with conn.transaction():
        # one batch at a time per group, so two leaders at once cannot hand out more places than there are
        limit, closing_on = conn.execute(
            "SELECT account_limit, closing_on FROM groups WHERE code = %s FOR NO KEY UPDATE", (code,)
        ).fetchone()
        if closing_on:
            raise error(409, "group_closing")
        taken = conn.execute(
            f"SELECT 1 FROM accounts WHERE group_code = %s AND group_label = ANY(%s) UNION ALL "
            f"SELECT 1 FROM invites WHERE group_code = %s AND group_label = ANY(%s) AND {OPEN}",
            (code, labels, code, labels),
        ).fetchone()
        if taken:
            raise error(409, "label_in_use")
        held = conn.execute(
            "SELECT (SELECT count(*) FROM accounts WHERE group_code = %s AND group_role = 'member') + "
            f"(SELECT count(*) FROM invites WHERE group_code = %s AND group_role = 'member' AND {OPEN})",
            (code, code),
        ).fetchone()[0]
        if held + len(labels) > limit:
            raise error(409, "group_full")
        # an expired invite keeps its alias on the list until it is issued again
        conn.execute("DELETE FROM invites WHERE group_code = %s AND group_label = ANY(%s)", (code, labels))
        for label in labels:
            invite = crypto.new_invite_code()
            row = conn.execute(
                "INSERT INTO invites (code_hmac, expires_at, group_code, group_role, group_label) "
                "VALUES (%s, now() + %s, %s, 'member', %s) RETURNING id, expires_at",
                (crypto.keyed_hash(hmac_key, crypto.normalize_invite_code(invite)),
                 timedelta(days=policy.USER_INVITE_DAYS), code, label),
            ).fetchone()
            # the code exists only here: the database keeps its keyed hash
            made.append({"id": row[0], "label": label, "code": invite, "expires_at": row[1].isoformat()})
    return {"invites": made, "days": policy.USER_INVITE_DAYS}


@router.delete("/group/invites/{invite_id}", dependencies=[Depends(require_app_header)])
def withdraw_invite(invite_id: int, account_id: Account, conn: Conn) -> dict[str, bool]:
    code = group_of_leader(conn, account_id)
    gone = conn.execute(
        "DELETE FROM invites WHERE id = %s AND group_code = %s AND group_role = 'member' AND redeemed_at IS NULL",
        (invite_id, code),
    ).rowcount
    if not gone:
        raise error(404, "not_found")
    return {"ok": True}


@router.delete("/group/devices/{device_id}", dependencies=[Depends(require_app_header)])
def revoke_device(device_id: str, account_id: Account, conn: Conn) -> dict[str, bool]:
    code = group_of_leader(conn, account_id)
    with conn.transaction():
        row = conn.execute(
            "SELECT d.region_id, d.status, d.account_id FROM devices d JOIN accounts a ON a.id = d.account_id "
            "WHERE d.id = %s AND a.group_code = %s FOR UPDATE OF d",
            (device_id, code),
        ).fetchone()
        if row is None:
            raise error(404, "not_found")
        if row[1] == "revoking":
            return {"ok": True}
        job_id = devices.queue_revoke(conn, device_id, row[0])
        if row[2] != account_id:
            conn.execute("UPDATE accounts SET device_revoked_on = current_date WHERE id = %s", (row[2],))
    jobs.run_job(conn, job_id)
    return {"ok": True}


@router.post("/group/members/remove", dependencies=[Depends(require_app_header)])
def remove_member(body: Member, account_id: Recent, conn: Conn) -> dict[str, bool]:
    """Takes back a place: the account and all its devices go. It cannot be undone, so it needs a recent sign-in, and
    it is for members only: leaders watch over each other, and one cannot remove another."""
    code = group_of_leader(conn, account_id)
    with conn.transaction():
        row = conn.execute(
            "SELECT id FROM accounts WHERE group_code = %s AND group_label = %s AND group_role = 'member'",
            (code, body.label),
        ).fetchone()
        if row is None:
            raise error(404, "not_found")
        auth.remove_account(conn, row[0])
    return {"ok": True}
