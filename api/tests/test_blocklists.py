import json
import socket
import ssl
import threading
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import blocklists
from app.main import app

# the tests' fixture replaces this so that nothing reaches Quad9
REAL_RCODE = blocklists._rcode

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
    blocklists.set_lists({"malware": frozenset({"bad.example"}), "tw165": frozenset({"scam.example"}),
                          "twmoda": frozenset({"fakeshop.example"}), "stalkerware": frozenset({"spy.example"}),
                          "cti": frozenset({"active.example"}),
                          "ads": frozenset({"ads.example", "bad.example"})})
    blocklists.lookup_limiter.reset()
    yield TestClient(app)
    blocklists.set_lists({}, at=None)
    blocklists._loaded_at = None


def ask(client, domain, ip="203.0.113.5"):
    return client.post("/api/blocklist", json={"domain": domain}, headers=HEADERS | {"CF-Connecting-IP": ip})


def test_parse_keeps_the_plain_names():
    assert blocklists.parse(RPZ) == frozenset({"bad.example"})


def test_parse_165_cleans_the_entries():
    text = ("\ufeff民國年月,網域,網站性質,法律依據,聲請單位\n"
            "11509,Scam.Example,金融保險,詐欺犯罪危害防制條例,刑事警察局詐欺犯罪防制中心\n"
            "11509,?shop.example,電子商務,詐欺犯罪危害防制條例,刑事警察局詐欺犯罪防制中心\n"
            "11509,https://www.fake.example/login,電子商務,詐欺犯罪危害防制條例,刑事警察局詐欺犯罪防制中心\n"
            "11509,not a domain,電子商務,詐欺犯罪危害防制條例,刑事警察局詐欺犯罪防制中心\n")
    assert blocklists.parse_165(text) == frozenset({"scam.example", "shop.example", "www.fake.example"})


def test_parse_hosts_reads_a_name_a_line():
    text = "# a comment\nSpy.Example\nsync.spy.example\n\nnot a name\n"
    assert blocklists.parse_hosts(text) == frozenset({"spy.example", "sync.spy.example"})


def test_lookup_names_the_stalkerware_list(api):
    body = ask(api, "media.spy.example").json()
    assert {k: body[k] for k in ("malware", "tw165", "twmoda", "stalkerware", "ads")} == {
        "malware": False, "tw165": False, "twmoda": False, "stalkerware": True, "ads": False}


def test_lookup_names_the_cti_list(api):
    body = ask(api, "login.active.example").json()
    assert {k: body[k] for k in ("malware", "tw165", "twmoda", "stalkerware", "cti", "ads")} == {
        "malware": False, "tw165": False, "twmoda": False, "stalkerware": False, "cti": True, "ads": False}


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


def test_parse_moda_prefers_the_scam_urls_host_when_the_domain_field_disagrees():
    text = json.dumps([
        {"網域名稱": "shop.example", "偽冒網址": "https://www.shop.example/p#/login"},
        {"網域名稱": "aobeibi.example", "偽冒網址": "https://laobeibi.example/products/1"},
        {"網域名稱": "help@mail.example", "偽冒網址": ";http"},
        {"網域名稱": "parent.example", "偽冒網址": "https://pay.parent.example/x"},
    ], ensure_ascii=False)
    assert blocklists.parse_moda("\ufeff" + text) == frozenset({"shop.example", "laobeibi.example", "mail.example", "parent.example"})


def test_lookup_names_the_filters_that_block_a_site(api):
    r = ask(api, "https://cdn.bad.example/x.js")
    assert r.status_code == 200 and r.headers["cache-control"] == "no-store"
    assert {k: r.json()[k] for k in ("domain", "malware", "ads")} == {"domain": "cdn.bad.example", "malware": True, "ads": True}
    assert {k: ask(api, "ads.example").json()[k] for k in ("malware", "ads")} == {"malware": False, "ads": True}
    assert {k: ask(api, "good.example").json()[k] for k in ("malware", "ads")} == {"malware": False, "ads": False}
    # a parent of a listed name is not blocked
    assert ask(api, "example").status_code == 400
    assert ask(api, "notbad.example").json()["malware"] is False
    # the 165 list, subdomains included
    assert {k: ask(api, "www.scam.example").json()[k] for k in ("malware", "tw165", "twmoda", "ads")} == {
        "malware": False, "tw165": True, "twmoda": False, "ads": False}
    assert ask(api, "fakeshop.example").json()["twmoda"] is True


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


