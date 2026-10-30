"""The connection check on /check/: did this request come through a Vessel node? No session is needed and
nothing about the visitor is kept; the request's address is compared with the nodes' exit addresses and only
the result goes back."""

import ipaddress

from fastapi import APIRouter, Request, Response

from app.auth import Conn, client_key, error
from app.ratelimit import Limiter

router = APIRouter(prefix="/api")

# per client IP, in memory only
check_limiter = Limiter(limit=30, window_seconds=60)


@router.get("/exit")
def exit_check(request: Request, conn: Conn, response: Response) -> dict:
    response.headers["Cache-Control"] = "no-store"
    ip = client_key(request)
    if not check_limiter.allow(ip):
        raise error(429, "too_many_attempts")
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return {"region": None, "ipv6": False}
    row = conn.execute("SELECT id FROM regions WHERE exit_ip = %s", (str(addr),)).fetchone()
    if row is None:
        # a config made before the region moved host still goes out through the old one until it is switched off;
        # after that day the address may belong to someone else
        old = conn.execute(
            "SELECT id FROM regions WHERE previous_exit_ip = %s AND previous_until >= current_date", (str(addr),)
        ).fetchone()
        if old:
            return {"region": old[0], "ipv6": False, "previous": True}
    # traffic through a node leaves over IPv4, so an IPv6 address means this browser went around the VPN
    return {"region": row[0] if row else None, "ipv6": addr.version == 6}
