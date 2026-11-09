from datetime import date, timedelta

import pytest
from conftest import HEADERS, create, make_invite, needs_db
from fastapi.testclient import TestClient

from app import admin, policy, worker
from app.main import app

pytestmark = needs_db

ENDS_ON = date.today() + timedelta(days=200)


def redeem(client, code):
    return client.post("/api/redeem", json={"code": code}, headers=HEADERS)


def browser() -> TestClient:
    return TestClient(app, base_url="https://testserver")


def invite(client, *labels):
    return client.post("/api/group/invites", json={"labels": list(labels)}, headers=HEADERS)


def new_group(capsys, code, accounts=3, label="L1", client=None) -> TestClient:
    admin.main(["groups", "create", code, "--accounts", str(accounts), "--ends-on", ENDS_ON.isoformat(), "--devices", "3"])
    capsys.readouterr()
    admin.main(["groups", "leader-invite", code, "--label", label])
    client = client or browser()
    assert redeem(client, capsys.readouterr().out.strip()).status_code == 200
    return client


@pytest.fixture
def leader(client, db, node, capsys):
    db.execute("INSERT INTO regions (id, node_host, is_open) VALUES ('sg', 'node-sg', true), ('jp', 'node-jp', false)")
    return new_group(capsys, "g1", client=client)


def join(leader, label="A1") -> TestClient:
    member = browser()
    assert redeem(member, invite(leader, label).json()["invites"][0]["code"]).status_code == 200
    return member


def page(client) -> dict:
    return client.get("/api/group").json()


def account(client, label) -> dict:
    return next(a for a in page(client)["accounts"] if a["label"] == label)


def issues(client, label="A1") -> list[str]:
    return account(client, label)["devices"][0]["issues"]


def test_the_page_is_for_leaders(leader, db):
    member = join(leader)
    personal = browser()
    redeem(personal, make_invite(db))
    for client in (member, personal):
        assert client.get("/api/group").status_code == 403
        assert client.get("/api/group").json() == {"error": "not_leader"}
        assert invite(client, "X").status_code == 403
        assert client.delete("/api/group/devices/d-x", headers=HEADERS).status_code == 403
        assert client.delete("/api/group/invites/1", headers=HEADERS).status_code == 403
        assert client.post("/api/group/members/remove", json={"label": "A1"}, headers=HEADERS).status_code == 403


def test_the_page_lists_the_group_and_no_counts(leader, db, node):
    member = join(leader)
    device_id = create(member, name="phone").json()["id"]
    node.counters[device_id] = (123456789, 0)
    worker.tick(db)
    body = page(leader)
    assert body["code"] == "g1" and body["ends_on"] == ENDS_ON.isoformat() and body["places_left"] == 2
    a1 = next(a for a in body["accounts"] if a["label"] == "A1")
    assert a1["role"] == "member" and a1["joined_on"] == date.today().isoformat()
    assert list(a1["devices"][0]) == ["id", "name", "region", "dns_filter", "status", "expires_on", "issues"]
    assert "123456789" not in str(body)


def test_the_page_shows_only_its_own_group(leader, db, node, capsys):
    other = new_group(capsys, "g2", label="other-leader")
    join(other, "other-member")
    invite(other, "other-invite")
    text = str(page(leader))
    assert "other-" not in text and "g2" not in text


def test_a_device_made_today_is_not_a_problem_yet(leader, db):
    member = join(leader)
    create(member)
    assert issues(leader) == []
    db.execute("UPDATE devices SET created_on = current_date - 1")
    assert issues(leader) == ["not_connected"]
    db.execute("UPDATE devices SET connected = true")
    assert issues(leader) == []


def test_issues_for_suspended_and_new_config(leader, db):
    member = join(leader)
    create(member)
    db.execute("UPDATE devices SET status = 'suspended', connected = true")
    assert issues(leader) == ["suspended"]
    db.execute("UPDATE devices SET status = 'active', ipv6 = false")
    assert issues(leader) == ["new_config"]
    db.execute("UPDATE devices SET ipv6 = true, moved = true")
    db.execute("UPDATE regions SET previous_until = current_date + 5")
    assert issues(leader) == ["new_config"]


