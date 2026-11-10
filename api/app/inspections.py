"""Device inspection (toomore/anoni-net-ws#480): a person asks for it on the device page, agrees to what is collected,
and confirms on the device itself. The node then copies that device's traffic to the analysis host until the end time;
the result is sealed to a key the person's browser made, so the database holds only ciphertext. Kept for
INSPECT_REPORT_DAYS after the end, then gone."""

import datetime as dt
import re
import secrets
from typing import Annotated

from fastapi import APIRouter, Depends
from psycopg.types.json import Jsonb
from pydantic import BaseModel, Field

from app import crypto, jobs, policy
from app.auth import Account, Conn, error, require_app_header
from app.config import load
from app.nodes import NodeError, get_analysis, get_node

router = APIRouter(prefix="/api")

PUBLIC_KEY = re.compile(r"^[A-Za-z0-9+/]{43}=$")
ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
RUNNING = ("confirming", "active", "ending")
REFRESH_MINUTES = 30
SETTLE_SECONDS = 5  # for packets already on their way when the node stopped copying
DRAIN_MINUTES = 20  # the longest a report waits for the analysis


class NewInspection(BaseModel):
    consent_version: Annotated[str, Field(max_length=20)]
    public_key: Annotated[str, Field(max_length=44)]


def code_hash(code: str) -> bytes:
    return crypto.keyed_hash(load().hmac_key, code)


def new_code() -> str:
    return "".join(secrets.choice(ALPHABET) for _ in range(16))


def link(code: str) -> dict:
    return {"code": code, "url": f"https://{policy.INSPECT_CONFIRM_HOST}/c/{code}", "minutes": policy.INSPECT_CONFIRM_MINUTES}


def owned(conn, device_id: str, account_id: int, lock: str = ""):
    row = conn.execute(f"SELECT status FROM devices WHERE id = %s AND account_id = %s {lock}", (device_id, account_id)).fetchone()
    if row is None:
        raise error(404, "not_found")
    return row[0]


def summary(row) -> dict:
    status, started_at, ends_at, stopped_at, report, report_until = row
    # when copying stopped: before ends_at for one ended early, so the report's days end there and not at the planned end
    return {"status": status, "started_at": started_at.isoformat() if started_at else None,
            "ends_at": ends_at.isoformat() if ends_at else None, "stopped_at": stopped_at.isoformat() if stopped_at else None,
            "report": report, "report_until": report_until.isoformat() if report_until else None}


@router.post("/devices/{device_id}/inspection", dependencies=[Depends(require_app_header)])
def start(device_id: str, body: NewInspection, account_id: Account, conn: Conn) -> dict:
    if get_analysis() is None:
        raise error(503, "inspection_unavailable")
    if body.consent_version != policy.INSPECT_CONSENT_VERSION:
        raise error(400, "consent_outdated")
    if not PUBLIC_KEY.fullmatch(body.public_key):
        raise error(400, "invalid_key")
    code = new_code()
    with conn.transaction():
        if owned(conn, device_id, account_id, "FOR UPDATE") != "active":
            raise error(409, "device_not_active")
        current = conn.execute("SELECT status FROM device_inspections WHERE device_id = %s", (device_id,)).fetchone()
        if current and current[0] in RUNNING:
            raise error(409, "inspection_running")
        # a new inspection replaces the last one's report, and the page says so before this is called
        conn.execute("DELETE FROM device_inspections WHERE device_id = %s", (device_id,))
        conn.execute(
            "INSERT INTO device_inspections (device_id, status, code_hmac, public_key, consent_version) "
            "VALUES (%s, 'confirming', %s, %s, %s)",
            (device_id, code_hash(code), body.public_key, body.consent_version),
        )
    return link(code)


@router.post("/devices/{device_id}/inspection/code", dependencies=[Depends(require_app_header)])
def renew(device_id: str, account_id: Account, conn: Conn) -> dict:
    """A new confirmation link before the last one runs out (WCAG 2.2.1): the old code stops working and the time to
    open the link starts again. Nothing else changes, the browser keeps the key it made."""
    code = new_code()
    with conn.transaction():
        owned(conn, device_id, account_id, "FOR UPDATE")
        renewed = conn.execute(
            "UPDATE device_inspections SET code_hmac = %s, code_at = now() WHERE device_id = %s AND status = 'confirming' "
            "AND code_at > now() - make_interval(mins => %s)",
            (code_hash(code), device_id, policy.INSPECT_CONFIRM_MINUTES),
        ).rowcount
    if not renewed:
        raise error(409, "inspection_expired")
    return link(code)


