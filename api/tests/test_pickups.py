from conftest import HEADERS, make_invite, needs_db

from app import admin, jobs, policy

pytestmark = needs_db
ASK = {"purpose": "travel", "network": "public", "note": "出國時在旅館用"}


def open_requests(db) -> None:
    db.execute("UPDATE settings SET value = 'true' WHERE key = 'pickup_open'")


def ask(client, body=ASK, **headers):
    return client.post("/api/pickup", json=body, headers={**HEADERS, **headers})


def status(client, number: str) -> dict:
    return client.post("/api/pickup/status", json={"number": number}, headers=HEADERS).json()


def request_id(db) -> int:
    return db.execute("SELECT id FROM invites WHERE pickup_state IS NOT NULL ORDER BY id DESC LIMIT 1").fetchone()[0]


def test_closed_until_the_maintainer_opens_it(client, db):
    assert client.get("/api/pickup").json()["open"] is False
    r = ask(client)
    assert r.status_code == 503 and r.json()["error"] == "pickup_closed"
    open_requests(db)
    info = client.get("/api/pickup").json()
    assert info["open"] is True and info["purposes"] == list(policy.PICKUP_PURPOSES) and info["note_max"] == 200


def test_a_request_keeps_the_day_and_the_choices_only(client, db):
    open_requests(db)
    r = ask(client)
    assert r.status_code == 200
    number = r.json()["number"]
    assert len(number) == 19 and number.count("-") == 3
    created_at, state = db.execute("SELECT created_at, pickup_state FROM invites").fetchone()
    assert state == "waiting" and (created_at.hour, created_at.minute, created_at.second) == (0, 0, 0)
    assert db.execute("SELECT purpose, network, note FROM pickup_requests").fetchone() == ("travel", "public", "出國時在旅館用")
    assert status(client, number) == {"state": "waiting", "until": None}
    # the number is not kept anywhere in the clear
    assert not db.execute("SELECT 1 FROM invites WHERE code_hmac::text LIKE %s", (f"%{number[:4]}%",)).fetchone()


def test_choices_and_the_note_are_checked(client, db):
    open_requests(db)
    assert ask(client, {**ASK, "purpose": "torrents"}).json()["error"] == "invalid_pickup"
    assert ask(client, {**ASK, "network": "satellite"}).status_code == 400
    assert ask(client, {**ASK, "note": "x" * 201}).status_code == 422
    assert ask(client, {"purpose": "other", "network": "other"}).status_code == 200


def test_a_waiting_number_cannot_be_redeemed_and_an_approved_one_is_an_invite(client, db, capsys):
    open_requests(db)
    number = ask(client).json()["number"]
    r = client.post("/api/redeem", json={"code": number}, headers=HEADERS)
    assert r.status_code == 400 and r.json()["error"] == "pickup_waiting"
    admin.main(["pickups"])
    out = capsys.readouterr().out
    assert "travel" in out and "public" in out and "出國時在旅館用" in out and "1 waiting; requests open" in out
    admin.main(["pickups", "approve", str(request_id(db))])
    # what the person wrote goes with the decision
    assert db.execute("SELECT count(*) FROM pickup_requests").fetchone()[0] == 0
    answer = status(client, number)
    assert answer["state"] == "approved" and answer["until"]
    r = client.post("/api/redeem", json={"code": number}, headers=HEADERS)
    assert r.status_code == 200 and r.json()["account_number"]
    assert status(client, number) == {"state": "used", "until": None}
    # used: the same as any invite, only the day it was used
    assert db.execute("SELECT redeemed_at::time FROM invites").fetchone()[0].hour == 0


def test_a_declined_number_says_so_and_cannot_be_redeemed(client, db, capsys):
    open_requests(db)
    number = ask(client).json()["number"]
    admin.main(["pickups", "decline", str(request_id(db))])
    assert status(client, number)["state"] == "declined"
    r = client.post("/api/redeem", json={"code": number}, headers=HEADERS)
    assert r.json()["error"] == "invalid_invite"
    # deciding twice, or something that is not a request, is said and changes nothing
    admin.main(["pickups", "approve", str(request_id(db)), "999999"])
    assert "not waiting (decided already, run out, or no such request): " in capsys.readouterr().out
    assert status(client, number)["state"] == "declined"


