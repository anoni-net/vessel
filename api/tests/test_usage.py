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
            p.pop("blocked_ads")
        return data

    node.usage = old_usage
    worker.tick(db)
    assert (devices(signed_in)[phone]["used_bytes"], devices(signed_in)[phone]["blocked"]) == (200, 0)


def month(db) -> list[tuple]:
    return db.execute("SELECT rx_bytes + tx_bytes, blocked, blocked_ads FROM account_usage ORDER BY period").fetchall()


def test_the_two_lists_are_counted_apart(signed_in, node, db):
    phone = create(signed_in).json()["id"]
    node.blocked[phone], node.blocked_ads[phone] = 2, 30
    worker.tick(db)
    node.blocked[phone], node.blocked_ads[phone] = 3, 45
    worker.tick(db)
    # the device list shows both together, the account's month keeps them apart
    assert devices(signed_in)[phone]["blocked"] == 48
    assert month(db) == [(0, 3, 45)]
    # blocked lookups alone, with no traffic counted yet, still make the month
    node.started = "2026-10-28T00:00:00Z"
    node.blocked[phone], node.blocked_ads[phone] = 0, 5
    worker.tick(db)
    assert month(db) == [(0, 3, 50)]


def test_account_months_are_kept_for_a_year(signed_in, node, db):
    phone = create(signed_in).json()["id"]
    node.counters[phone] = (100, 100)
    node.blocked[phone] = 1
    worker.tick(db)
    account = db.execute("SELECT account_id FROM account_usage").fetchone()[0]
    for back in (11, 12):
        db.execute(
            "INSERT INTO account_usage (account_id, period, rx_bytes, tx_bytes, blocked, blocked_ads) "
            "VALUES (%s, date_trunc('month', current_date) - make_interval(months => %s), 1, 1, 1, 1)",
            (account, back),
        )
    worker.tick(db)
    kept = db.execute(
        "SELECT (extract(year FROM age(date_trunc('month', current_date), period)) * 12 "
        "+ extract(month FROM age(date_trunc('month', current_date), period)))::int FROM account_usage ORDER BY period"
    ).fetchall()
    assert [k[0] for k in kept] == [11, 0]


def test_usage_says_when_it_was_read(signed_in, node, db):
    assert signed_in.get("/api/me").json()["usage_as_of"] is None  # no devices yet
    create(signed_in)
    assert signed_in.get("/api/me").json()["usage_as_of"] is None  # the worker has not read the node
    worker.tick(db)
    at = db.execute("SELECT at FROM heartbeats WHERE name = 'usage:sg'").fetchone()[0]
    assert signed_in.get("/api/me").json()["usage_as_of"] == at.isoformat()
    # a node that cannot be reached keeps the time of the last read
    node.down = True
    worker.tick(db)
    assert signed_in.get("/api/me").json()["usage_as_of"] == at.isoformat()


def daily(db) -> list[tuple]:
    return db.execute(
        "SELECT region_id, active_devices, rx_bytes + tx_bytes, expired_devices FROM daily_stats "
        "WHERE day = current_date AND region_id = 'sg'"
    ).fetchall()


def test_daily_stats_count_devices_seen_today_and_the_traffic(signed_in, node, db):
    import time as clock

    phone = create(signed_in).json()["id"]
    laptop = create(signed_in, name="laptop").json()["id"]
    create(signed_in, name="tablet")
    node.handshakes[phone] = int(clock.time()) - 60
    node.handshakes[laptop] = int(clock.time()) - 3 * 86400  # connected days ago, not today
    node.counters[phone] = (100, 400)
    worker.tick(db)
    assert daily(db) == [("sg", 1, 500, 0)]
    node.counters[phone] = (150, 450)
    node.handshakes[laptop] = int(clock.time()) - 5
    worker.tick(db)
    assert daily(db) == [("sg", 2, 600, 0)]
    # a node restart forgets the handshakes; the day keeps its highest count
    node.started = "2026-10-28T00:00:00Z"
    node.handshakes.clear()
    node.counters[phone] = (0, 0)
    worker.tick(db)
    assert daily(db) == [("sg", 2, 600, 0)]


def test_daily_stats_count_expired_devices_and_drop_old_days(signed_in, node, db):
    create(signed_in)
    db.execute("UPDATE devices SET expires_on = current_date - 1")
    worker.tick(db)
    assert daily(db) == [("sg", 0, 0, 1)]
    db.execute("INSERT INTO daily_stats (day, region_id) VALUES (current_date - 401, 'sg')")
    worker.tick(db)
    assert db.execute("SELECT count(*) FROM daily_stats WHERE day < current_date - 400").fetchone()[0] == 0


def test_report_prints_totals_only(signed_in, node, db, capsys):
    from app import admin

    phone = create(signed_in).json()["id"]
    create(signed_in, name="laptop", dns_filter="none")
    node.counters[phone] = (1_000_000, 2_000_000)
    node.handshakes[phone] = 1_700_000_000
    worker.tick(db)
    db.execute("UPDATE devices SET created_on = current_date - 2")
    admin.report(db, 14)
    out = capsys.readouterr().out
    assert "devices that have connected at least once: 1 of 2 (created in the last 7 days: 1 of 2)" in out
    assert "accounts: with a device 1, with a device that connected 1, of 1" in out
    assert "accounts: 1 (new in the last 7 days: 1)" in out
    assert "by filter: ads 1, none 1" in out
    assert "devices older than a day with no traffic this month: 1" in out
    assert "traffic this month: sg 3.0 MB (total 3.0 MB)" in out
    assert "phone" not in out and "laptop" not in out  # no device names


def test_devices_remember_that_they_connected(signed_in, node, db):
    phone = create(signed_in).json()["id"]
    create(signed_in, name="laptop")
    connected = lambda: {d["name"]: d["connected"] for d in signed_in.get("/api/devices").json()}
    worker.tick(db)
    assert connected() == {"phone": False, "laptop": False}
    node.handshakes[phone] = 1_700_000_000
    worker.tick(db)
    assert connected() == {"phone": True, "laptop": False}
    # a node restart forgets the handshake; the device stays connected
    node.handshakes.clear()
    worker.tick(db)
    assert connected() == {"phone": True, "laptop": False}