@router.get("/devices/{device_id}/inspection")
def read(device_id: str, account_id: Account, conn: Conn) -> dict:
    owned(conn, device_id, account_id)
    row = conn.execute(
        "SELECT status, started_at, ends_at, stopped_at, report, report_until, "
        "ceil(extract(epoch FROM code_at + make_interval(mins => %s) - now()))::int FROM device_inspections WHERE device_id = %s",
        (policy.INSPECT_CONFIRM_MINUTES, device_id),
    ).fetchone()
    base = {"consent_version": policy.INSPECT_CONSENT_VERSION, "days": policy.INSPECT_DAYS, "report_days": policy.INSPECT_REPORT_DAYS}
    # a link past its time confirms nothing, even before the worker deletes it
    if row is None or (row[0] == "confirming" and row[6] <= 0):
        return {**base, "status": "none"}
    # how long the link is still good for, so the page can say so before it runs out
    left = {"confirm_seconds": row[6]} if row[0] == "confirming" else {}
    return {**base, **summary(row[:6]), **left}


@router.delete("/devices/{device_id}/inspection", dependencies=[Depends(require_app_header)])
def stop(device_id: str, account_id: Account, conn: Conn) -> dict[str, bool]:
    """Turning it off: an active one ends at the next tick. Asked of a finished one, it deletes the report."""
    with conn.transaction():
        owned(conn, device_id, account_id, "FOR UPDATE")
        row = conn.execute("SELECT status FROM device_inspections WHERE device_id = %s", (device_id,)).fetchone()
        if row is None:
            raise error(404, "not_found")
        if row[0] == "active":
            conn.execute("UPDATE device_inspections SET status = 'ending' WHERE device_id = %s", (device_id,))
        elif row[0] != "ending":
            conn.execute("DELETE FROM device_inspections WHERE device_id = %s", (device_id,))
    return {"ok": True}


def poll_confirms(conn, analysis) -> None:
    node = get_node()
    regions = conn.execute(
        "SELECT DISTINCT r.id, r.node_host FROM device_inspections i JOIN devices d ON d.id = i.device_id "
        "JOIN regions r ON r.id = d.region_id WHERE i.status = 'confirming'"
    ).fetchall()
    for region, host in regions:
        try:
            confirms = node.inspect_confirms(host)
        except NodeError:
            continue
        for item in confirms:
            code, address = item["code"], item["address"]
            row = conn.execute(
                "SELECT i.device_id, d.tunnel_address FROM device_inspections i JOIN devices d ON d.id = i.device_id "
                "WHERE i.code_hmac = %s AND i.status = 'confirming' AND d.region_id = %s",
                (code_hash(code), region),
            ).fetchone()
            try:
                # opened from another device, or an old code: it confirms nothing
                if row is not None and str(row[1]) == address:
                    until = dt.datetime.now(dt.UTC) + dt.timedelta(days=policy.INSPECT_DAYS)
                    # the address may have been someone else's: start from nothing
                    analysis.clear(region, address)
                    node.inspect_on(host, row[0], int(until.timestamp()))
                    jobs.beat(conn, "analysis")
                    jobs.beat(conn, f"stream:{region}")
                    conn.execute(
                        "UPDATE device_inspections SET status = 'active', started_at = now(), ends_at = %s, code_hmac = NULL "
                        "WHERE device_id = %s",
                        (until, row[0]),
                    )
                node.inspect_ack(host, code)
            except NodeError:
                continue


