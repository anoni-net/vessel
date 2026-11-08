"""The network part of the connection check on /check/: what OONI's public measurements say about the visitor's network
when they are not on Vessel. The request's address is looked up in a table held in memory (IPtoASN, public domain), so it
reaches no one else; only the network's number goes to OONI, and answers are cached per network. Nothing is logged.

The answer also carries the STUN server the page tests UDP against: Cloudflare's public one, which needs no setup and is
not on a node (every visitor gets the address), unless VESSEL_STUN ("host:port") names another. An empty VESSEL_STUN turns
the UDP test off."""

import datetime
import gzip
import ipaddress
import json
import os
import socket
import threading
import time
import urllib.request
from array import array
from bisect import bisect_right
from concurrent.futures import ThreadPoolExecutor

from fastapi import APIRouter, Request, Response

from app.auth import client_key, error
from app.ratelimit import Limiter

router = APIRouter(prefix="/api")

TABLE_URL = "https://iptoasn.com/data/ip2asn-combined.tsv.gz"
OONI_URL = "https://api.ooni.io/api/v1/aggregation"
USER_AGENT = "Vessel connection check (+https://vessel.anoni.net/check/)"
STUN = os.environ.get("VESSEL_STUN", "stun.cloudflare.com:3478") or None
TESTS = ("web_connectivity", "signal", "telegram", "whatsapp", "tor")
DAYS = 30
TABLE_REFRESH_SECONDS = 7 * 86400
CACHE_SECONDS = 12 * 3600
# a failed answer from OONI is asked again soon
CACHE_FAILED_SECONDS = 300
CACHE_MAX = 5000
OONI_TIMEOUT = 6
# a broken download keeps the previous table
MIN_ROWS = 100_000
# With fewer measurements a share says little. The share of anomalies is below 10% on most networks and above 90% on
# networks that block the service (measured over 16 networks, 2026-11-08), so these two lines are not close to either.
MIN_MEASUREMENTS = 10
SOME = 15
MOST = 50

network_limiter = Limiter(limit=20, window_seconds=60)
_loading = threading.Lock()
_table: "Table | None" = None
_table_at: float | None = None
_cache: dict[int, tuple[float, dict]] = {}


class Table:
    """Sorted address ranges in plain arrays, about 20 MB. IPv6 keeps the upper 64 bits: routes are not longer than that."""

    def __init__(self, rows: list[tuple[int, int, int, int]], names: dict[int, str]) -> None:
        # rows: (version, start, end, asn)
        self.names = names
        self.ranges = {}
        for version, code in ((4, "I"), (6, "Q")):
            picked = sorted(r[1:] for r in rows if r[0] == version)
            self.ranges[version] = (array(code, (r[0] for r in picked)), array(code, (r[1] for r in picked)),
                                    array("I", (r[2] for r in picked)))

    def lookup(self, address: str) -> int | None:
        try:
            ip = ipaddress.ip_address(address)
        except ValueError:
            return None
        if ip.version == 6 and ip.ipv4_mapped:
            ip = ip.ipv4_mapped
        value = int(ip) if ip.version == 4 else int(ip) >> 64
        starts, ends, asns = self.ranges[ip.version]
        i = bisect_right(starts, value) - 1
        return asns[i] if i >= 0 and value <= ends[i] else None


def parse_table(text: str) -> Table:
    rows: list[tuple[int, int, int, int]] = []
    names: dict[int, str] = {}
    for line in text.splitlines():
        parts = line.split("\t")
        if len(parts) < 5 or parts[2] == "0":
            continue
        family, version, shift = (socket.AF_INET6, 6, 64) if ":" in parts[0] else (socket.AF_INET, 4, 0)
        # inet_pton: this runs over half a million rows, and ipaddress takes many times as long
        try:
            start = int.from_bytes(socket.inet_pton(family, parts[0])) >> shift
            end = int.from_bytes(socket.inet_pton(family, parts[1])) >> shift
            asn = int(parts[2])
        except (OSError, ValueError):
            continue
        rows.append((version, start, end, asn))
        names[asn] = parts[4]
    return Table(rows, names)


def _download_table() -> None:
    global _table, _table_at
    try:
        request = urllib.request.Request(TABLE_URL, headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(request, timeout=120) as r:
            text = gzip.decompress(r.read()).decode("utf-8", "replace")
    except (OSError, EOFError):
        return
    table = parse_table(text)
    if len(table.ranges[4][0]) + len(table.ranges[6][0]) >= MIN_ROWS:
        _table, _table_at = table, time.time()


def refresh_in_background() -> None:
    """Start a download unless one is running or the table is still fresh. Returns at once."""
    stale = _table_at is None or time.time() - _table_at > TABLE_REFRESH_SECONDS
    if not stale or not _loading.acquire(blocking=False):
        return

    def run() -> None:
        try:
            _download_table()
        finally:
            _loading.release()

    threading.Thread(target=run, daemon=True).start()


def level(result: dict | None) -> str:
    if result is None:
        return "unknown"
    blocked = result["anomaly_count"] + result["confirmed_count"]
    # a failed measurement says nothing either way
    counted = result["ok_count"] + blocked
    if counted < MIN_MEASUREMENTS:
        return "few"
    share = 100 * blocked / counted
    return "most" if share >= MOST else "some" if share >= SOME else "ok"


def _measure(asn: int, test: str) -> dict | None:
    today = datetime.datetime.now(datetime.UTC).date()
    since = today - datetime.timedelta(days=DAYS)
    until = today + datetime.timedelta(days=1)
    url = f"{OONI_URL}?probe_asn=AS{asn}&test_name={test}&since={since}&until={until}"
    try:
        request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(request, timeout=OONI_TIMEOUT) as r:
            result = json.load(r)["result"]
        return {k: int(result[k]) for k in ("measurement_count", "ok_count", "anomaly_count", "confirmed_count")}
    except (OSError, ValueError, KeyError, TypeError):
        return None


def report(asn: int) -> dict:
    now = time.time()
    cached = _cache.get(asn)
    if cached and cached[0] > now:
        return cached[1]
    with ThreadPoolExecutor(len(TESTS)) as pool:
        results = list(pool.map(lambda test: _measure(asn, test), TESTS))
    tests = []
    for test, result in zip(TESTS, results):
        counted = 0 if result is None else result["ok_count"] + result["anomaly_count"] + result["confirmed_count"]
        blocked = 0 if result is None else result["anomaly_count"] + result["confirmed_count"]
        tests.append({"id": test, "level": level(result), "measurements": counted,
                      "anomaly_pct": round(100 * blocked / counted) if counted else 0,
                      "confirmed": 0 if result is None else result["confirmed_count"]})
    answer = {"tests": tests, "days": DAYS}
    if len(_cache) >= CACHE_MAX:
        _cache.clear()
    _cache[asn] = (now + (CACHE_FAILED_SECONDS if None in results else CACHE_SECONDS), answer)
    return answer


@router.get("/network")
def network(request: Request, response: Response) -> dict:
    response.headers["Cache-Control"] = "no-store"
    address = client_key(request)
    if not network_limiter.allow(address):
        raise error(429, "too_many_attempts")
    refresh_in_background()
    asn = _table.lookup(address) if _table else None
    if asn is None:
        return {"asn": None, "name": None, "tests": [], "days": DAYS, "stun": STUN}
    return {"asn": asn, "name": _table.names.get(asn), **report(asn), "stun": STUN}
