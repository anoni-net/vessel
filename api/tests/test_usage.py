from datetime import date, timedelta

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


def test_over_the_quota_a_device_is_slowed_down_until_next_month(signed_in, node, db):
    device_id = create(signed_in).json()["id"]
    node.counters[device_id] = (policy.MONTHLY_QUOTA_BYTES, 0)
    worker.tick(db)
    # still online, at a low speed
    assert device_id in node.peers and device_id in node.throttled
    d = signed_in.get("/api/devices").json()[0]
    assert (d["status"], d["throttled"]) == ("active", True)
    # no new device while over
    assert create(signed_in, name="laptop").json() == {"error": "quota_exceeded"}
    # a new month: this month's usage starts at zero
    db.execute("UPDATE account_usage SET period = period - interval '1 month'")
    worker.tick(db)
    assert device_id in node.peers and device_id not in node.throttled
    assert signed_in.get("/api/devices").json()[0]["throttled"] is False


def test_slowed_devices_can_be_deleted_and_expire(signed_in, node, db):
    a = create(signed_in, name="a").json()["id"]
    b = create(signed_in, name="b").json()["id"]
    node.counters[a] = (policy.MONTHLY_QUOTA_BYTES, 0)
    worker.tick(db)
    assert {a, b} <= node.throttled
    signed_in.delete(f"/api/devices/{a}", headers=HEADERS)
    assert a not in node.throttled and a not in node.peers
    db.execute("UPDATE devices SET expires_on = current_date - 1")
    worker.tick(db)
    assert node.throttled == set() and node.peers == {}
    assert db.execute("SELECT count(*) FROM devices").fetchone()[0] == 0


def test_an_unthrottle_of_a_deleted_device_is_dropped(signed_in, node, db):
    device_id = create(signed_in).json()["id"]
    node.counters[device_id] = (policy.MONTHLY_QUOTA_BYTES, 0)
    worker.tick(db)
    db.execute("UPDATE account_usage SET period = period - interval '1 month'")
    jobs.enforce_quota(db, policy.MONTHLY_QUOTA_BYTES)
    db.execute("UPDATE devices SET status = 'revoking'")
    jobs.run_due_jobs(db)
    assert db.execute("SELECT status FROM jobs WHERE action = 'unthrottle'").fetchone()[0] == "done"


def over_the_quota(db, device_id: str) -> None:
    db.execute(
        "INSERT INTO account_usage (account_id, period, rx_bytes, tx_bytes) "
        "SELECT account_id, date_trunc('month', current_date), %s, 0 FROM devices WHERE id = %s",
        (policy.MONTHLY_QUOTA_BYTES, device_id),
    )


def test_a_throttle_that_waited_past_a_new_month_is_dropped(signed_in, node, db):
    device_id = create(signed_in).json()["id"]
    over_the_quota(db, device_id)
    node.down = True
    jobs.enforce_quota(db, policy.MONTHLY_QUOTA_BYTES)
    jobs.run_due_jobs(db)
    # the node did not answer, and the throttle waits; then the month is over
    assert db.execute("SELECT status FROM jobs WHERE action = 'throttle'").fetchone()[0] == "queued"
    db.execute("UPDATE account_usage SET period = period - interval '1 month'")
    jobs.enforce_quota(db, policy.MONTHLY_QUOTA_BYTES)
    node.down = False
    db.execute("UPDATE jobs SET next_try_at = now()")
    jobs.run_due_jobs(db)
    assert device_id not in node.throttled
    assert {r[0] for r in db.execute("SELECT status FROM jobs WHERE action IN ('throttle', 'unthrottle')")} == {"done"}


def test_a_device_suspended_before_comes_back_online_slowed_down(signed_in, node, db):
    device_id = create(signed_in).json()["id"]
    over_the_quota(db, device_id)
    # how the worker used to leave it
    db.execute("UPDATE devices SET status = 'suspended'")
    node.suspend("node-sg", device_id)
    worker.tick(db)
    assert device_id in node.peers and device_id in node.throttled
    assert signed_in.get("/api/devices").json()[0]["status"] == "active"


