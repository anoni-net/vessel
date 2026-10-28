"""Redeeming invites, signing in and out, and the account itself.

Errors are short codes the frontend translates. A bad, expired or used invite all return the same code, so
the endpoint cannot be used to learn which codes exist.
"""

from datetime import date
from typing import Annotated

import psycopg
from fastapi import APIRouter, Depends, Header, HTTPException, Request, Response
from pydantic import BaseModel

from app import crypto, policy
from app.config import load
from app.db import get_conn
from app.ratelimit import Limiter

router = APIRouter(prefix="/api")

COOKIE = "__Host-vessel"
# per client IP, in memory only
sign_in_limiter = Limiter(limit=10, window_seconds=60)

Conn = Annotated[psycopg.Connection, Depends(get_conn)]


def error(status: int, code: str) -> HTTPException:
    return HTTPException(status_code=status, detail={"error": code})


def require_app_header(x_vessel_request: Annotated[str | None, Header()] = None) -> None:
    """Every state-changing request carries this header. Other anoni.net subdomains count as the same site,
    so SameSite cookies alone do not stop them; a custom header forces a CORS preflight they cannot pass."""
    if x_vessel_request != "1":
        raise error(403, "missing_header")


def client_key(request: Request) -> str:
    return request.headers.get("cf-connecting-ip") or (request.client.host if request.client else "-")


def limit(request: Request) -> None:
    if not sign_in_limiter.allow(client_key(request)):
        raise error(429, "too_many_attempts")


def start_session(conn: psycopg.Connection, response: Response, account_id: int) -> None:
    token = crypto.new_session_token()
    conn.execute(
        "INSERT INTO sessions (id_hmac, account_id, expires_at) VALUES (%s, %s, now() + make_interval(days => %s))",
        (crypto.keyed_hash(load().hmac_key, token), account_id, policy.SESSION_DAYS),
    )
    response.set_cookie(
        COOKIE, token, max_age=policy.SESSION_DAYS * 86400, path="/", secure=True, httponly=True, samesite="strict",
    )


def extend_session(conn: psycopg.Connection, request: Request, response: Response) -> None:
    """Move the session's expiry, and the cookie's, SESSION_DAYS past today."""
    token = request.cookies.get(COOKIE)
    if not token:
        return
    conn.execute(
        "UPDATE sessions SET expires_at = now() + make_interval(days => %s) WHERE id_hmac = %s",
        (policy.SESSION_DAYS, crypto.keyed_hash(load().hmac_key, token)),
    )
    response.set_cookie(
        COOKIE, token, max_age=policy.SESSION_DAYS * 86400, path="/", secure=True, httponly=True, samesite="strict",
    )


def current_account(request: Request, conn: Conn) -> int:
    token = request.cookies.get(COOKIE)
    if not token:
        raise error(401, "signed_out")
    row = conn.execute(
        "SELECT a.id FROM sessions s JOIN accounts a ON a.id = s.account_id "
        "WHERE s.id_hmac = %s AND s.expires_at > now() AND a.status = 'active'",
        (crypto.keyed_hash(load().hmac_key, token),),
    ).fetchone()
    if row is None:
        raise error(401, "signed_out")
    return row[0]


Account = Annotated[int, Depends(current_account)]


class RedeemBody(BaseModel):
    code: str


class LoginBody(BaseModel):
    account_number: str


def setting(conn: psycopg.Connection, key: str) -> str:
    row = conn.execute("SELECT value FROM settings WHERE key = %s", (key,)).fetchone()
    return row[0] if row else ""


@router.post("/redeem", dependencies=[Depends(require_app_header), Depends(limit)])
def redeem(body: RedeemBody, response: Response, conn: Conn) -> dict[str, str]:
    code = crypto.normalize_invite_code(body.code)
    if code is None:
        raise error(400, "invalid_invite")
    settings = load()
    with conn.transaction():
        # one redemption at a time, so the account cap holds under concurrent requests
        conn.execute("SELECT pg_advisory_xact_lock(hashtext('vessel-redeem'))")
        if setting(conn, "redeem_paused") == "true":
            raise error(503, "redeem_paused")
        cap = int(setting(conn, "account_cap") or 0)
        if cap > 0 and conn.execute("SELECT count(*) FROM accounts").fetchone()[0] >= cap:
            raise error(409, "full")
        invite = conn.execute(
            "SELECT id FROM invites WHERE code_hmac = %s AND redeemed_at IS NULL AND expires_at > now() FOR UPDATE",
            (crypto.keyed_hash(settings.hmac_key, code),),
        ).fetchone()
        if invite is None:
            raise error(400, "invalid_invite")
        while True:
            number = crypto.new_account_number()
            try:
                with conn.transaction():
                    account_id = conn.execute(
                        "INSERT INTO accounts (number_hash) VALUES (%s) RETURNING id",
                        (crypto.hash_account_number(number, settings.account_pepper),),
                    ).fetchone()[0]
                break
            except psycopg.errors.UniqueViolation:
                continue
        conn.execute(
            "UPDATE invites SET redeemed_at = now(), redeemed_account = %s WHERE id = %s", (account_id, invite[0])
        )
        start_session(conn, response, account_id)
    return {"account_number": crypto.format_account_number(number)}


