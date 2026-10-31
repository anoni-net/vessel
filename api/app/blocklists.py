"""Is a site on the DNS blocklists? The nodes' resolvers block with two HaGeZi lists and the 165 list of scam sites
Taiwan's ISPs stop resolving (node/update-lists.sh); the portal keeps its own copy of the same lists in memory, refreshed every 8 hours like the nodes, so the DNS page
can tell a visitor whether a site that will not open was blocked, and which filters block it. The domain asked
about is only compared in memory: it is not logged or stored."""

import csv
import io
import re
import threading
import time
import urllib.request
from datetime import UTC, datetime
from typing import Annotated
from urllib.parse import urlsplit

from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel, Field

from app.auth import client_key, error, require_app_header
from app.ratelimit import Limiter

router = APIRouter(prefix="/api")

# the same files node/update-lists.sh downloads. Both filters load the malware and the 165 lists, and the ads
# filter the ads list too, so a site on either of the first two is blocked by both filters, one only on the ads
# list by the ads filter alone
SOURCES = {
    "malware": "https://raw.githubusercontent.com/hagezi/dns-blocklists/main/rpz/tif.mini.txt",
    # 165反詐騙諮詢專線_遭停止解析涉詐網站 (data.gov.tw dataset 176455), a CSV
    "tw165": "https://opdadm.moi.gov.tw/api/v1/no-auth/resource/api/dataset/29E8E643-88ED-4952-B21E-BD42A3B7108C"
    "/resource/D7839A03-8491-490E-BAF7-2ED2D98C5157/download",
    "ads": "https://raw.githubusercontent.com/hagezi/dns-blocklists/main/rpz/pro.txt",
}
REFRESH_SECONDS = 8 * 3600
# a list this short means the download went wrong; keep the copy already loaded
MIN_ENTRIES = 1000

LABEL = re.compile(r"^(?!-)[a-z0-9_-]{1,63}(?<!-)$")

_lists: dict[str, frozenset[str]] = {}
_loaded_at: float | None = None
_loading = threading.Lock()

lookup_limiter = Limiter(limit=20, window_seconds=60)


def parse(text: str) -> frozenset[str]:
    """The names an RPZ zone blocks. Each is listed twice, as `name CNAME .` and `*.name CNAME .`; the wildcard
    is implied by checking every parent of a domain, so only the plain names are kept."""
    names = set()
    for line in text.splitlines():
        parts = line.split()
        if len(parts) >= 3 and parts[1] == "CNAME" and parts[2] == "." and not parts[0].startswith("*."):
            names.add(parts[0].lower().rstrip("."))
    return frozenset(names)


def parse_165(text: str) -> frozenset[str]:
    """The domains in the 165 CSV (民國年月, 網域, 網站性質, ...), cleaned like the node does: a scheme, a path or stray
    characters in front are dropped, and entries that are still not a host name are skipped."""
    names = set()
    for row in csv.DictReader(io.StringIO(text.lstrip("\ufeff"))):
        raw = (row.get("網域") or "").strip()
        host = normalize(raw.lstrip("?？*. ")) if raw else None
        if host:
            names.add(host)
    return frozenset(names)


def set_lists(lists: dict[str, frozenset[str]], at: float | None = None) -> None:
    """Replace the lists; the background refresh calls this, and tests use it instead of the network."""
    global _lists, _loaded_at
    _lists, _loaded_at = dict(lists), time.time() if at is None else at


def _download() -> None:
    fresh = {}
    for name, url in SOURCES.items():
        try:
            with urllib.request.urlopen(url, timeout=120) as r:
                text = r.read().decode("utf-8", "replace")
            names = parse_165(text) if name == "tw165" else parse(text)
        except OSError:
            names = frozenset()
        # one failed list keeps its previous copy instead of emptying it
        fresh[name] = names if len(names) >= MIN_ENTRIES else _lists.get(name, frozenset())
    if any(fresh.values()):
        set_lists(fresh)


def refresh_in_background(force: bool = False) -> None:
    """Start a download unless one is running or the lists are still fresh. Returns at once."""
    stale = _loaded_at is None or time.time() - _loaded_at > REFRESH_SECONDS
    if not (force or stale) or not _loading.acquire(blocking=False):
        return

    def run() -> None:
        try:
            _download()
        finally:
            _loading.release()

    threading.Thread(target=run, name="blocklists", daemon=True).start()


def normalize(raw: str) -> str | None:
    """The host name in what a visitor typed: a bare domain or a full address, any case, Unicode or not."""
    s = raw.strip().lower()
    if not s:
        return None
    host = urlsplit(s if "://" in s else "//" + s).hostname
    if not host:
        return None
    host = host.rstrip(".")
    try:
        host = host.encode("idna").decode("ascii")
    except UnicodeError:
        return None
    labels = host.split(".")
    if len(host) > 253 or len(labels) < 2 or not all(LABEL.match(label) for label in labels):
        return None
    return host


def blocked_by(host: str) -> dict[str, bool]:
    # the name itself and every parent: `*.example.com` in a list blocks `ads.example.com`
    labels = host.split(".")
    names = {".".join(labels[i:]) for i in range(len(labels))}
    return {name: not names.isdisjoint(_lists.get(name, frozenset())) for name in SOURCES}


class Lookup(BaseModel):
    domain: Annotated[str, Field(max_length=2048)]


# POST, so the domain stays out of URLs that proxies along the way may keep
@router.post("/blocklist", dependencies=[Depends(require_app_header)])
def lookup(body: Lookup, request: Request, response: Response) -> dict:
    response.headers["Cache-Control"] = "no-store"
    if not lookup_limiter.allow(client_key(request)):
        raise error(429, "too_many_attempts")
    host = normalize(body.domain)
    if host is None:
        raise error(400, "invalid_domain")
    refresh_in_background()
    if _loaded_at is None or not _lists:
        raise error(503, "lists_loading")
    return {"domain": host, **blocked_by(host), "as_of": datetime.fromtimestamp(_loaded_at, UTC).isoformat()}