def test_a_device_suspended_before_and_now_under_the_quota_comes_back_at_full_speed(signed_in, node, db):
    device_id = create(signed_in).json()["id"]
    db.execute("UPDATE devices SET status = 'suspended'")
    node.suspend("node-sg", device_id)
    worker.tick(db)
    assert device_id in node.peers and device_id not in node.throttled


def test_a_node_that_restarted_gets_its_speed_limits_back(signed_in, node, db):
    device_id = create(signed_in).json()["id"]
    node.counters[device_id] = (policy.MONTHLY_QUOTA_BYTES, 0)
    worker.tick(db)
    # the container restarted: the rules are gone and the counters start over
    node.throttled.clear()
    node.started = "2026-10-28T00:00:00Z"
    node.counters[device_id] = (0, 0)
    worker.tick(db)
    assert device_id in node.throttled
    # and a limit the device should not have is taken off
    db.execute("UPDATE account_usage SET period = period - interval '1 month'")
    worker.tick(db)
    node.throttled.add(device_id)
    worker.tick(db)
    assert device_id not in node.throttled


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
    # the phone had traffic this month, and its last handshake is long ago
    assert "active accounts: with traffic this month 1, connected in the last 24 hours 0\n" in out


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


def test_monthly_record_lists_every_month_since_the_account_was_made(signed_in, db):
    this = date.today().replace(day=1)
    last = (this - timedelta(days=1)).replace(day=1)
    db.execute("UPDATE accounts SET created_on = date_trunc('month', current_date) - interval '2 months' + interval '9 days'")
    account = db.execute("SELECT id FROM accounts").fetchone()[0]
    db.execute(
        "INSERT INTO account_usage (account_id, period, rx_bytes, tx_bytes, blocked, blocked_ads) "
        "VALUES (%s, %s, 3, 4, 5, 60), (%s, %s, 1, 1, 9, 9)",
        (account, last, account, (last - timedelta(days=1)).replace(day=1)),
    )
    body = signed_in.get("/api/usage/months").json()
    assert body["filter"] == "none"
    # a month with no use at all is still listed, so nobody wonders where it went
    assert [(m["used_bytes"], m["blocked"], m["blocked_ads"]) for m in body["months"]] == [(0, 0, 0), (7, 5, 60), (2, 9, 9)]
    assert body["months"][0]["month"] == this.isoformat()


def test_monthly_record_keeps_twelve_months_and_names_the_strongest_filter(signed_in, db):
    db.execute("UPDATE accounts SET created_on = current_date - 1000")
    create(signed_in, dns_filter="malware")
    body = signed_in.get("/api/usage/months").json()
    assert (len(body["months"]), body["filter"]) == (12, "malware")
    create(signed_in, name="laptop", dns_filter="ads")
    assert signed_in.get("/api/usage/months").json()["filter"] == "ads"
    signed_in.post("/api/logout", headers=HEADERS)
    assert signed_in.get("/api/usage/months").status_code == 401


def test_the_quota_follows_the_setting(signed_in, node, db):
    db.execute("UPDATE settings SET value = '100' WHERE key = 'monthly_quota_gb'")
    device_id = create(signed_in).json()["id"]
    node.counters[device_id] = (policy.MONTHLY_QUOTA_BYTES, 0)
    worker.tick(db)
    # 50 GB is under a quota of 100
    assert device_id in node.peers
    assert signed_in.get("/api/me").json()["monthly_quota_bytes"] == 100 * GB
    # lowered below what was used: slowed down on the next tick
    db.execute("UPDATE settings SET value = '40' WHERE key = 'monthly_quota_gb'")
    worker.tick(db)
    assert device_id in node.throttled


def test_a_quota_setting_that_is_not_a_positive_number_keeps_the_default(db):
    for value in ("", "0", "-5", "fifty"):
        db.execute("UPDATE settings SET value = %s WHERE key = 'monthly_quota_gb'", (value,))
        assert policy.personal_quota(db) == policy.MONTHLY_QUOTA_BYTES