@pytest.mark.parametrize(("blocked", "ads", "expected"), [(99, 5000, []), (100, 0, ["blocked_many"])])
def test_only_malware_lookups_mark_a_device(leader, db, blocked, ads, expected):
    member = join(leader)
    device_id = create(member).json()["id"]
    db.execute("UPDATE devices SET connected = true")
    db.execute(
        "INSERT INTO device_usage (device_id, period, rx_bytes, tx_bytes, blocked, blocked_ads) "
        "VALUES (%s, date_trunc('month', current_date), 0, 0, %s, %s)",
        (device_id, blocked, ads),
    )
    assert issues(leader) == expected


def test_a_devices_past_months_do_not_count(leader, db):
    member = join(leader)
    device_id = create(member).json()["id"]
    db.execute("UPDATE devices SET connected = true")
    db.execute(
        "INSERT INTO device_usage (device_id, period, rx_bytes, tx_bytes, blocked) "
        "VALUES (%s, date_trunc('month', current_date) - interval '1 month', 0, 0, 500)",
        (device_id,),
    )
    assert issues(leader) == []


def test_issuing_invites_shows_each_code_once(leader, db):
    r = invite(leader, "A1", "A2")
    made = r.json()["invites"]
    assert [i["label"] for i in made] == ["A1", "A2"] and r.json()["days"] == policy.USER_INVITE_DAYS
    listed = page(leader)["invites"]
    assert [i["label"] for i in listed] == ["A1", "A2"] and not any(i["expired"] for i in listed)
    assert made[0]["code"] not in str(listed)
    member = browser()
    assert redeem(member, made[0]["code"]).status_code == 200
    assert db.execute("SELECT group_role, group_label FROM accounts WHERE group_label = 'A1'").fetchone() == ("member", "A1")
    assert [i["label"] for i in page(leader)["invites"]] == ["A2"]


def test_invites_stop_at_the_groups_places(leader, db):
    assert invite(leader, "A1", "A2", "A3", "A4").json() == {"error": "group_full"}
    assert invite(leader, "A1", "A2", "A3").status_code == 200
    assert page(leader)["places_left"] == 0
    assert invite(leader, "A4").json() == {"error": "group_full"}


def test_withdrawing_gives_the_place_back(leader, db):
    first = invite(leader, "A1", "A2", "A3").json()["invites"][0]
    assert leader.delete(f"/api/group/invites/{first['id']}", headers=HEADERS).status_code == 200
    assert page(leader)["places_left"] == 1
    assert redeem(browser(), first["code"]).json() == {"error": "invalid_invite"}
    assert invite(leader, "A1").status_code == 200


def test_an_expired_invite_gives_the_place_back_and_its_alias_can_be_issued_again(leader, db):
    invite(leader, "A1", "A2", "A3")
    db.execute("UPDATE invites SET expires_at = now() - interval '1 hour' WHERE group_label = 'A1'")
    body = page(leader)
    assert body["places_left"] == 1 and [i["expired"] for i in body["invites"]] == [True, False, False]
    assert invite(leader, "A1").status_code == 200
    assert not any(i["expired"] for i in page(leader)["invites"])


@pytest.mark.parametrize("labels", [["   "], ["x" * 41], ["A1", " A1 "]])
def test_bad_aliases_are_refused(leader, db, labels):
    assert invite(leader, *labels).json() == {"error": "invalid_label"}


def test_an_alias_in_use_is_refused(leader, db):
    join(leader, "A1")
    invite(leader, "A2")
    assert invite(leader, "A1").json() == {"error": "label_in_use"}
    assert invite(leader, "A2").json() == {"error": "label_in_use"}
    assert invite(leader, "L1").json() == {"error": "label_in_use"}


def test_a_leaders_invite_is_not_on_the_page_and_cannot_be_withdrawn(leader, db, capsys):
    admin.main(["groups", "leader-invite", "g1", "--label", "L2"])
    capsys.readouterr()
    assert page(leader)["invites"] == []
    invite_id = db.execute("SELECT id FROM invites WHERE group_label = 'L2'").fetchone()[0]
    assert leader.delete(f"/api/group/invites/{invite_id}", headers=HEADERS).status_code == 404


