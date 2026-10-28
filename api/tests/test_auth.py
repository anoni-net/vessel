from conftest import HEADERS, make_invite, needs_db

pytestmark = needs_db


def redeem(client, code):
    return client.post("/api/redeem", json={"code": code}, headers=HEADERS)


def test_redeem_creates_account_and_session(client, db):
    r = redeem(client, make_invite(db))
    assert r.status_code == 200
    number = r.json()["account_number"]
    assert len(number) == 19
    me = client.get("/api/me")
    assert me.status_code == 200
    assert me.json()["device_limit"] == 3 and me.json()["used_bytes"] == 0
    assert db.execute("SELECT count(*) FROM accounts").fetchone()[0] == 1


def test_number_is_not_stored(client, db):
    number = redeem(client, make_invite(db)).json()["account_number"].replace(" ", "")
    dump = str(db.execute("SELECT * FROM accounts").fetchall()) + str(db.execute("SELECT * FROM invites").fetchall())
    assert number not in dump
    assert number.encode() not in db.execute("SELECT number_hash FROM accounts").fetchone()[0]


def test_invite_works_once(client, db):
    code = make_invite(db)
    assert redeem(client, code).status_code == 200
    r = redeem(client, code)
    assert r.status_code == 400 and r.json() == {"error": "invalid_invite"}


def test_expired_and_unknown_invites_look_the_same(client, db):
    expired = make_invite(db, days=-1)
    for code in [expired, "AAAA-BBBB-CCCC-DDDD", "nonsense"]:
        r = redeem(client, code)
        assert r.status_code == 400 and r.json() == {"error": "invalid_invite"}


def test_state_changes_need_the_header(client, db):
    r = client.post("/api/redeem", json={"code": make_invite(db)})
    assert r.status_code == 403 and r.json() == {"error": "missing_header"}


def test_redeem_paused_and_cap(client, db):
    db.execute("UPDATE settings SET value = 'true' WHERE key = 'redeem_paused'")
    assert redeem(client, make_invite(db)).json() == {"error": "redeem_paused"}
    db.execute("UPDATE settings SET value = 'false' WHERE key = 'redeem_paused'")
    db.execute("UPDATE settings SET value = '1' WHERE key = 'account_cap'")
    assert redeem(client, make_invite(db)).status_code == 200
    r = redeem(client, make_invite(db))
    assert r.status_code == 409 and r.json() == {"error": "full"}


def test_login_logout(client, db):
    number = redeem(client, make_invite(db)).json()["account_number"]
    client.post("/api/logout", headers=HEADERS)
    assert client.get("/api/me").status_code == 401
    assert client.post("/api/login", json={"account_number": number}, headers=HEADERS).status_code == 200
    assert client.get("/api/me").json()["last_login_on"] is not None
    # dashes and no spaces work too
    dashed = number.replace(" ", "-")
    assert client.post("/api/login", json={"account_number": dashed}, headers=HEADERS).status_code == 200


def test_login_rejects_wrong_numbers(client, db):
    redeem(client, make_invite(db))
    r = client.post("/api/login", json={"account_number": "0000 0000 0000 0000"}, headers=HEADERS)
    assert r.status_code == 401 and r.json() == {"error": "invalid_number"}
    r = client.post("/api/login", json={"account_number": "1234"}, headers=HEADERS)
    assert r.status_code == 400 and r.json() == {"error": "invalid_number"}


def test_login_extends_devices(client, db):
    number = redeem(client, make_invite(db)).json()["account_number"]
    account_id = db.execute("SELECT id FROM accounts").fetchone()[0]
    db.execute("INSERT INTO regions (id, node_host) VALUES ('sg', 'n')")
    db.execute(
        "INSERT INTO devices (id, account_id, region_id, name, public_key, dns_filter, status, expires_on) "
        "VALUES ('d-1', %s, 'sg', 'phone', 'pk', 'none', 'active', current_date + 1)",
        (account_id,),
    )
    client.post("/api/login", json={"account_number": number}, headers=HEADERS)
    days = db.execute("SELECT expires_on - current_date FROM devices WHERE id = 'd-1'").fetchone()[0]
    assert days == 30


def test_coming_back_signed_in_extends_devices_once_a_day(client, db):
    redeem(client, make_invite(db))
    account_id = db.execute("SELECT id FROM accounts").fetchone()[0]
    db.execute("INSERT INTO regions (id, node_host) VALUES ('sg', 'n')")
    db.execute(
        "INSERT INTO devices (id, account_id, region_id, name, public_key, dns_filter, status, expires_on) "
        "VALUES ('d-1', %s, 'sg', 'phone', 'pk', 'none', 'active', current_date + 1)",
        (account_id,),
    )
    # signed in today already: nothing to do
    db.execute("UPDATE accounts SET last_login_on = current_date")
    assert "set-cookie" not in client.get("/api/me").headers
    assert db.execute("SELECT expires_on - current_date FROM devices").fetchone()[0] == 1
    # the session is still good, but the last visit was days ago
    db.execute("UPDATE accounts SET last_login_on = current_date - 5")
    db.execute("UPDATE sessions SET expires_at = now() + interval '2 days'")
    r = client.get("/api/me")
    me = r.json()
    assert db.execute("SELECT expires_on - current_date FROM devices").fetchone()[0] == 30
    # the session moves too, and the cookie with it
    left = db.execute("SELECT expires_at - now() FROM sessions").fetchone()[0]
    assert left.days == 29
    assert "max-age=2592000" in r.headers["set-cookie"].lower()
    assert me["last_login_on"] == db.execute("SELECT current_date").fetchone()[0].isoformat()


def test_sign_in_rate_limit(client, db):
    codes = [client.post("/api/login", json={"account_number": "0000 0000 0000 0000"}, headers=HEADERS).status_code
             for _ in range(11)]
    assert codes[:10] == [401] * 10 and codes[10] == 429


def test_delete_account_queues_node_cleanup(client, db):
    redeem(client, make_invite(db))
    account_id = db.execute("SELECT id FROM accounts").fetchone()[0]
    db.execute("INSERT INTO regions (id, node_host) VALUES ('sg', 'n')")
    db.execute(
        "INSERT INTO devices (id, account_id, region_id, name, public_key, dns_filter, status, expires_on) "
        "VALUES ('d-1', %s, 'sg', 'phone', 'pk', 'none', 'active', current_date + 30)",
        (account_id,),
    )
    assert client.delete("/api/account", headers=HEADERS).status_code == 200
    assert db.execute("SELECT count(*) FROM accounts").fetchone()[0] == 0
    assert db.execute("SELECT device_id, action FROM jobs").fetchall() == [("d-1", "remove")]
    assert client.get("/api/me").status_code == 401
