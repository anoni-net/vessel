import pytest
from fastapi.testclient import TestClient

from app import network
from app.main import app

ROWS = """1.0.0.0\t1.0.0.255\t64500\tTW\tFIRST - First Network
1.0.1.0\t1.0.1.255\t0\tNone\tNot routed
8.8.8.0\t8.8.8.255\t64501\tUS\tSECOND
2001:db8::\t2001:db8:0:ffff:ffff:ffff:ffff:ffff\t64502\tJP\tTHIRD
"""


@pytest.fixture
def api(monkeypatch):
    monkeypatch.setattr(network, "_table", network.parse_table(ROWS))
    monkeypatch.setattr(network, "_table_at", 1e12)
    monkeypatch.setattr(network, "_cache", {})
    network.network_limiter.reset()
    return TestClient(app)


def ask(client, ip):
    return client.get("/api/network", headers={"CF-Connecting-IP": ip})


def result(ok=0, anomaly=0, confirmed=0):
    return {"measurement_count": ok + anomaly + confirmed, "ok_count": ok, "anomaly_count": anomaly, "confirmed_count": confirmed}


def test_table_finds_the_network():
    table = network.parse_table(ROWS)
    assert table.lookup("1.0.0.7") == 64500
    assert table.lookup("::ffff:8.8.8.8") == 64501
    assert table.lookup("2001:db8::1") == 64502
    assert table.lookup("1.0.1.1") is None
    assert table.lookup("9.9.9.9") is None
    assert table.lookup("2001:db9::1") is None
    assert table.lookup("not an address") is None
    assert table.names[64500] == "FIRST - First Network"


@pytest.mark.parametrize(("measured", "expected"), [
    (None, "unknown"), (result(ok=9), "few"), (result(ok=95, anomaly=5), "ok"), (result(ok=86, anomaly=14), "ok"),
    (result(ok=85, anomaly=15), "some"), (result(ok=51, anomaly=49), "some"), (result(ok=50, anomaly=50), "most"),
    (result(ok=1, anomaly=90, confirmed=9), "most"),
])
def test_level(measured, expected):
    assert network.level(measured) == expected


def test_only_the_network_number_goes_to_ooni(api, monkeypatch):
    asked = []

    def measure(asn, test):
        asked.append((asn, test))
        return result(ok=95, anomaly=4, confirmed=1)

    monkeypatch.setattr(network, "_measure", measure)
    r = ask(api, "1.0.0.7")
    assert r.headers["cache-control"] == "no-store"
    body = r.json()
    assert body["asn"] == 64500
    assert body["name"] == "FIRST - First Network"
    assert [t["id"] for t in body["tests"]] == list(network.TESTS)
    assert body["tests"][0] == {"id": "web_connectivity", "level": "ok", "measurements": 100, "anomaly_pct": 5, "confirmed": 1}
    assert {a for a, _ in asked} == {64500}
    # the next visitor on that network gets the same answer without asking again
    count = len(asked)
    assert ask(api, "1.0.0.8").json() == body
    assert len(asked) == count


def test_a_failed_answer_is_not_kept_for_long(api, monkeypatch):
    monkeypatch.setattr(network, "_measure", lambda asn, test: None)
    assert {t["level"] for t in ask(api, "1.0.0.7").json()["tests"]} == {"unknown"}
    assert network._cache[64500][0] - network.time.time() <= network.CACHE_FAILED_SECONDS


def test_an_unknown_network_or_a_table_still_loading_says_so(api, monkeypatch):
    assert ask(api, "9.9.9.9").json() == {"asn": None, "name": None, "tests": [], "days": network.DAYS}
    monkeypatch.setattr(network, "_table", None)
    assert ask(api, "1.0.0.7").json()["asn"] is None


def test_rate_limited(api, monkeypatch):
    monkeypatch.setattr(network, "_measure", lambda asn, test: result(ok=50))
    for _ in range(network.network_limiter.limit):
        assert ask(api, "1.0.0.7").status_code == 200
    assert ask(api, "1.0.0.7").status_code == 429