def test_failing_reads_handshakes_that_did_not_complete():
    read = 1_800_000_000.0
    # received something, and the last handshake is too old for it to be data: handshakes that went nowhere
    assert jobs.failing(0, 148, read)
    assert jobs.failing(int(read) - 1000, 148, read)
    # a session made shortly before the last reading could still carry data
    assert not jobs.failing(int(read) - 100, 148, read)
    # nothing received: the device is off, or its own packets never reach the node
    assert not jobs.failing(0, 0, read)
    # no reading before this one to count from
    assert not jobs.failing(0, 148, None)


def failing_today(db) -> int:
    return db.execute("SELECT failing_devices FROM daily_stats WHERE day = current_date AND region_id = 'sg'").fetchone()[0]


def test_daily_stats_count_devices_that_keep_failing_to_connect(signed_in, node, db):
    import time as clock

    never = create(signed_in).json()["id"]
    dropped = create(signed_in, name="laptop").json()["id"]
    fine = create(signed_in, name="tablet").json()["id"]
    node.handshakes[dropped] = int(clock.time()) - 1000
    node.handshakes[fine] = int(clock.time()) - 60
    for d in (never, dropped, fine):
        node.counters[d] = (1000, 1000)
    worker.tick(db)
    # the first reading has nothing to count from
    assert failing_today(db) == 0
    # handshakes keep arriving from two of them; the third is connected and sending data
    for d in (never, dropped, fine):
        node.counters[d] = (1500, 2000)
    worker.tick(db)
    assert failing_today(db) == 2
    # one gives up: the day keeps its most at once
    node.counters[never] = (1700, 2400)
    worker.tick(db)
    assert failing_today(db) == 2
    # after a node restart the counters start over and say nothing yet
    node.started = "2026-10-28T00:00:00Z"
    node.counters[never] = (100, 100)
    db.execute("UPDATE daily_stats SET failing_devices = 0")
    worker.tick(db)
    assert failing_today(db) == 0


def test_report_prints_the_failing_devices(signed_in, node, db, capsys):
    from app import admin

    create(signed_in)
    worker.tick(db)
    db.execute("UPDATE daily_stats SET failing_devices = 3")
    admin.report(db, 2)
    assert db.execute("SELECT current_date").fetchone()[0].isoformat() + "  sg" in capsys.readouterr().out


def test_a_device_that_keeps_failing_to_connect_says_so_until_it_connects(signed_in, node, db):
    import time as clock

    phone = create(signed_in).json()["id"]
    node.counters[phone] = (1000, 1000)
    worker.tick(db)

    def failing() -> bool:
        return signed_in.get("/api/devices").json()[0]["failing"]

    assert failing() is False
    node.counters[phone] = (1300, 1800)
    worker.tick(db)
    assert failing() is True
    # it gives up: still said, the last try did not work
    worker.tick(db)
    assert failing() is True
    # a handshake since the last reading: connected
    node.handshakes[phone] = int(clock.time()) + 1
    worker.tick(db)
    assert failing() is False


def test_report_counts_the_accounts_connected_in_the_last_day(signed_in, node, db, capsys):
    import time as clock

    from app import admin

    phone = create(signed_in).json()["id"]
    laptop = create(signed_in, name="laptop").json()["id"]
    # another account, whose device connected two days ago
    other = db.execute("INSERT INTO accounts (number_hash) VALUES ('\\x01') RETURNING id").fetchone()[0]
    db.execute("INSERT INTO devices (id, account_id, region_id, name, public_key, tunnel_address, dns_filter, status, "
               "expires_on) SELECT 'd-otheraccount', %s, region_id, 'tablet', 'k', '10.8.1.99', dns_filter, 'active', "
               "expires_on FROM devices WHERE id = %s", (other, phone))
    node.peers["d-otheraccount"] = {}
    now = int(clock.time())
    node.handshakes.update({phone: now - 60, laptop: now - 3600, "d-otheraccount": now - 2 * 86400})
    assert admin.connected_lately(db) == (1, [])
    node.handshakes["d-otheraccount"] = now - 100
    assert admin.connected_lately(db) == (2, [])
    # a node that does not answer is named, and what it would have said is not counted
    node.down = True
    admin.report(db, 1)
    assert "connected in the last 24 hours 0 (nodes not read: jp, sg)" in capsys.readouterr().out
