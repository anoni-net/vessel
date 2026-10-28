from conftest import HEADERS, create, needs_db

from app import jobs, policy, worker

pytestmark = needs_db
GB = 10**9


def used(client) -> int:
    return client.get("/api/me").json()["used_bytes"]


def test_usage_accumulates_deltas(signed_in, node, db):
    device_id = create(signed_in).json()["id"]
    node.counters[device_id] = (100, 400)
    worker.tick(db)
    assert used(signed_in) == 500
    node.counters[device_id] = (150, 450)
    worker.tick(db)
    assert used(signed_in) == 600
    worker.tick(db)
    assert used(signed_in) == 600


def test_counter_resets_are_new_traffic(signed_in, node, db):
    device_id = create(signed_in).json()["id"]
    node.counters[device_id] = (1000, 1000)
    worker.tick(db)
    # the node's container restarted
    node.started = "2026-10-28T00:00:00Z"
    node.counters[device_id] = (10, 20)
    worker.tick(db)
    assert used(signed_in) == 2030
    # the peer was re-added without a restart
    node.counters[device_id] = (5, 5)
    worker.tick(db)
    assert used(signed_in) == 2040


def test_usage_is_per_account_and_survives_device_deletion(signed_in, node, db):
    a = create(signed_in, name="a").json()["id"]
    b = create(signed_in, name="b").json()["id"]
    node.counters[a] = (GB, 0)
    node.counters[b] = (0, GB)
    worker.tick(db)
    assert used(signed_in) == 2 * GB
    signed_in.delete(f"/api/devices/{a}", headers=HEADERS)
    worker.tick(db)
    assert used(signed_in) == 2 * GB


def test_unknown_peers_and_down_nodes_are_skipped(signed_in, node, db):
    node.peers["phone"] = {}
    node.counters["phone"] = (GB, GB)
    worker.tick(db)
    assert db.execute("SELECT count(*) FROM account_usage").fetchone()[0] == 0
    node.down = True
    worker.tick(db)


def test_quota_suspends_and_next_month_resumes(signed_in, node, db):
    device_id = create(signed_in).json()["id"]
    node.counters[device_id] = (policy.MONTHLY_QUOTA_BYTES, 0)
    worker.tick(db)
    assert device_id in node.suspended and device_id not in node.peers
    assert signed_in.get("/api/devices").json()[0]["status"] == "suspended"
    # a new month: this month's usage starts at zero
    db.execute("UPDATE account_usage SET period = period - interval '1 month'")
    worker.tick(db)
    assert device_id in node.peers
    assert signed_in.get("/api/devices").json()[0]["status"] == "active"
    # the resumed peer's counters start over and count as new traffic
    node.counters[device_id] = (GB, 0)
    worker.tick(db)
    assert used(signed_in) == GB


def test_suspended_devices_can_be_deleted_and_expire(signed_in, node, db):
    a = create(signed_in, name="a").json()["id"]
    b = create(signed_in, name="b").json()["id"]
    node.counters[a] = (policy.MONTHLY_QUOTA_BYTES, 0)
    worker.tick(db)
    assert {a, b} <= set(node.suspended)
    signed_in.delete(f"/api/devices/{a}", headers=HEADERS)
    assert a not in node.suspended
    db.execute("UPDATE devices SET expires_on = current_date - 1")
    worker.tick(db)
    assert node.suspended == {} and node.peers == {}
    assert db.execute("SELECT count(*) FROM devices").fetchone()[0] == 0


def test_resume_of_a_deleted_device_is_dropped(signed_in, node, db):
    device_id = create(signed_in).json()["id"]
    node.counters[device_id] = (policy.MONTHLY_QUOTA_BYTES, 0)
    worker.tick(db)
    db.execute("UPDATE account_usage SET period = period - interval '1 month'")
    jobs.enforce_quota(db, policy.MONTHLY_QUOTA_BYTES)
    db.execute("UPDATE devices SET status = 'revoking'")
    jobs.run_due_jobs(db)
    assert db.execute("SELECT status FROM jobs WHERE action = 'resume'").fetchone()[0] == "done"


def devices(client) -> dict:
    return {d["id"]: d for d in client.get("/api/devices").json()}


def test_each_device_shows_its_own_month(signed_in, node, db):
    phone = create(signed_in).json()["id"]
    laptop = create(signed_in, name="laptop").json()["id"]
    node.counters[phone] = (100, 400)
    node.blocked[phone] = 3
    worker.tick(db)
    node.counters[phone] = (150, 450)
    node.blocked[phone] = 5
    node.counters[laptop] = (10, 10)
    worker.tick(db)
    d = devices(signed_in)
    assert (d[phone]["used_bytes"], d[phone]["blocked"]) == (600, 5)
    assert (d[laptop]["used_bytes"], d[laptop]["blocked"]) == (20, 0)
    assert used(signed_in) == 620
    # the node restarted: its counters start over and all of it is new
    node.started = "2026-10-28T00:00:00Z"
    node.counters[phone] = (1, 1)
    node.blocked[phone] = 2
    worker.tick(db)
    assert devices(signed_in)[phone]["blocked"] == 7


def test_past_months_are_not_kept(signed_in, node, db):
    phone = create(signed_in).json()["id"]
    node.counters[phone] = (100, 100)
    node.blocked[phone] = 4
    worker.tick(db)
    db.execute("UPDATE device_usage SET period = period - interval '1 month'")
    worker.tick(db)
    assert db.execute("SELECT count(*) FROM device_usage").fetchone()[0] == 0
    assert (devices(signed_in)[phone]["used_bytes"], devices(signed_in)[phone]["blocked"]) == (0, 0)


def test_nodes_without_blocked_counts_still_work(signed_in, node, db):
    phone = create(signed_in).json()["id"]
    node.counters[phone] = (100, 100)
    original = node.usage

    def old_usage(host):
        data = original(host)
        for p in data["peers"]:
            p.pop("blocked")
        return data

    node.usage = old_usage
    worker.tick(db)
    assert (devices(signed_in)[phone]["used_bytes"], devices(signed_in)[phone]["blocked"]) == (200, 0)