def test_another_groups_things_are_out_of_reach(leader, db, node, capsys):
    other = new_group(capsys, "g2", label="L9")
    theirs = join(other, "B1")
    device_id = create(theirs).json()["id"]
    invite_id = invite(other, "B2").json()["invites"][0]["id"]
    assert leader.delete(f"/api/group/devices/{device_id}", headers=HEADERS).status_code == 404
    assert leader.delete(f"/api/group/invites/{invite_id}", headers=HEADERS).status_code == 404
    assert leader.post("/api/group/members/remove", json={"label": "B1"}, headers=HEADERS).status_code == 404
    assert device_id in node.peers


def test_revoking_takes_the_device_off_and_tells_its_owner_the_day(leader, db, node):
    member = join(leader)
    device_id = create(member).json()["id"]
    assert member.get("/api/me").json()["group"] == {"role": "member", "label": "A1", "device_revoked_on": None, "closing_on": None}
    assert leader.delete(f"/api/group/devices/{device_id}", headers=HEADERS).status_code == 200
    assert device_id not in node.peers
    assert account(leader, "A1")["devices"] == []
    assert member.get("/api/me").json()["group"]["device_revoked_on"] == date.today().isoformat()


def test_a_leader_revoking_their_own_device_leaves_no_note(leader, db, node):
    device_id = create(leader).json()["id"]
    assert leader.delete(f"/api/group/devices/{device_id}", headers=HEADERS).status_code == 200
    assert leader.get("/api/me").json()["group"]["device_revoked_on"] is None


def test_removing_a_member_needs_a_recent_sign_in(leader, db, node):
    member = join(leader)
    create(member)
    db.execute("UPDATE sessions SET verified_until = now() - interval '1 minute'")
    r = leader.post("/api/group/members/remove", json={"label": "A1"}, headers=HEADERS)
    assert r.status_code == 403 and r.json() == {"error": "verify_required"}
    assert account(leader, "A1")


def test_removing_a_member_ends_the_account_and_gives_the_place_back(leader, db, node):
    member = join(leader)
    device_id = create(member).json()["id"]
    assert leader.post("/api/group/members/remove", json={"label": "A1"}, headers=HEADERS).status_code == 200
    assert member.get("/api/me").status_code == 401
    worker.tick(db)
    assert device_id not in node.peers
    body = page(leader)
    assert [a["label"] for a in body["accounts"]] == ["L1"] and body["places_left"] == 3


def test_a_leader_cannot_be_removed_from_the_page(leader, db):
    r = leader.post("/api/group/members/remove", json={"label": "L1"}, headers=HEADERS)
    assert r.status_code == 404
    assert account(leader, "L1")


def test_me_says_nothing_about_groups_on_a_personal_account(client, db):
    redeem(client, make_invite(db))
    assert client.get("/api/me").json()["group"] is None


def test_me_tells_a_leader_their_role(leader):
    assert leader.get("/api/me").json()["group"] == {"role": "leader", "label": "L1", "device_revoked_on": None, "closing_on": None}


def test_a_member_sees_what_the_leaders_see(leader, db):
    member = join(leader)
    create(member, name="phone")
    db.execute("UPDATE devices SET created_on = current_date - 1")
    mine = member.get("/api/group/mine").json()
    assert mine == account(leader, "A1")
    assert mine["devices"][0]["issues"] == ["not_connected"]


def test_a_leader_can_read_their_own_view_too(leader):
    assert leader.get("/api/group/mine").json()["role"] == "leader"


def test_a_personal_account_has_no_group_view(client, db):
    redeem(client, make_invite(db))
    assert client.get("/api/group/mine").status_code == 404


def close(*extra):
    admin.main(["groups", "close", "g1", *extra])


