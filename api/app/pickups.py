"""Pickup numbers (toomore/anoni-net-ws#441): asking for an invite without giving any way to be reached.

Someone picks what they would use Vessel for and the kind of network they are on, may add a short note, and gets a
number shown once. A maintainer reads the waiting requests on the host (`admin pickups`) and approves or declines them.
The person comes back with the number: once approved it is an invite like any other, redeemed on /redeem/.

The number is stored as a keyed hash in invites, with the request's state; the day it was asked for and nothing finer.
What the person wrote is kept apart and deleted when the request is decided. No IP, country or contact is kept: the
limit on requests from one address lives in memory only.
"""

from typing import Annotated

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field

from app import crypto, policy
from app.auth import Conn, client_key, error, limit, require_app_header, setting
from app.config import load
from app.ratelimit import Limiter

router = APIRouter(prefix="/api")

# per client IP, in memory only: a person asks once; a few more cover a mistake or a shared address
request_limiter = Limiter(limit=3, window_seconds=3600)
# the HTTP status for each reason taking_requests gives
STATUS = {"pickup_closed": 503, "redeem_paused": 503, "full": 409, "pickup_busy": 429}


def is_open(conn) -> bool:
    return setting(conn, "pickup_open") == "true"


def taking_requests(conn) -> str | None:
    """Why no request can be taken now, or None. Closed, paused or full apply to everyone; busy is the day's total or the
    waiting requests at their limit, so one maintainer is not handed more than can be read."""
    if not is_open(conn):
        return "pickup_closed"
    if setting(conn, "redeem_paused") == "true":
        return "redeem_paused"
    cap = int(setting(conn, "account_cap") or 0)
    if cap > 0 and conn.execute("SELECT count(*) FROM accounts WHERE group_code IS NULL").fetchone()[0] >= cap:
        return "full"
    today, waiting = conn.execute(
        "SELECT count(*) FILTER (WHERE created_at = date_trunc('day', now())), "
        "count(*) FILTER (WHERE pickup_state = 'waiting' AND expires_at > now()) "
        "FROM invites WHERE pickup_state IS NOT NULL"
    ).fetchone()
    if today >= policy.PICKUP_DAILY or waiting >= policy.PICKUP_WAITING:
        return "pickup_busy"
    return None


@router.get("/pickup")
def pickup_info(conn: Conn) -> dict:
    """Whether a request can be made now, the choices the form offers, and how many days a request waits for an
    answer: nobody is told when theirs is decided, so the page says how long they have to come back."""
    return {"open": taking_requests(conn) is None, "purposes": list(policy.PICKUP_PURPOSES),
            "networks": list(policy.PICKUP_NETWORKS), "note_max": policy.PICKUP_NOTE, "wait_days": policy.PICKUP_WAIT_DAYS}


class PickupBody(BaseModel):
    purpose: str
    network: str
    note: Annotated[str, Field(max_length=policy.PICKUP_NOTE)] = ""


@router.post("/pickup", dependencies=[Depends(require_app_header)])
def ask(body: PickupBody, request: Request, conn: Conn) -> dict:
    if body.purpose not in policy.PICKUP_PURPOSES or body.network not in policy.PICKUP_NETWORKS:
        raise error(400, "invalid_pickup")
    with conn.transaction():
        # one at a time, so the day's limit and the waiting limit hold under concurrent requests
        conn.execute("SELECT pg_advisory_xact_lock(hashtext('vessel-pickup'))")
        reason = taking_requests(conn)
        if reason:
            raise error(STATUS[reason], reason)
        # counted only for a request that could be taken, so trying while it is closed costs nothing
        if not request_limiter.allow(client_key(request)):
            raise error(429, "too_many_attempts")
        number = crypto.new_invite_code()
        invite_id = conn.execute(
            # the day only: the time of a request says nothing the maintainer needs
            "INSERT INTO invites (code_hmac, created_at, expires_at, pickup_state) "
            "VALUES (%s, date_trunc('day', now()), now() + make_interval(days => %s), 'waiting') RETURNING id",
            (crypto.keyed_hash(load().hmac_key, crypto.normalize_invite_code(number)), policy.PICKUP_WAIT_DAYS),
        ).fetchone()[0]
        conn.execute(
            "INSERT INTO pickup_requests (invite_id, purpose, network, note) VALUES (%s, %s, %s, %s)",
            (invite_id, body.purpose, body.network, body.note.strip()),
        )
    return {"number": number}


class NumberBody(BaseModel):
    number: str


@router.post("/pickup/status", dependencies=[Depends(require_app_header), Depends(limit)])
def pickup_status(body: NumberBody, conn: Conn) -> dict:
    """Where a request stands: waiting (kept until `until`, then it has to be asked again), approved (redeem it by
    `until`), declined, used, or unknown for a number that is wrong or has run out. Answered while requests are
    closed too, for numbers already given."""
    code = crypto.normalize_invite_code(body.number)
    row = None if code is None else conn.execute(
        "SELECT pickup_state, redeemed_at IS NOT NULL, expires_at FROM invites "
        "WHERE code_hmac = %s AND pickup_state IS NOT NULL AND (redeemed_at IS NOT NULL OR expires_at > now())",
        (crypto.keyed_hash(load().hmac_key, code),),
    ).fetchone()
    if row is None:
        return {"state": "unknown", "until": None}
    state, used, expires_at = row
    if used:
        return {"state": "used", "until": None}
    return {"state": state, "until": expires_at.date().isoformat() if state in ("waiting", "approved") else None}
