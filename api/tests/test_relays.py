"""Relay routes (anoni-net/vessel#136): a device made through a relay is a peer of the relay's region, and its
config's Endpoint is the relay's address. Addresses here are documentation ranges, never a real relay."""

from conftest import create, needs_db

from app import admin, worker

pytestmark = needs_db

RELAY = "203.0.113.20:51820"


def relay(db, rid="tw-sg", region="sg", endpoint=RELAY, is_open=True):
    db.execute("INSERT INTO relays (id, region_id, endpoint, is_open) VALUES (%s, %s, %s, %s)",
               (rid, region, endpoint, is_open))


def test_open_relays_of_open_regions_are_listed_without_their_address(signed_in, db):
    relay(db)
    relay(db, "tw-jp", "jp")  # jp is closed in the fixture
    relay(db, "tw-sg-2", is_open=False)
    listed = signed_in.get("/api/relays").json()
    assert listed == [{"id": "tw-sg", "region": "sg", "open": True}]
    assert "203.0.113" not in str(listed)


def test_a_relay_device_gets_the_relays_endpoint_and_the_nodes_keys(signed_in, node, db):
    relay(db)
    direct = create(signed_in).json()
    relayed = create(signed_in, name="laptop", relay="tw-sg").json()
    assert direct["config"]["peer"]["Endpoint"] == "198.51.100.1:443"
    assert relayed["config"]["peer"]["Endpoint"] == RELAY
    # everything else is the node's answer, as for a direct device
    for part in ("peer", "interface"):
        a, b = dict(direct["config"][part]), dict(relayed["config"][part])
        a.pop("Endpoint", None), b.pop("Endpoint", None)
        if part == "interface":
            a.pop("Address"), b.pop("Address")
        assert a == b
    # an ordinary peer of the region on the node
    assert set(node.peers) == {direct["id"], relayed["id"]}
    listed = {d["name"]: d["relay"] for d in signed_in.get("/api/devices").json()}
    assert listed == {"phone": None, "laptop": "tw-sg"}


def test_the_config_from_the_worker_path_is_rewritten_too(signed_in, node, db):
    relay(db)
    node.down = True
    body = create(signed_in, relay="tw-sg").json()
    assert body["status"] == "pending"
    node.down = False
    db.execute("UPDATE jobs SET next_try_at = now()")
    worker.tick(db)
    r = signed_in.get(f"/api/devices/{body['id']}/config")
    assert r.status_code == 200 and r.json()["config"]["peer"]["Endpoint"] == RELAY


def test_closed_unknown_and_other_regions_relays_are_refused(signed_in, node, db):
    relay(db, is_open=False)
    relay(db, "tw-jp", "jp")
    r = create(signed_in, relay="tw-sg")
    assert r.status_code == 400 and r.json() == {"error": "relay_closed"}
    r = create(signed_in, relay="nope")
    assert r.status_code == 400 and r.json() == {"error": "invalid_relay"}
    # a relay to Tokyo cannot make a device in Singapore
    r = create(signed_in, relay="tw-jp")
    assert r.status_code == 400 and r.json() == {"error": "invalid_relay"}
    assert db.execute("SELECT count(*) FROM devices").fetchone()[0] == 0


def test_admin_sets_and_lists_relays(db, capsys):
    db.execute("INSERT INTO regions (id, node_host, is_open) VALUES ('sg', 'node-sg', true)")
    admin.main(["relays", "set", "tw-sg", "--region", "sg", "--endpoint", RELAY, "--open"])
    admin.main(["relays", "set", "tw-sg", "--region", "sg", "--endpoint", "relay.example.net:4443", "--closed"])
    assert db.execute("SELECT region_id, endpoint, is_open FROM relays").fetchall() == [
        ("sg", "relay.example.net:4443", False)]
    out = capsys.readouterr().out
    assert "tw-sg  -> sg  relay.example.net:4443  closed  0 devices" in out
    for bad in (["--region", "sg", "--endpoint", "203.0.113.20", "--open"],
                ["--region", "sg", "--endpoint", "203.0.113.20:70000", "--open"],
                ["--region", "xx", "--endpoint", RELAY, "--open"]):
        try:
            admin.main(["relays", "set", "tw-x", *bad])
        except SystemExit as e:
            assert e.code
        else:
            raise AssertionError(bad)


def test_moving_a_region_leaves_relay_devices_alone_and_names_the_relays(signed_in, node, db, capsys):
    relay(db)
    create(signed_in)
    create(signed_in, name="laptop", relay="tw-sg")
    admin.main(["regions", "move", "sg", "--node-host", "node-sg-2", "--exit-ip", "203.0.113.7", "--until", "2999-01-01"])
    moved = {d["name"]: d["moved_until"] for d in signed_in.get("/api/devices").json()}
    assert moved["phone"] == "2999-01-01" and moved["laptop"] is None
    assert "relay tw-sg forwards to sg: point its forward at 203.0.113.7 by hand" in capsys.readouterr().out
