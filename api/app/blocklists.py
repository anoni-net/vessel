"""Is a site on the DNS blocklists? The nodes' resolvers block with two HaGeZi lists (node/update-lists.sh); the
portal keeps its own copy of the same lists in memory, refreshed every 8 hours like the nodes, so the DNS page
can tell a visitor whether a site that will not open was blocked, and which filters block it. The domain asked
about is only compared in memory: it is not logged or stored."""

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

# the same files node/update-lists.sh downloads; the ads resolver loads both, so a site on the malware list is
# blocked by both filters and one only on the ads list by the ads filter alone
SOURCES = {
    "malware": "https://raw.githubusercontent.com/hagezi/dns-blocklists/main/rpz/tif.mini.txt",
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


def set_lists(lists: dict[str, frozenset[str]], at: float | None = None) -> None:
    """Replace the lists; the background refresh calls this, and tests use it instead of the network."""
    global _lists, _loaded_at
    _lists, _loaded_at = dict(lists), time.time() if at is None else at


def _download() -> None:
    fresh = {}
    for name, url in SOURCES.items():
        try:
            with urllib.request.urlopen(url, timeout=120) as r:
                names = parse(r.read().decode("utf-8", "replace"))
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