def keep_alive(conn: psycopg.Connection, account_id: int) -> None:
    """Signing in, or coming back while still signed in, keeps the account's devices for another DEVICE_DAYS."""
    conn.execute("UPDATE accounts SET last_login_on = current_date WHERE id = %s", (account_id,))
    conn.execute(
        "UPDATE devices SET expires_on = current_date + %s WHERE account_id = %s AND status <> 'revoking'",
        (policy.DEVICE_DAYS, account_id),
    )


@router.post("/login", dependencies=[Depends(require_app_header), Depends(limit)])
def login(body: LoginBody, response: Response, conn: Conn) -> dict[str, bool]:
    number = crypto.normalize_account_number(body.account_number)
    if number is None:
        raise error(400, "invalid_number")
    number_hash = crypto.hash_account_number(number, load().account_pepper)
    with conn.transaction():
        row = conn.execute(
            "SELECT id FROM accounts WHERE number_hash = %s AND status = 'active'", (number_hash,)
        ).fetchone()
        if row is None:
            raise error(401, "invalid_number")
        account_id = row[0]
        keep_alive(conn, account_id)
        conn.execute("DELETE FROM sessions WHERE expires_at <= now()")
        start_session(conn, response, account_id)
    return {"ok": True}


@router.post("/logout", dependencies=[Depends(require_app_header)])
def logout(request: Request, response: Response, conn: Conn) -> dict[str, bool]:
    token = request.cookies.get(COOKIE)
    if token:
        conn.execute("DELETE FROM sessions WHERE id_hmac = %s", (crypto.keyed_hash(load().hmac_key, token),))
    response.delete_cookie(COOKIE, path="/", secure=True, httponly=True, samesite="strict")
    return {"ok": True}


@router.get("/me")
def me(account_id: Account, request: Request, response: Response, conn: Conn) -> dict:
    # every page asks this when it loads, so opening the portal while signed in counts as signing in, once a day:
    # the devices and the session both last another 30 days
    with conn.transaction():
        stale = conn.execute(
            "SELECT 1 FROM accounts WHERE id = %s AND (last_login_on IS NULL OR last_login_on < current_date)",
            (account_id,),
        ).fetchone()
        if stale:
            keep_alive(conn, account_id)
            extend_session(conn, request, response)
    created_on, last_login_on = conn.execute(
        "SELECT created_on, last_login_on FROM accounts WHERE id = %s", (account_id,)
    ).fetchone()
    period = date.today().replace(day=1)
    usage = conn.execute(
        "SELECT rx_bytes + tx_bytes FROM account_usage WHERE account_id = %s AND period = %s", (account_id, period)
    ).fetchone()
    # when the worker last read the counters of the nodes this account's devices are on; the oldest one wins
    as_of = conn.execute(
        "SELECT min(h.at) FROM heartbeats h WHERE h.name IN "
        "(SELECT 'usage:' || region_id FROM devices WHERE account_id = %s)",
        (account_id,),
    ).fetchone()[0]
    return {
        "created_on": created_on.isoformat(),
        "last_login_on": last_login_on.isoformat() if last_login_on else None,
        "device_limit": policy.DEVICE_LIMIT,
        "monthly_quota_bytes": policy.MONTHLY_QUOTA_BYTES,
        "used_bytes": usage[0] if usage else 0,
        "usage_as_of": as_of.isoformat() if as_of else None,
    }


@router.delete("/account", dependencies=[Depends(require_app_header)])
def delete_account(account_id: Account, response: Response, conn: Conn) -> dict[str, bool]:
    with conn.transaction():
        # the nodes still hold these peers; the worker removes them after the rows are gone
        conn.execute(
            "INSERT INTO jobs (region_id, device_id, action) "
            "SELECT region_id, id, 'remove' FROM devices WHERE account_id = %s",
            (account_id,),
        )
        conn.execute("DELETE FROM accounts WHERE id = %s", (account_id,))
    response.delete_cookie(COOKIE, path="/", secure=True, httponly=True, samesite="strict")
    return {"ok": True}