def test_numbers_already_given_work_while_requests_are_closed(client, db):
    open_requests(db)
    number = ask(client).json()["number"]
    db.execute("UPDATE settings SET value = 'false' WHERE key = 'pickup_open'")
    assert status(client, number)["state"] == "waiting"
    admin.main(["pickups", "approve", str(request_id(db))])
    assert client.post("/api/redeem", json={"code": number}, headers=HEADERS).status_code == 200


def test_a_wrong_or_run_out_number_is_unknown_and_the_worker_deletes_it(client, db):
    open_requests(db)
    assert status(client, "AAAA-BBBB-CCCC-DDDD") == {"state": "unknown", "until": None}
    assert status(client, "not a number") == {"state": "unknown", "until": None}
    # an ordinary invite is not a pickup number
    assert status(client, make_invite(db))["state"] == "unknown"
    number = ask(client).json()["number"]
    db.execute("UPDATE invites SET expires_at = now() - interval '1 minute' WHERE pickup_state IS NOT NULL")
    assert status(client, number)["state"] == "unknown"
    jobs.forget_expired_invites(db)
    assert db.execute("SELECT count(*) FROM invites WHERE pickup_state IS NOT NULL").fetchone()[0] == 0
    assert db.execute("SELECT count(*) FROM pickup_requests").fetchone()[0] == 0
    # the ordinary invite stays
    assert db.execute("SELECT count(*) FROM invites").fetchone()[0] == 1


def test_one_address_asks_a_few_times_at_most(client, db):
    open_requests(db)
    for _ in range(3):
        assert ask(client, **{"cf-connecting-ip": "203.0.113.5"}).status_code == 200
    r = ask(client, **{"cf-connecting-ip": "203.0.113.5"})
    assert r.status_code == 429 and r.json()["error"] == "too_many_attempts"
    assert ask(client, **{"cf-connecting-ip": "203.0.113.6"}).status_code == 200


def test_the_day_and_the_waiting_have_a_limit(client, db, monkeypatch):
    open_requests(db)
    monkeypatch.setattr(policy, "PICKUP_DAILY", 2)
    for ip in ("203.0.113.1", "203.0.113.2"):
        assert ask(client, **{"cf-connecting-ip": ip}).status_code == 200
    r = ask(client, **{"cf-connecting-ip": "203.0.113.3"})
    assert r.status_code == 429 and r.json()["error"] == "pickup_busy"
    assert client.get("/api/pickup").json()["open"] is False
    # the waiting ones count apart from the day's
    monkeypatch.setattr(policy, "PICKUP_DAILY", 100)
    monkeypatch.setattr(policy, "PICKUP_WAITING", 2)
    assert ask(client, **{"cf-connecting-ip": "203.0.113.3"}).json()["error"] == "pickup_busy"
    admin.main(["pickups", "decline", str(request_id(db))])
    assert ask(client, **{"cf-connecting-ip": "203.0.113.3"}).status_code == 200


def test_no_requests_while_redeeming_is_paused_or_the_service_is_full(client, db):
    open_requests(db)
    db.execute("UPDATE settings SET value = 'true' WHERE key = 'redeem_paused'")
    assert ask(client).json()["error"] == "redeem_paused"
    db.execute("UPDATE settings SET value = 'false' WHERE key = 'redeem_paused'")
    db.execute("UPDATE settings SET value = '1' WHERE key = 'account_cap'")
    client.post("/api/redeem", json={"code": make_invite(db)}, headers=HEADERS)
    r = ask(client)
    assert r.status_code == 409 and r.json()["error"] == "full"


def test_report_counts_the_pickup_numbers_apart(client, db, node, capsys):
    open_requests(db)
    make_invite(db)
    ask(client)
    ask(client)
    admin.main(["pickups", "approve", str(request_id(db))])
    admin.report(db, 1)
    out = capsys.readouterr().out
    assert "invites from maintainers: unused 1\n" in out
    assert "pickup numbers: approved 1, waiting 1\n" in out


def test_the_setting_takes_true_or_false(db, capsys):
    admin.main(["settings", "pickup_open", "true"])
    assert "pickup_open = true" in capsys.readouterr().out
    try:
        admin.main(["settings", "pickup_open", "yes"])
    except SystemExit as e:
        assert "true or false" in str(e)
    else:
        raise AssertionError("accepted yes")
