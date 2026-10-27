from conftest import HEADERS, create, key, make_invite, needs_db

from app import jobs, worker

pytestmark = needs_db


def test_create_device_returns_config_once(signed_in, node, db):
    r = create(signed_in)
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "active" and body["config"]["interface"]["Address"] == "10.8.1.2/32"
    assert node.peers[body["id"]]["dns_filter"] == "ads"
    # nothing in the config came from the private key, and the backend never stored one
    assert "PrivateKey" not in body["config"]["interface"]
    assert signed_in.get(f"/api/devices/{body['id']}/config").status_code == 410
    assert db.execute("SELECT payload, result FROM jobs").fetchall() == [(None, None)]
    listed = signed_in.get("/api/devices").json()
    assert [(d["name"], d["status"], d["dns_filter"]) for d in listed] == [("phone", "active", "ads")]


def test_node_down_then_worker_finishes(signed_in, node, db):
    node.down = True
    r = create(signed_in)
    assert r.status_code == 202 and r.json()["status"] == "pending"
    device_id = r.json()["id"]
    assert signed_in.get(f"/api/devices/{device_id}/config").status_code == 202
    node.down = False
    db.execute("UPDATE jobs SET next_try_at = now()")
    worker.tick(db)
    r = signed_in.get(f"/api/devices/{device_id}/config")
    assert r.status_code == 200 and r.json()["config"]["peer"]["Endpoint"] == "198.51.100.1:443"
    assert signed_in.get(f"/api/devices/{device_id}/config").status_code == 410


def test_lost_answer_is_retried_cleanly(signed_in, node, db):
    node.down = True
    device_id = create(signed_in).json()["id"]
    # the node got the peer but the answer never came back
    node.down = False
    node.peers[device_id] = {"public_key": "stale"}
    db.execute("UPDATE jobs SET next_try_at = now()")
    worker.tick(db)
    assert signed_in.get(f"/api/devices/{device_id}/config").status_code == 200
    assert node.peers[device_id]["public_key"] != "stale"


def test_job_gives_up_after_max_attempts(signed_in, node, db):
    node.down = True
    device_id = create(signed_in).json()["id"]
    for _ in range(jobs.MAX_ATTEMPTS):
        db.execute("UPDATE jobs SET next_try_at = now()")
        worker.tick(db)
    r = signed_in.get(f"/api/devices/{device_id}/config")
    assert r.status_code == 502 and r.json() == {"error": "node_failed"}
    assert db.execute("SELECT payload FROM jobs").fetchone()[0] is None


def test_limits(signed_in, node, db):
    for i in range(3):
        assert create(signed_in, name=f"d{i}").status_code == 200
    r = create(signed_in, name="d3")
    assert r.status_code == 409 and r.json() == {"error": "device_limit"}


def test_validation(signed_in, node):
    assert create(signed_in, region="jp").json() == {"error": "region_closed"}
    assert create(signed_in, public_key="nope").json() == {"error": "invalid_key"}
    assert create(signed_in, name="   ").json() == {"error": "invalid_name"}
    assert create(signed_in, dns_filter="all").status_code == 422
    same = key()
    assert create(signed_in, public_key=same).status_code == 200
    assert create(signed_in, public_key=same).json() == {"error": "key_in_use"}


def test_quota(signed_in, node, db):
    account_id = db.execute("SELECT id FROM accounts").fetchone()[0]
    db.execute(
        "INSERT INTO account_usage (account_id, period, rx_bytes, tx_bytes) "
        "VALUES (%s, date_trunc('month', current_date), 50000000000, 0)",
        (account_id,),
    )
    assert create(signed_in).json() == {"error": "quota_exceeded"}


def test_delete_device(signed_in, node, db):
    device_id = create(signed_in).json()["id"]
    assert signed_in.delete(f"/api/devices/{device_id}", headers=HEADERS).status_code == 200
    assert device_id not in node.peers
    assert signed_in.get("/api/devices").json() == []


def test_other_accounts_devices_are_invisible(signed_in, node, db, client):
    device_id = create(signed_in).json()["id"]
    signed_in.post("/api/logout", headers=HEADERS)
    client.post("/api/redeem", json={"code": make_invite(db)}, headers=HEADERS)
    assert client.get(f"/api/devices/{device_id}/config").status_code == 404
    assert client.delete(f"/api/devices/{device_id}", headers=HEADERS).status_code == 404
    assert client.get("/api/devices").json() == []


def test_expired_devices_are_removed(signed_in, node, db):
    device_id = create(signed_in).json()["id"]
    db.execute("UPDATE devices SET expires_on = current_date - 1")
    worker.tick(db)
    assert device_id not in node.peers
    assert db.execute("SELECT count(*) FROM devices").fetchone()[0] == 0


def test_account_deletion_cleans_the_node(signed_in, node, db):
    device_id = create(signed_in).json()["id"]
    signed_in.delete("/api/account", headers=HEADERS)
    worker.tick(db)
    assert device_id not in node.peers


def test_regions_hide_node_hosts(signed_in):
    assert signed_in.get("/api/regions").json() == [{"id": "jp", "open": False}, {"id": "sg", "open": True}]
