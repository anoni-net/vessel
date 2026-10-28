"""Regions and devices. The browser generates the key pair and the preshared key; the backend passes the
public key and the preshared key to the node and never sees the private key."""

import re
import secrets
from datetime import date
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Response
from psycopg.types.json import Jsonb
from pydantic import BaseModel, Field

from app import jobs, policy
from app.auth import Account, Conn, error, require_app_header

router = APIRouter(prefix="/api")

KEY = re.compile(r"^[A-Za-z0-9+/]{42}[AEIMQUYcgkosw048]=$")


class NewDevice(BaseModel):
    name: Annotated[str, Field(min_length=1, max_length=40)]
    region: str
    dns_filter: Literal["none", "malware", "ads"]
    public_key: str
    preshared_key: str


def new_device_id() -> str:
    return "d-" + "".join(secrets.choice("abcdefghijklmnopqrstuvwxyz0123456789") for _ in range(12))


def used_bytes(conn, account_id: int) -> int:
    row = conn.execute(
        "SELECT rx_bytes + tx_bytes FROM account_usage WHERE account_id = %s AND period = %s",
        (account_id, date.today().replace(day=1)),
    ).fetchone()
    return row[0] if row else 0


@router.get("/regions")
def regions(_: Account, conn: Conn) -> list[dict]:
    # the frontend names regions by id; node hosts and endpoints are not exposed here
    return [{"id": r[0], "open": r[1]} for r in conn.execute("SELECT id, is_open FROM regions ORDER BY id")]


@router.get("/devices")
def list_devices(account_id: Account, conn: Conn) -> list[dict]:
    rows = conn.execute(
        "SELECT d.id, d.name, d.region_id, d.dns_filter, d.status, d.created_on, d.expires_on, "
        "coalesce(u.rx_bytes + u.tx_bytes, 0), coalesce(u.blocked, 0) FROM devices d "
        "LEFT JOIN device_usage u ON u.device_id = d.id AND u.period = date_trunc('month', current_date) "
        "WHERE d.account_id = %s ORDER BY d.created_on, d.id",
        (account_id,),
    )
    return [
        {"id": r[0], "name": r[1], "region": r[2], "dns_filter": r[3], "status": r[4],
         "created_on": r[5].isoformat(), "expires_on": r[6].isoformat(), "used_bytes": r[7], "blocked": r[8]}
        for r in rows
    ]


@router.post("/devices", dependencies=[Depends(require_app_header)])
def create_device(body: NewDevice, account_id: Account, conn: Conn, response: Response) -> dict:
    name = body.name.strip()
    if not name:
        raise error(400, "invalid_name")
    if not KEY.match(body.public_key) or not KEY.match(body.preshared_key) or body.public_key == body.preshared_key:
        raise error(400, "invalid_key")
    device_id = new_device_id()
    with conn.transaction():
        conn.execute("SELECT id FROM accounts WHERE id = %s FOR UPDATE", (account_id,))
        if not conn.execute("SELECT 1 FROM regions WHERE id = %s AND is_open", (body.region,)).fetchone():
            raise error(400, "region_closed")
        count = conn.execute(
            "SELECT count(*) FROM devices WHERE account_id = %s AND status <> 'revoking'", (account_id,)
        ).fetchone()[0]
        if count >= policy.DEVICE_LIMIT:
            raise error(409, "device_limit")
        if used_bytes(conn, account_id) >= policy.MONTHLY_QUOTA_BYTES:
            raise error(403, "quota_exceeded")
        if conn.execute("SELECT 1 FROM devices WHERE public_key = %s", (body.public_key,)).fetchone():
            raise error(409, "key_in_use")
        conn.execute(
            "INSERT INTO devices (id, account_id, region_id, name, public_key, dns_filter, expires_on) "
            "VALUES (%s, %s, %s, %s, %s, %s, current_date + %s)",
            (device_id, account_id, body.region, name, body.public_key, body.dns_filter, policy.DEVICE_DAYS),
        )
        job_id = conn.execute(
            "INSERT INTO jobs (region_id, device_id, action, payload) VALUES (%s, %s, 'add', %s) RETURNING id",
            (body.region, device_id,
             Jsonb({"public_key": body.public_key, "psk": body.preshared_key, "dns_filter": body.dns_filter})),
        ).fetchone()[0]
    # try right away; if the node is slow or down, the worker retries and the browser polls for the config
    jobs.run_job(conn, job_id)
    config = take_config(conn, account_id, device_id)
    if config is None:
        response.status_code = 202
        return {"id": device_id, "status": "pending"}
    return {"id": device_id, "status": "active", "config": config}


def take_config(conn, account_id: int, device_id: str) -> dict | None:
    """Hand out the node's answer once, then forget it."""
    with conn.transaction():
        row = conn.execute(
            "SELECT j.id, j.result FROM jobs j JOIN devices d ON d.id = j.device_id "
            "WHERE j.device_id = %s AND d.account_id = %s AND j.action = 'add' AND j.result IS NOT NULL FOR UPDATE OF j",
            (device_id, account_id),
        ).fetchone()
        if row is None:
            return None
        conn.execute("UPDATE jobs SET result = NULL WHERE id = %s", (row[0],))
        return row[1]


@router.get("/devices/{device_id}/config")
def device_config(device_id: str, account_id: Account, conn: Conn, response: Response) -> dict:
    device = conn.execute(
        "SELECT status FROM devices WHERE id = %s AND account_id = %s", (device_id, account_id)
    ).fetchone()
    if device is None:
        raise error(404, "not_found")
    config = take_config(conn, account_id, device_id)
    if config is not None:
        return {"status": "active", "config": config}
    failed = conn.execute(
        "SELECT 1 FROM jobs WHERE device_id = %s AND action = 'add' AND status = 'failed'", (device_id,)
    ).fetchone()
    if failed:
        raise error(502, "node_failed")
    if device[0] == "pending":
        response.status_code = 202
        return {"status": "pending"}
    # already handed out: the private key only ever existed in the browser that created it
    raise error(410, "config_gone")


@router.delete("/devices/{device_id}", dependencies=[Depends(require_app_header)])
def delete_device(device_id: str, account_id: Account, conn: Conn) -> dict[str, bool]:
    with conn.transaction():
        row = conn.execute(
            "UPDATE devices SET status = 'revoking' WHERE id = %s AND account_id = %s RETURNING region_id",
            (device_id, account_id),
        ).fetchone()
        if row is None:
            raise error(404, "not_found")
        # a pending add that has not reached the node yet is dropped; remove covers it either way
        conn.execute("UPDATE jobs SET status = 'done', payload = NULL WHERE device_id = %s AND status = 'queued'",
                     (device_id,))
        job_id = conn.execute(
            "INSERT INTO jobs (region_id, device_id, action) VALUES (%s, %s, 'remove') RETURNING id",
            (row[0], device_id),
        ).fetchone()[0]
    jobs.run_job(conn, job_id)
    return {"ok": True}
