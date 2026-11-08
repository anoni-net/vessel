"""Is a site on the DNS blocklists? The nodes' resolvers block with two HaGeZi lists, the two lists of scam sites
Taiwan's ISPs stop resolving and Echap's stalkerware domains (node/update-lists.sh); the portal keeps its own copy of the same lists in memory, refreshed every 8 hours like the nodes, so the DNS page
can tell a visitor whether a site that will not open was blocked, and which filters block it. The domain asked
about is only compared in memory and asked of Quad9, which the nodes' filter also forwards to: it is not logged or stored."""

import csv
import io
import json
import re
import secrets
import socket
import ssl
import struct
import threading
import time
import urllib.request
from datetime import UTC, datetime
from pathlib import Path
from typing import Annotated
from urllib.parse import urlsplit

from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel, Field

from app.auth import client_key, error, require_app_header
from app.ratelimit import Limiter

QUAD9_TIMEOUT = 1.5
NXDOMAIN = 3

router = APIRouter(prefix="/api")

# the same files node/update-lists.sh downloads. Both filters load every list but the last, and the ads filter the
# ads list too, so a site on any of the others is blocked by both filters, one only on the ads list by the ads filter
# alone
SOURCES = {
    "malware": "https://raw.githubusercontent.com/hagezi/dns-blocklists/main/rpz/tif.mini.txt",
    # 165反詐騙諮詢專線_遭停止解析涉詐網站 (data.gov.tw dataset 176455), a CSV
    "tw165": "https://opdadm.moi.gov.tw/api/v1/no-auth/resource/api/dataset/29E8E643-88ED-4952-B21E-BD42A3B7108C"
    "/resource/D7839A03-8491-490E-BAF7-2ED2D98C5157/download",
    # 數位發展部數位產業署聲請詐騙網域名稱停止解析網址清單 (data.gov.tw dataset 165027), JSON
    "twmoda": "https://www-api.moda.gov.tw/OpenData/Files/16352",
    # Echap's stalkerware indicators, a name a line (CC BY 4.0)
    "stalkerware": "https://raw.githubusercontent.com/AssoEchap/stalkerware-indicators/master/generated/hosts",
    "ads": "https://raw.githubusercontent.com/hagezi/dns-blocklists/main/rpz/pro.txt",
}
REFRESH_SECONDS = 8 * 3600
# the MODA server refuses Python's default User-Agent; every download says what it is
USER_AGENT = "Vessel blocklist updater (+https://vessel.anoni.net/dns/)"
# a list this short means the download went wrong; keep the copy already loaded. Echap's has about 900 names
MIN_ENTRIES = 1000
MIN_ENTRIES_BY_LIST = {"stalkerware": 500}

LABEL = re.compile(r"^(?!-)[a-z0-9_-]{1,63}(?<!-)$")


def excluded_names(text: str) -> frozenset[str]:
    """The names in the exclude file: one a line, anything after a # is the reason."""
    names = (line.split("#")[0].strip().lower() for line in text.splitlines())
    return frozenset(name for name in names if name)


# a copy of node/exclude.txt, which the nodes leave out of every list; only the name itself, a name under it stays listed
EXCLUDED = excluded_names(Path(__file__).with_name("blocklist_exclude.txt").read_text(encoding="utf-8"))

_lists: dict[str, frozenset[str]] = {}
_loaded_at: float | None = None
_summary: dict = {}
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


def parse_moda(text: str) -> frozenset[str]:
    """The domains in the MODA JSON (網域名稱, 偽冒網址, ...), as the node reads them: the domain field, unless it and the
    scam URL's host are both names and disagree (a typo in the field), when only the URL's host is kept."""
    names = set()
    for row in json.loads(text.lstrip("\ufeff")):
        # an email address sometimes stands in the domain field
        domain = normalize(str(row.get("網域名稱") or "").split("@")[-1].lstrip("?？*. "))
        url = normalize(str(row.get("偽冒網址") or "").lstrip("?？*. "))
        if url and domain and url != domain and not url.endswith("." + domain):
            names.add(url)
        elif domain or url:
            names.add(domain or url)
    return frozenset(names)


def parse_hosts(text: str) -> frozenset[str]:
    """The names in a plain list, one a line; the node blocks each with its subdomains, like an RPZ zone's."""
    names = (normalize(line) for line in text.splitlines() if not line.lstrip().startswith("#"))
    return frozenset(name for name in names if name)


PARSERS = {"tw165": parse_165, "twmoda": parse_moda, "stalkerware": parse_hosts}


