import time

import pytest
from fastapi.testclient import TestClient

from app import blocklists
from app.main import app

HEADERS = {"X-Vessel-Request": "1"}

RPZ = """$TTL 3600
@ SOA localhost. root.localhost. 1 28800 3600 259200 3600
  NS  localhost.
bad.example CNAME .
*.bad.example CNAME .
; a comment
"""


@pytest.fixture
def api():
    # fresh lists, so the request does not start a download
    blocklists.set_lists({"malware": frozenset({"bad.example"}), "ads": frozenset({"ads.example", "bad.example"})})
    blocklists.lookup_limiter.reset()
    yield TestClient(app)
    blocklists.set_lists({}, at=None)
    blocklists._loaded_at = None


def ask(client, domain, ip="203.0.113.5"):
    return client.post("/api/blocklist", json={"domain": domain}, headers=HEADERS | {"CF-Connecting-IP": ip})


def test_parse_keeps_the_plain_names():
    assert blocklists.parse(RPZ) == frozenset({"bad.example"})


@pytest.mark.parametrize("raw, host", [
    ("Example.COM", "example.com"),
    ("https://www.example.com/path?q=1", "www.example.com"),
    ("www.example.com:8443/x", "www.example.com"),
    ("example.com.", "example.com"),
    ("台灣.tw", "xn--kpry57d.tw"),
    ("not a domain", None),
    ("localhost", None),
    ("-bad-.example", None),
    ("", None),
])
def test_normalize(raw, host):
    assert blocklists.normalize(raw) == host


def test_lookup_names_the_filters_that_block_a_site(api):
    r = ask(api, "https://cdn.bad.example/x.js")
    assert r.status_code == 200 and r.headers["cache-control"] == "no-store"
    assert {k: r.json()[k] for k in ("domain", "malware", "ads")} == {"domain": "cdn.bad.example", "malware": True, "ads": True}
    assert {k: ask(api, "ads.example").json()[k] for k in ("malware", "ads")} == {"malware": False, "ads": True}
    assert {k: ask(api, "good.example").json()[k] for k in ("malware", "ads")} == {"malware": False, "ads": False}
    # a parent of a listed name is not blocked
    assert ask(api, "example").status_code == 400
    assert ask(api, "notbad.example").json()["malware"] is False


def test_lookup_needs_the_app_header_and_is_rate_limited(api):
    assert api.post("/api/blocklist", json={"domain": "good.example"}).status_code == 403
    for _ in range(20):
        assert ask(api, "good.example", "198.51.100.9").status_code == 200
    assert ask(api, "good.example", "198.51.100.9").status_code == 429


def test_lookup_before_the_lists_arrive(api):
    blocklists._loaded_at = None
    assert ask(api, "good.example").status_code == 503


def test_a_failed_download_keeps_the_lists(monkeypatch):
    blocklists.set_lists({"malware": frozenset({"bad.example"}), "ads": frozenset()}, at=time.time() - 9 * 3600)

    def fail(*_, **__):
        raise OSError("offline")

    monkeypatch.setattr(blocklists.urllib.request, "urlopen", fail)
    blocklists._download()
    assert blocklists._lists["malware"] == frozenset({"bad.example"})