def finish(conn, analysis) -> None:
    """One step per tick. The node stops copying; a few seconds later, for what was on its way, the analysis host closes
    what it has received; once that has been analysed the report is sealed and the results cleared. Clearing any sooner
    would leave the last packets out of the report, and the next analysis would bring their results back."""
    node = get_node()
    for device_id, region, host, address, key, stopped, settled, flushed, overdue in conn.execute(
        "SELECT d.id, r.id, r.node_host, d.tunnel_address, i.public_key, i.stopped_at IS NOT NULL, "
        "i.stopped_at < now() - make_interval(secs => %s), i.flushed_at IS NOT NULL, "
        "i.flushed_at < now() - make_interval(mins => %s) "
        "FROM device_inspections i JOIN devices d ON d.id = i.device_id JOIN regions r ON r.id = d.region_id "
        "WHERE i.status = 'ending' OR (i.status = 'active' AND i.ends_at <= now())",
        (SETTLE_SECONDS, DRAIN_MINUTES),
    ).fetchall():
        address = str(address)
        try:
            if not stopped:
                node.inspect_off(host, device_id)
                conn.execute("UPDATE device_inspections SET status = 'ending', stopped_at = now() WHERE device_id = %s", (device_id,))
            elif not flushed:
                if settled:
                    analysis.flush()
                    conn.execute("UPDATE device_inspections SET flushed_at = now() WHERE device_id = %s", (device_id,))
            # a capture that cannot be analysed stays for a day: it does not hold the report back past the limit
            elif overdue or not analysis.status()["waiting"]:
                report = analysis.report(region, address, key)
                analysis.clear(region, address)
                conn.execute(
                    "UPDATE device_inspections SET status = 'ended', report = %s, report_until = current_date + %s WHERE device_id = %s",
                    (Jsonb(report), policy.INSPECT_REPORT_DAYS, device_id),
                )
        except NodeError:
            # the node's own end time has stopped it either way; the next tick tries this step again
            continue


def refresh(conn, analysis) -> None:
    """The report so far, for the page while the inspection runs."""
    for device_id, region, address, key in conn.execute(
        "SELECT d.id, d.region_id, d.tunnel_address, i.public_key FROM device_inspections i JOIN devices d ON d.id = i.device_id "
        "WHERE i.status = 'active'"
    ).fetchall():
        try:
            conn.execute("UPDATE device_inspections SET report = %s WHERE device_id = %s",
                         (Jsonb(analysis.report(region, str(address), key)), device_id))
        except NodeError:
            continue


def clear_leftovers(conn, analysis) -> None:
    """Devices deleted during an inspection: what the analysis host counted for them goes too."""
    for region, address in conn.execute("SELECT region_id, address FROM inspection_leftovers").fetchall():
        try:
            analysis.clear(region, str(address))
        except NodeError:
            continue
        conn.execute("DELETE FROM inspection_leftovers WHERE region_id = %s AND address = %s", (region, address))


def tick(conn, usage: bool) -> None:
    analysis = get_analysis()
    if analysis is None:
        return
    conn.execute("DELETE FROM device_inspections WHERE status = 'confirming' AND code_at < now() - make_interval(mins => %s)",
                 (policy.INSPECT_CONFIRM_MINUTES,))
    # before any confirmation: a new inspection may be about to use the same address
    clear_leftovers(conn, analysis)
    poll_confirms(conn, analysis)
    finish(conn, analysis)
    # a report past its time is deleted, whether or not the person downloaded it
    conn.execute("DELETE FROM device_inspections WHERE status = 'ended' AND report_until < current_date")
    if not usage:
        return
    regions = [r[0] for r in conn.execute(
        "SELECT DISTINCT d.region_id FROM device_inspections i JOIN devices d ON d.id = i.device_id WHERE i.status = 'active'"
    ).fetchall()]
    if not regions:
        return
    try:
        status = analysis.status()
    except NodeError:
        return
    jobs.beat(conn, "analysis")
    # deploy/health_warn.py warns when a node with a device under inspection has stopped sending
    for region in regions:
        if region in status.get("connected", ()):
            jobs.beat(conn, f"stream:{region}")
    due = conn.execute("SELECT NOT EXISTS (SELECT 1 FROM heartbeats WHERE name = 'inspect-refresh' AND at > now() - make_interval(mins => %s))",
                       (REFRESH_MINUTES,)).fetchone()[0]
    if due:
        refresh(conn, analysis)
        jobs.beat(conn, "inspect-refresh")