def test_closing_keeps_the_service_going_until_the_day(leader, db, node):
    member = join(leader)
    device_id = create(member).json()["id"]
    day = date.today() + timedelta(days=10)
    close("--until", day.isoformat())
    worker.tick(db)
    assert device_id in node.peers
    assert page(leader)["closing_on"] == day.isoformat()
    assert member.get("/api/me").json()["group"]["closing_on"] == day.isoformat()
    # the date a device shows is the day it will go, and a device made now goes the same day
    assert db.execute("SELECT DISTINCT expires_on FROM devices").fetchall() == [(day,)]
    assert create(member, name="another").status_code == 200
    assert db.execute("SELECT DISTINCT expires_on FROM devices").fetchall() == [(day,)]


def test_closing_defaults_to_thirty_days(leader, db):
    close()
    assert page(leader)["closing_on"] == (date.today() + timedelta(days=policy.GROUP_CLOSE_DAYS)).isoformat()


def test_closing_voids_unused_invites_and_stops_new_ones(leader, db, capsys):
    code = invite(leader, "A1").json()["invites"][0]["code"]
    close()
    assert redeem(browser(), code).json() == {"error": "invalid_invite"}
    assert page(leader)["invites"] == []
    assert invite(leader, "A2").json() == {"error": "group_closing"}
    with pytest.raises(SystemExit):
        admin.main(["groups", "leader-invite", "g1", "--label", "L2"])


def test_on_the_day_the_accounts_devices_and_group_go(leader, db, node):
    member = join(leader)
    device_id = create(member).json()["id"]
    leader_device = create(leader, name="leader-phone").json()["id"]
    close("--until", (date.today() + timedelta(days=3)).isoformat())
    db.execute("UPDATE groups SET closing_on = current_date")
    worker.tick(db)
    assert db.execute("SELECT count(*) FROM groups").fetchone()[0] == 0
    assert db.execute("SELECT count(*) FROM accounts WHERE group_code IS NOT NULL").fetchone()[0] == 0
    assert db.execute("SELECT count(*) FROM devices").fetchone()[0] == 0
    assert device_id not in node.peers and leader_device not in node.peers
    assert member.get("/api/me").status_code == 401 and leader.get("/api/me").status_code == 401


def test_closing_a_group_leaves_other_accounts_alone(leader, db, node, capsys):
    personal = browser()
    redeem(personal, make_invite(db))
    mine = create(personal).json()["id"]
    other = new_group(capsys, "g2", label="L9")
    close("--now", "--confirm", "g1")
    worker.tick(db)
    assert mine in node.peers and personal.get("/api/me").status_code == 200
    assert page(other)["code"] == "g2"


def test_closing_now_needs_the_code_typed_again(leader, db):
    for extra in (["--now"], ["--now", "--confirm", "wrong"]):
        with pytest.raises(SystemExit):
            close(*extra)
    assert page(leader)["closing_on"] is None
    close("--now", "--confirm", "g1")
    assert page(leader)["closing_on"] == date.today().isoformat()


def test_a_cancelled_close_goes_on_and_puts_the_dates_back(leader, db, node):
    member = join(leader)
    device_id = create(member).json()["id"]
    close("--until", (date.today() + timedelta(days=3)).isoformat())
    close("--cancel")
    assert page(leader)["closing_on"] is None
    assert db.execute("SELECT expires_on FROM devices WHERE id = %s", (device_id,)).fetchone()[0] == ENDS_ON
    db.execute("UPDATE groups SET ends_on = current_date - 1")  # past its end date, and still not closing
    worker.tick(db)
    assert device_id in node.peers


@pytest.mark.parametrize("extra", [["--until", "2020-01-01"], ["--cancel"]])
def test_close_refuses_what_makes_no_sense(leader, db, extra):
    with pytest.raises(SystemExit):
        close(*extra)


def test_the_end_date_cannot_change_while_closing(leader, db):
    close()
    with pytest.raises(SystemExit):
        admin.main(["groups", "set", "g1", "--ends-on", "2031-01-01"])


def test_the_list_says_a_group_is_closing(leader, db, capsys):
    close("--until", (date.today() + timedelta(days=3)).isoformat())
    capsys.readouterr()
    admin.main(["groups"])
    assert "CLOSING" in capsys.readouterr().out