def test_only_the_165_download_relaxes_the_strict_certificate_check():
    relaxed, default = blocklists.tls_context("tw165"), blocklists.tls_context("malware")
    assert not relaxed.verify_flags & ssl.VERIFY_X509_STRICT
    assert relaxed.verify_mode == ssl.CERT_REQUIRED and relaxed.check_hostname
    assert default.verify_flags == ssl.create_default_context().verify_flags


def test_the_exclude_file_is_the_same_as_the_nodes():
    node = Path(__file__).parents[2] / "node" / "exclude.txt"
    api_copy = Path(blocklists.__file__).with_name("blocklist_exclude.txt")
    assert node.read_text(encoding="utf-8") == api_copy.read_text(encoding="utf-8")


def test_excluded_names_leave_out_the_reasons():
    text = "# a comment\nfrom-ia.com  # why\n\nGomLab.com\n"
    assert blocklists.excluded_names(text) == frozenset({"from-ia.com", "gomlab.com"})


def test_a_download_leaves_out_the_excluded_name_but_not_the_names_under_it(monkeypatch):
    names = [f"bad{i}.example" for i in range(blocklists.MIN_ENTRIES)] + ["keep.excluded.example", "excluded.example"]
    zone = "".join(f"{n} CNAME .\n*.{n} CNAME .\n" for n in names).encode()

    class Response:
        def __enter__(self):
            return self

        def __exit__(self, *_):
            return False

        def read(self):
            return zone

    monkeypatch.setattr(blocklists, "SOURCES", {"malware": "https://lists.example/malware"})
    monkeypatch.setattr(blocklists, "EXCLUDED", frozenset({"excluded.example"}))
    monkeypatch.setattr(blocklists.urllib.request, "urlopen", lambda *_, **__: Response())
    blocklists._download()
    try:
        assert blocklists.blocked_by("excluded.example") == {"malware": False}
        assert blocklists.blocked_by("keep.excluded.example") == {"malware": True}
    finally:
        blocklists.set_lists({}, at=None)
        blocklists._loaded_at = None


def test_the_hosting_platforms_are_the_private_section():
    text = "// ===BEGIN ICANN DOMAINS===\ncom\n// ===END ICANN DOMAINS===\n// ===BEGIN PRIVATE DOMAINS===\n// a platform\n" \
           "pages.dev\n*.Compute.Example-Cloud.com\n!exception.other-cloud.com\n// ===END PRIVATE DOMAINS===\n"
    assert blocklists.parse_platforms(text) == frozenset(
        {"pages.dev", "compute.example-cloud.com", "exception.other-cloud.com"})


def _serve(monkeypatch, files: dict[str, str]) -> None:
    class Response:
        def __init__(self, url: str):
            if url not in files:
                raise OSError("offline")
            self.body = files[url].encode()

        def __enter__(self):
            return self

        def __exit__(self, *_):
            return False

        def read(self):
            return self.body

    monkeypatch.setattr(blocklists.urllib.request, "urlopen", lambda request, **_: Response(request.full_url))


def test_every_public_suffix_is_both_sections():
    text = "// ===BEGIN ICANN DOMAINS===\ncom\nco.uk\n// ===END ICANN DOMAINS===\n// ===BEGIN PRIVATE DOMAINS===\n// a platform\n" \
           "pages.dev\n*.Compute.Example-Cloud.com\n!exception.other-cloud.com\n// ===END PRIVATE DOMAINS===\n"
    assert blocklists.parse_suffixes(text) == frozenset(
        {"com", "co.uk", "pages.dev", "compute.example-cloud.com", "exception.other-cloud.com"})


PSL = "// ===BEGIN ICANN DOMAINS===\ncom\nco.uk\n// ===END ICANN DOMAINS===\n// ===BEGIN PRIVATE DOMAINS===\npages.dev\n" \
      + "".join(f"p{i}.example\n" for i in range(1000))


def test_the_whole_cti_list_is_used_without_the_public_suffixes(monkeypatch):
    cti = "".join(f"site{i}.pages.dev\n" for i in range(60000)) + "own-site.example\nshop.co.uk\npages.dev\nco.uk\n"
    monkeypatch.setattr(blocklists, "SOURCES", {"cti": "https://lists.example/cti"})
    monkeypatch.setattr(blocklists, "_platforms", frozenset())
    _serve(monkeypatch, {blocklists.PUBLIC_SUFFIXES: PSL, "https://lists.example/cti": cti})
    blocklists._download()
    try:
        assert blocklists.blocked_by("site1.pages.dev") == {"cti": True}
        assert blocklists.blocked_by("www.own-site.example") == {"cti": True}
        assert blocklists.blocked_by("shop.co.uk") == {"cti": True}
        # a platform or a registry's suffix is never listed as a whole
        assert blocklists.blocked_by("other.pages.dev") == {"cti": False}
        assert blocklists.blocked_by("other.co.uk") == {"cti": False}
    finally:
        blocklists.set_lists({}, at=None)
        blocklists._loaded_at = None


