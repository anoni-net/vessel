"""Redeeming invites, signing in and out, and the account itself.

Errors are short codes the frontend translates. A bad, expired or used invite all return the same code, so
the endpoint cannot be used to learn which codes exist.
"""

from datetime import date, timedelta
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
# The onion site (vessel.<onion>, #147) is plain http. Tor Browser counts .onion as secure, but other browsers that
# open onion addresses (Onion Browser on iOS among them) may not, and drop a Secure or __Host- cookie, which signs
# the person straight back out. Tor already encrypts the whole connection, so there the cookie goes without Secure,
# under a name without the prefix. It is still host-only, HttpOnly and SameSite=Strict.
ONION_COOKIE = "vessel"
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


def on_onion(request: Request) -> bool:
    """nginx passes the Host the browser asked for; only the onion site's server block answers for .onion."""
    return (request.url.hostname or "").endswith(".onion")


def session_token(request: Request) -> str | None:
    return request.cookies.get(ONION_COOKIE if on_onion(request) else COOKIE)


def set_session_cookie(request: Request, response: Response, token: str) -> None:
    onion = on_onion(request)
    response.set_cookie(
        ONION_COOKIE if onion else COOKIE, token, max_age=policy.SESSION_DAYS * 86400, path="/", secure=not onion,
        httponly=True, samesite="strict",
    )


def clear_session_cookie(request: Request, response: Response) -> None:
    onion = on_onion(request)
    response.delete_cookie(ONION_COOKIE if onion else COOKIE, path="/", secure=not onion, httponly=True, samesite="strict")


def start_session(conn: psycopg.Connection, request: Request, response: Response, account_id: int) -> None:
    token = crypto.new_session_token()
    # signing in is a confirmation too, for VERIFY_MINUTES
    conn.execute(
        "INSERT INTO sessions (id_hmac, account_id, expires_at, verified_until) "
        "VALUES (%s, %s, now() + make_interval(days => %s), now() + make_interval(mins => %s))",
        (crypto.keyed_hash(load().hmac_key, token), account_id, policy.SESSION_DAYS, policy.VERIFY_MINUTES),
    )
    set_session_cookie(request, response, token)


def mark_verified(conn: psycopg.Connection, request: Request) -> None:
    """The person at this browser just confirmed it is them (app/passkeys.py, /api/account/verify)."""
    conn.execute(
        "UPDATE sessions SET verified_until = now() + make_interval(mins => %s) WHERE id_hmac = %s",
        (policy.VERIFY_MINUTES, crypto.keyed_hash(load().hmac_key, session_token(request) or "")),
    )


def extend_session(conn: psycopg.Connection, request: Request, response: Response) -> None:
    """Move the session's expiry, and the cookie's, SESSION_DAYS past today."""
    token = session_token(request)
    if not token:
        return
    conn.execute(
        "UPDATE sessions SET expires_at = now() + make_interval(days => %s) WHERE id_hmac = %s",
        (policy.SESSION_DAYS, crypto.keyed_hash(load().hmac_key, token)),
    )
    set_session_cookie(request, response, token)


def current_account(request: Request, conn: Conn) -> int:
    token = session_token(request)
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


def require_recent(request: Request, account_id: Account, conn: Conn) -> int:
    """For what someone holding a signed-in browser for a minute must not do on their own: adding or removing a
    passkey, and deleting the account. A new passkey would let them replace the number and lock the person out.
    Signing in counts for VERIFY_MINUTES; after that the person confirms again with a passkey or the number."""
    row = conn.execute(
        "SELECT verified_until > now() FROM sessions WHERE id_hmac = %s",
        (crypto.keyed_hash(load().hmac_key, session_token(request) or ""),),
    ).fetchone()
    if row is None or not row[0]:
        raise error(403, "verify_required")
    return account_id


Recent = Annotated[int, Depends(require_recent)]


class RedeemBody(BaseModel):
    code: str


class LoginBody(BaseModel):
    account_number: str


def setting(conn: psycopg.Connection, key: str) -> str:
    row = conn.execute("SELECT value FROM settings WHERE key = %s", (key,)).fetchone()
    return row[0] if row else ""