def tls_context(name: str) -> ssl.SSLContext:
    """The default checks, except for the 165 list: its server's certificate chain has a CA certificate without a
    Subject Key Identifier, which Python 3.13 rejects by default (VERIFY_X509_STRICT). The chain and the host name
    are still verified; curl on the nodes accepts the same chain."""
    context = ssl.create_default_context()
    if name == "tw165":
        context.verify_flags &= ~ssl.VERIFY_X509_STRICT
    return context


def _on_any(name: str, lists: list[frozenset[str]]) -> bool:
    """A list also blocks what is under its names, so a name counts as listed when it or a parent is on a list."""
    labels = name.split(".")
    return any(".".join(labels[i:]) in names for names in lists for i in range(len(labels) - 1))


def _count_all(lists: list[frozenset[str]]) -> int:
    """How many names the lists have together, a name that a list before it already blocks counting once."""
    return sum(1 for i, names in enumerate(lists) for name in names if not _on_any(name, lists[:i]))


def summarize(lists: dict[str, frozenset[str]]) -> dict:
    """What the page on the lists shows: their sizes and how much of each no other list has. Only the lists are
    counted, nobody's queries."""
    def get(*names: str) -> list[frozenset[str]]:
        return [lists.get(name, frozenset()) for name in names]

    rows = [
        {"id": name,
         "domains": len(lists.get(name, frozenset())),
         "only_here": sum(1 for n in lists.get(name, frozenset()) if not _on_any(n, get(*(set(SOURCES) - {name}))))}
        for name in SOURCES
    ]
    return {
        "lists": rows,
        "malware_filter": _count_all(get(*(name for name in SOURCES if name != "ads"))),
        "ads_filter": _count_all(get(*SOURCES)),
        "hagezi": _count_all(get("malware", "ads")),
    }


def set_lists(lists: dict[str, frozenset[str]], at: float | None = None) -> None:
    """Replace the lists; the background refresh calls this, and tests use it instead of the network."""
    global _lists, _loaded_at, _summary
    _lists, _loaded_at = dict(lists), time.time() if at is None else at
    _summary = summarize(_lists)


def _download() -> None:
    fresh = {}
    for name, url in SOURCES.items():
        try:
            request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(request, timeout=120, context=tls_context(name)) as r:
                text = r.read().decode("utf-8", "replace")
            names = PARSERS.get(name, parse)(text) - EXCLUDED
        except (OSError, ValueError):
            names = frozenset()
        # one failed list keeps its previous copy instead of emptying it
        enough = len(names) >= MIN_ENTRIES_BY_LIST.get(name, MIN_ENTRIES)
        fresh[name] = names if enough else _lists.get(name, frozenset())
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


def _rcode(host: str, server: str, port: int = 53) -> int | None:
    """The response code for an A lookup, or None without an answer. A reply must carry the query's ID: a network can
    deliver a reply twice, or an old one late."""
    query_id = secrets.randbits(16)
    question = b"".join(bytes([len(label)]) + label.encode() for label in host.split(".")) + b"\0\0\1\0\1"
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
        sock.settimeout(QUAD9_TIMEOUT)
        try:
            sock.connect((server, port))
            sock.send(struct.pack(">HHHHHH", query_id, 0x0100, 1, 0, 0, 0) + question)
            while True:
                reply = sock.recv(1500)
                if len(reply) >= 12 and struct.unpack(">H", reply[:2])[0] == query_id:
                    return reply[3] & 0x0F
        except OSError:
            return None


def quad9_blocks(host: str) -> bool | None:
    """Does Quad9's filter block it? None when Quad9 did not answer. 9.9.9.10 is the same service without the filter."""
    with_filter = _rcode(host, "9.9.9.9")
    if with_filter != NXDOMAIN:
        return None if with_filter is None else False
    without = _rcode(host, "9.9.9.10")
    return None if without is None else without != NXDOMAIN


def blocked_by(host: str) -> dict[str, bool]:
    # the name itself and every parent: `*.example.com` in a list blocks `ads.example.com`
    labels = host.split(".")
    names = {".".join(labels[i:]) for i in range(len(labels))}
    return {name: not names.isdisjoint(_lists.get(name, frozenset())) for name in SOURCES}


@router.get("/blocklist/lists")
def lists_summary(response: Response) -> dict:
    """The sizes of the lists. Public and the same for everyone; nothing about the visitor is involved."""
    response.headers["Cache-Control"] = "no-store"
    refresh_in_background()
    if _loaded_at is None or not _lists:
        raise error(503, "lists_loading")
    return {**_summary, "as_of": datetime.fromtimestamp(_loaded_at, UTC).isoformat()}


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
    return {"domain": host, **blocked_by(host), "quad9": quad9_blocks(host), "as_of": datetime.fromtimestamp(_loaded_at, UTC).isoformat()}
