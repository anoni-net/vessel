"""Invites an account makes for people it knows (toomore/anoni-net-ws#458).

Who invited whom is not kept. While an invite is unused it remembers the account that made it, so the account
page can list it and count what is left; once it is redeemed (app.auth.redeem) or expires (app.jobs), that is
forgotten and the account only keeps a count of how many were used. An account may make `user_invites` (a
setting, 0 is off) in all, from INVITE_AFTER_DAYS after it was made and once one of its devices has connected.
Expired and withdrawn invites give their place back.
"""

from datetime import date, timedelta

import psycopg
from fastapi import APIRouter, Depends

from app import crypto, policy
from app.auth import Account, Conn, error, require_app_header, setting
from app.config import load

router = APIRouter(prefix="/api")

OPEN = "created_by = %s AND redeemed_at IS NULL AND expires_at > now()"


def allowance(conn: psycopg.Connection, account_id: int) -> dict:
    per = int(setting(conn, "user_invites") or 0)
    created_on, used = conn.execute(
        "SELECT created_on, invites_used FROM accounts WHERE id = %s", (account_id,)
    ).fetchone()
    eligible_on = created_on + timedelta(days=policy.INVITE_AFTER_DAYS)
    connected = conn.execute(
        "SELECT EXISTS (SELECT 1 FROM devices WHERE account_id = %s AND connected)", (account_id,)
    ).fetchone()[0]
    rows = conn.execute(
        f"SELECT id, created_at, expires_at FROM invites WHERE {OPEN} ORDER BY created_at", (account_id,)
    ).fetchall()
    cap = int(setting(conn, "account_cap") or 0)
    full = cap > 0 and conn.execute("SELECT count(*) FROM accounts").fetchone()[0] >= cap
    # why none can be made now, the first that applies
    reason = (
        "off" if per == 0
        else "full" if full or setting(conn, "redeem_paused") == "true"
        else "too_new" if date.today() < eligible_on
        else "not_connected" if not connected
        else "none_left" if used + len(rows) >= per
        else None
    )
    return {
        "per_account": per,
        "used": used,
        "left": max(0, per - used - len(rows)),
        "reason": reason,
        "eligible_on": eligible_on.isoformat(),
        "days": policy.USER_INVITE_DAYS,
        "open": [{"id": r[0], "created_at": r[1].isoformat(), "expires_at": r[2].isoformat()} for r in rows],
    }


@router.get("/invites")
def list_invites(account_id: Account, conn: Conn) -> dict:
    return allowance(conn, account_id)


@router.post("/invites", dependencies=[Depends(require_app_header)])
def make_invite(account_id: Account, conn: Conn) -> dict:
    with conn.transaction():
        # one at a time per account, so two quick presses cannot make more than the account may
        conn.execute("SELECT 1 FROM accounts WHERE id = %s FOR UPDATE", (account_id,))
        state = allowance(conn, account_id)
        if state["reason"]:
            raise error(409, f"invites_{state['reason']}")
        code = crypto.new_invite_code()
        row = conn.execute(
            "INSERT INTO invites (code_hmac, created_by, from_account, expires_at) "
            "VALUES (%s, %s, true, now() + make_interval(days => %s)) RETURNING id, created_at, expires_at",
            (crypto.keyed_hash(load().hmac_key, crypto.normalize_invite_code(code)), account_id,
             policy.USER_INVITE_DAYS),
        ).fetchone()
    # the code exists only here: the database keeps its keyed hash
    return {"code": code, "id": row[0], "created_at": row[1].isoformat(), "expires_at": row[2].isoformat()}


@router.delete("/invites/{invite_id}", dependencies=[Depends(require_app_header)])
def withdraw_invite(invite_id: int, account_id: Account, conn: Conn) -> dict:
    """An unused invite the account no longer wants to give: it stops working and its place comes back."""
    if conn.execute(f"DELETE FROM invites WHERE id = %s AND {OPEN}", (invite_id, account_id)).rowcount == 0:
        raise error(404, "not_found")
    return allowance(conn, account_id)