@router.post("/redeem", dependencies=[Depends(require_app_header), Depends(limit)])
def redeem(body: RedeemBody, request: Request, response: Response, conn: Conn) -> dict[str, str]:
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
            "SELECT id, from_account, created_by FROM invites "
            "WHERE code_hmac = %s AND redeemed_at IS NULL AND expires_at > now() FOR UPDATE",
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
        if invite[1]:
            # an account's invite: count it for the account that made it, and forget which account that was, so
            # the database never says who invited whom (app/invites.py)
            conn.execute("UPDATE accounts SET invites_used = invites_used + 1 WHERE id = %s", (invite[2],))
            conn.execute("UPDATE invites SET redeemed_at = now(), created_by = NULL WHERE id = %s", (invite[0],))
        else:
            conn.execute(
                "UPDATE invites SET redeemed_at = now(), redeemed_account = %s WHERE id = %s", (account_id, invite[0])
            )
        start_session(conn, request, response, account_id)
    return {"account_number": crypto.format_account_number(number)}


def keep_alive(conn: psycopg.Connection, account_id: int) -> None:
    """Signing in, or coming back while still signed in, keeps the account's devices for another DEVICE_DAYS."""
    conn.execute("UPDATE accounts SET last_login_on = current_date WHERE id = %s", (account_id,))
    conn.execute(
        "UPDATE devices SET expires_on = current_date + %s WHERE account_id = %s AND status <> 'revoking'",
        (policy.DEVICE_DAYS, account_id),
    )


@router.post("/login", dependencies=[Depends(require_app_header), Depends(limit)])
def login(body: LoginBody, request: Request, response: Response, conn: Conn) -> dict[str, bool]:
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
        start_session(conn, request, response, account_id)
    return {"ok": True}


@router.post("/logout", dependencies=[Depends(require_app_header)])
def logout(request: Request, response: Response, conn: Conn) -> dict[str, bool]:
    token = session_token(request)
    if token:
        conn.execute("DELETE FROM sessions WHERE id_hmac = %s", (crypto.keyed_hash(load().hmac_key, token),))
    clear_session_cookie(request, response)
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


MONTHS_KEPT = 12


@router.get("/usage/months")
def usage_months(account_id: Account, conn: Conn) -> dict:
    """The account page's monthly record: every month since the account was made, the last twelve, newest first."""
    created_on = conn.execute("SELECT created_on FROM accounts WHERE id = %s", (account_id,)).fetchone()[0]
    rows = {
        r[0]: r[1:]
        for r in conn.execute(
            "SELECT period, rx_bytes + tx_bytes, blocked, blocked_ads FROM account_usage WHERE account_id = %s",
            (account_id,),
        )
    }
    # the strongest filter on the account's devices now: the page leaves out the counts a filter never made
    strongest = conn.execute(
        "SELECT max(CASE dns_filter WHEN 'ads' THEN 2 WHEN 'malware' THEN 1 ELSE 0 END) FROM devices "
        "WHERE account_id = %s",
        (account_id,),
    ).fetchone()[0]
    months, month, first = [], date.today().replace(day=1), created_on.replace(day=1)
    while month >= first and len(months) < MONTHS_KEPT:
        used, blocked, ads = rows.get(month, (0, 0, 0))
        months.append({"month": month.isoformat(), "used_bytes": used, "blocked": blocked, "blocked_ads": ads})
        month = (month - timedelta(days=1)).replace(day=1)
    return {"filter": ("none", "malware", "ads")[strongest or 0], "months": months}


@router.delete("/account", dependencies=[Depends(require_app_header)])
def delete_account(account_id: Recent, request: Request, response: Response, conn: Conn) -> dict[str, bool]:
    with conn.transaction():
        # waits for a device being created right now, so its add is either queued below or already on the node
        conn.execute("SELECT id FROM accounts WHERE id = %s FOR UPDATE", (account_id,))
        devices = "SELECT id FROM devices WHERE account_id = %s"
        # adds still waiting to reach a node are dropped, and configs nobody fetched go with them
        conn.execute(
            f"UPDATE jobs SET status = 'done', payload = NULL, result = NULL, done_at = now(), updated_at = now() "
            f"WHERE device_id IN ({devices}) AND status = 'queued' AND action <> 'remove'",
            (account_id,),
        )
        conn.execute(f"UPDATE jobs SET result = NULL WHERE device_id IN ({devices}) AND result IS NOT NULL",
                     (account_id,))
        # the nodes still hold these peers; the worker removes them after the rows are gone. A device already
        # revoking has its remove job.
        conn.execute(
            "INSERT INTO jobs (region_id, device_id, action) "
            "SELECT region_id, id, 'remove' FROM devices WHERE account_id = %s AND status <> 'revoking'",
            (account_id,),
        )
        conn.execute("DELETE FROM accounts WHERE id = %s", (account_id,))
    clear_session_cookie(request, response)
    return {"ok": True}
