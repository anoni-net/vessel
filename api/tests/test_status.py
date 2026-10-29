from conftest import needs_db

from app import admin

pytestmark = needs_db


def beat(db, name, seconds_ago):
    db.execute("INSERT INTO heartbeats (name, at) VALUES (%s, now() - make_interval(secs => %s)) "
               "ON CONFLICT (name) DO UPDATE SET at = EXCLUDED.at", (name, seconds_ago))


def test_open_regions_are_ok_down_or_unknown(client, db):
    db.execute("INSERT INTO regions (id, node_host, is_open) VALUES ('sg', 'n', true), ('jp', 'n', true), "
               "('tw', 'n', false)")
    # no worker yet
    r = client.get("/api/status")
    assert r.headers["cache-control"] == "no-store"
    assert r.json()["regions"] == [{"id": "jp", "state": "unknown"}, {"id": "sg", "state": "unknown"}]
    beat(db, "worker", 10)
    beat(db, "usage:sg", 60)
    beat(db, "usage:jp", 25 * 60)
    assert client.get("/api/status").json()["regions"] == [{"id": "jp", "state": "down"}, {"id": "sg", "state": "ok"}]
    beat(db, "worker", 10 * 60)
    assert {r["state"] for r in client.get("/api/status").json()["regions"]} == {"unknown"}


def test_notices_of_the_last_30_days_newest_first(client, db, capsys):
    db.execute("INSERT INTO regions (id, node_host, is_open) VALUES ('sg', 'n', true)")
    admin.main(["notices", "add", "sg", "restart", "--start", "2000-01-01T00:00:00Z", "--minutes", "1"])
    admin.main(["notices", "add", "all", "maintenance", "--minutes", "30"])
    admin.main(["notices", "add", "sg", "outage"])
    notices = client.get("/api/status").json()["notices"]
    assert [(n["region"], n["kind"]) for n in notices] == [("sg", "outage"), (None, "maintenance")]
    assert notices[0]["ends_at"] is None and notices[1]["ends_at"] is not None
    outage = db.execute("SELECT id FROM notices WHERE kind = 'outage'").fetchone()[0]
    admin.main(["notices", "end", str(outage)])
    assert client.get("/api/status").json()["notices"][0]["ends_at"] is not None
    admin.main(["notices", "delete", str(outage)])
    assert [n["kind"] for n in client.get("/api/status").json()["notices"]] == ["maintenance"]
    assert "all  maintenance" in capsys.readouterr().out