def test_a_cti_list_too_long_for_the_nodes_is_cut_down_to_the_hosting_platforms(monkeypatch):
    platforms, suffixes = frozenset({"pages.dev"}), frozenset({"pages.dev", "com"})
    names = frozenset({"a.pages.dev", "login.a.pages.dev", "b.pages.dev", "own-site.example", "pages.dev"})
    # three names once a name under a listed one is left out, as the nodes count them
    monkeypatch.setattr(blocklists, "CTI_MAX_NAMES", 3)
    assert blocklists.cti_names(names, platforms, suffixes) == names - {"pages.dev"}
    monkeypatch.setattr(blocklists, "CTI_MAX_NAMES", 2)
    assert blocklists.cti_names(names, platforms, suffixes) == frozenset({"a.pages.dev", "login.a.pages.dev", "b.pages.dev"})


def test_cti_keeps_what_it_had_without_the_hosting_platforms(monkeypatch):
    blocklists.set_lists({"cti": frozenset({"old.pages.dev"})})
    monkeypatch.setattr(blocklists, "SOURCES", {"cti": "https://lists.example/cti"})
    monkeypatch.setattr(blocklists, "_platforms", frozenset())
    _serve(monkeypatch, {"https://lists.example/cti": "".join(f"site{i}.pages.dev\n" for i in range(60000))})
    blocklists._download()
    try:
        assert blocklists._lists["cti"] == frozenset({"old.pages.dev"})
    finally:
        blocklists.set_lists({}, at=None)
        blocklists._loaded_at = None


def test_the_summary_counts_what_each_list_adds(api):
    blocklists.set_lists({"malware": frozenset({"bad.example", "only.example"}), "tw165": frozenset({"scam.example"}),
                          "twmoda": frozenset({"sub.bad.example"}), "stalkerware": frozenset({"spy.example"}),
                          "ads": frozenset({"bad.example", "ads.example"})})
    body = api.get("/api/blocklist/lists").json()
    rows = {row["id"]: row for row in body["lists"]}
    assert rows["malware"] == {"id": "malware", "domains": 2, "only_here": 1}
    assert rows["tw165"] == {"id": "tw165", "domains": 1, "only_here": 1}
    # a parent on another list already blocks it
    assert rows["twmoda"] == {"id": "twmoda", "domains": 1, "only_here": 0}
    assert rows["stalkerware"] == {"id": "stalkerware", "domains": 1, "only_here": 1}
    assert rows["ads"] == {"id": "ads", "domains": 2, "only_here": 1}
    assert (body["malware_filter"], body["ads_filter"], body["hagezi"]) == (4, 5, 3)
    assert "as_of" in body


def test_the_summary_before_the_lists_arrive(api):
    blocklists._loaded_at = None
    assert api.get("/api/blocklist/lists").status_code == 503


def test_lookup_says_when_quad9_blocks(api, monkeypatch):
    # 9.9.9.10 is the same service without the filter
    answers = {"9.9.9.9": 3, "9.9.9.10": 0}
    monkeypatch.setattr(blocklists, "_rcode", lambda host, server, port=53: answers[server])
    assert ask(api, "phish.example").json()["quad9"] is True
    answers["9.9.9.10"] = 3  # it just does not exist
    assert ask(api, "gone.example").json()["quad9"] is False
    answers["9.9.9.9"] = None  # no answer
    assert ask(api, "phish.example").json()["quad9"] is None


def test_rcode_ignores_a_reply_with_another_id():
    server = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    server.bind(("127.0.0.1", 0))

    def answer():
        query, client_addr = server.recvfrom(512)
        server.sendto(bytes([query[0] ^ 0xFF, query[1], 0x81, 0x80]) + bytes(8), client_addr)
        server.sendto(query[:2] + bytes([0x81, 0x83]) + bytes(8), client_addr)

    threading.Thread(target=answer, daemon=True).start()
    assert REAL_RCODE("bad.example", "127.0.0.1", server.getsockname()[1]) == 3
    server.close()
