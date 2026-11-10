from datetime import date, timedelta

import psycopg
import pytest
from conftest import HEADERS, create, make_invite, needs_db

from app import admin, auth, jobs, policy, worker

pytestmark = needs_db

GB = 10**9
ENDS_ON = date.today() + timedelta(days=200)


def account_id(db) -> int:
    return db.execute("SELECT id FROM accounts").fetchone()[0]


def join_group(db, devices=5, quota=10 * GB, role="member", label="A1"):
    db.execute(
        "INSERT INTO groups (code, account_limit, device_limit, monthly_quota_bytes, ends_on) "
        "VALUES ('g1', 10, %s, %s, %s)",
        (devices, quota, ENDS_ON),
    )
    db.execute("UPDATE accounts SET group_code = 'g1', group_role = %s, group_label = %s", (role, label))


def another_personal_account_with_a_device(db, node) -> str:
    other = db.execute("INSERT INTO accounts (number_hash) VALUES ('\\x01') RETURNING id").fetchone()[0]
    db.execute(
        "INSERT INTO devices (id, account_id, region_id, name, public_key, dns_filter, status, expires_on) "
        "VALUES ('d-other', %s, 'sg', 'x', 'pk', 'none', 'active', current_date + 30)",
        (other,),
    )
    node.peers["d-other"] = {"public_key": "pk"}
    return other


def test_a_personal_account_keeps_the_service_limits(signed_in, db):
    limits = policy.limits_of(db, account_id(db))
    assert (limits.devices, limits.monthly_quota_bytes) == (policy.DEVICE_LIMIT, policy.MONTHLY_QUOTA_BYTES)
    assert limits.device_expires_on == date.today() + timedelta(days=policy.DEVICE_DAYS)


def test_me_reports_the_groups_limits(signed_in, db):
    join_group(db, devices=5, quota=10 * GB)
    me = signed_in.get("/api/me").json()
    assert (me["device_limit"], me["monthly_quota_bytes"]) == (5, 10 * GB)


def test_the_group_decides_how_many_devices(signed_in, node, db):
    join_group(db, devices=4)
    for i in range(4):
        assert create(signed_in, name=f"d{i}").status_code == 200
    assert create(signed_in, name="d4").json() == {"error": "device_limit"}


def test_a_group_can_allow_fewer_devices_than_a_person_gets(signed_in, node, db):
    join_group(db, devices=1)
    assert create(signed_in, name="a").status_code == 200
    assert create(signed_in, name="b").json() == {"error": "device_limit"}


def test_a_group_account_over_its_quota_cannot_add_a_device(signed_in, node, db):
    join_group(db, quota=GB)
    db.execute(
        "INSERT INTO account_usage (account_id, period, rx_bytes, tx_bytes) "
        "VALUES (%s, date_trunc('month', current_date), %s, 0)",
        (account_id(db), GB),
    )
    assert create(signed_in).json() == {"error": "quota_exceeded"}


def test_the_groups_quota_slows_down_only_that_account(signed_in, node, db):
    device_id = create(signed_in).json()["id"]
    join_group(db, quota=GB)
    other = another_personal_account_with_a_device(db, node)
    month = "date_trunc('month', current_date)"
    for account in (account_id_of_device(db, device_id), other):
        db.execute(
            f"INSERT INTO account_usage (account_id, period, rx_bytes, tx_bytes) VALUES (%s, {month}, %s, 0)",
            (account, GB),
        )
    jobs.enforce_quota(db, policy.MONTHLY_QUOTA_BYTES)
    assert throttled(db, device_id) is True
    assert throttled(db, "d-other") is False
    # the group's quota goes up: the account is under it again
    db.execute("UPDATE groups SET monthly_quota_bytes = %s", (2 * GB,))
    jobs.enforce_quota(db, policy.MONTHLY_QUOTA_BYTES)
    db.execute("UPDATE jobs SET next_try_at = now()")
    jobs.run_due_jobs(db)
    assert throttled(db, device_id) is False and device_id not in node.throttled


def account_id_of_device(db, device_id: str) -> int:
    return db.execute("SELECT account_id FROM devices WHERE id = %s", (device_id,)).fetchone()[0]


def throttled(db, device_id: str) -> bool:
    return db.execute("SELECT throttled FROM devices WHERE id = %s", (device_id,)).fetchone()[0]


def status(db, device_id: str) -> str:
    return db.execute("SELECT status FROM devices WHERE id = %s", (device_id,)).fetchone()[0]


def expires_on(db, device_id: str) -> date:
    return db.execute("SELECT expires_on FROM devices WHERE id = %s", (device_id,)).fetchone()[0]


def test_a_group_device_lasts_until_the_group_ends(signed_in, node, db):
    join_group(db)
    assert expires_on(db, create(signed_in).json()["id"]) == ENDS_ON


def test_signing_in_does_not_change_when_a_group_device_ends(signed_in, node, db):
    join_group(db)
    device_id = create(signed_in).json()["id"]
    auth.keep_alive(db, account_id(db))
    assert expires_on(db, device_id) == ENDS_ON
    # it is still a sign-in
    assert db.execute("SELECT last_login_on FROM accounts").fetchone()[0] == date.today()


def test_only_personal_devices_expire(signed_in, node, db):
    device_id = create(signed_in).json()["id"]
    join_group(db)
    another_personal_account_with_a_device(db, node)
    db.execute("UPDATE devices SET expires_on = current_date - 1")
    worker.tick(db)
    assert status(db, device_id) == "active" and device_id in node.peers
    assert db.execute("SELECT 1 FROM devices WHERE id = 'd-other'").fetchone() is None and "d-other" not in node.peers


def test_report_counts_a_group_account_at_the_groups_quota(signed_in, node, db, capsys):
    join_group(db, quota=GB)
    db.execute(
        "INSERT INTO account_usage (account_id, period, rx_bytes, tx_bytes) "
        "VALUES (%s, date_trunc('month', current_date), %s, 0)",
        (account_id(db), GB),
    )
    admin.report(db, 14)
    assert "accounts at the monthly quota: 1" in capsys.readouterr().out


@pytest.mark.parametrize("columns", ["group_code = 'g1'", "group_role = 'member'", "group_label = 'A1'",
                                     "group_code = 'g1', group_role = 'member'"])
def test_group_columns_are_all_set_or_all_empty(signed_in, db, columns):
    db.execute("INSERT INTO groups VALUES ('g1', 10, 5, 1000, current_date + 1)")
    with pytest.raises(psycopg.errors.CheckViolation):
        db.execute(f"UPDATE accounts SET {columns}")


def test_an_alias_names_one_account_in_a_group(signed_in, db):
    join_group(db)
    with pytest.raises(psycopg.errors.UniqueViolation):
        db.execute(
            "INSERT INTO accounts (number_hash, group_code, group_role, group_label) "
            "VALUES ('\\x02', 'g1', 'member', 'A1')"
        )


def create_group(code="g1", accounts=10, ends_on=ENDS_ON, *extra):
    admin.main(["groups", "create", code, "--accounts", str(accounts), "--ends-on", ends_on.isoformat(), *extra])


def leader_code(capsys, label="L1", group="g1") -> str:
    capsys.readouterr()
    admin.main(["groups", "leader-invite", group, "--label", label])
    return capsys.readouterr().out.strip()


def test_groups_create_and_list_show_settings_and_no_people(signed_in, node, db, capsys):
    create_group("g1", 10, ENDS_ON, "--devices", "5", "--quota-gb", "20")
    assert db.execute("SELECT account_limit, device_limit, monthly_quota_bytes, ends_on FROM groups").fetchone() == (
        10, 5, 20 * GB, ENDS_ON)
    create(signed_in, name="secret-phone")
    db.execute("UPDATE accounts SET group_code = 'g1', group_role = 'member', group_label = 'secret-alias'")
    capsys.readouterr()
    admin.main(["groups"])
    out = capsys.readouterr().out
    assert "g1  members 1/10  leaders 0  devices 1 (5 each)  quota 20.0 GB" in out
    assert "secret" not in out


def test_groups_defaults_are_the_personal_limits(db):
    create_group()
    assert db.execute("SELECT device_limit, monthly_quota_bytes FROM groups").fetchone() == (
        policy.DEVICE_LIMIT, policy.MONTHLY_QUOTA_BYTES)


def test_groups_list_says_when_one_is_about_to_end(db, capsys):
    create_group("g1", 1, date.today() + timedelta(days=5))
    assert "ends in 5 days" in capsys.readouterr().out


@pytest.mark.parametrize("argv", [
    ["groups", "create", "Bad Code", "--accounts", "1", "--ends-on", "2030-01-01"],
    ["groups", "create", "g2", "--accounts", "0", "--ends-on", "2030-01-01"],
    ["groups", "create", "g1", "--accounts", "1", "--ends-on", "2030-01-01"],  # already there
    ["groups", "set", "nope", "--accounts", "1"],
    ["groups", "set", "g1", "--devices", "0"],
    ["groups", "leader-invite", "nope", "--label", "L1"],
    ["groups", "leader-invite", "g1", "--label", "   "],
])
def test_groups_refuses_what_makes_no_sense(db, argv):
    create_group()
    with pytest.raises(SystemExit):
        admin.main(argv)


def test_groups_set_changes_only_what_is_given(db):
    create_group("g1", 10, ENDS_ON, "--devices", "5", "--quota-gb", "20")
    admin.main(["groups", "set", "g1", "--devices", "7"])
    assert db.execute("SELECT account_limit, device_limit, monthly_quota_bytes, ends_on FROM groups").fetchone() == (
        10, 7, 20 * GB, ENDS_ON)


def test_a_new_end_date_moves_the_groups_devices(signed_in, node, db):
    create_group()
    db.execute("UPDATE accounts SET group_code = 'g1', group_role = 'member', group_label = 'A1'")
    device_id = create(signed_in).json()["id"]
    later = ENDS_ON + timedelta(days=90)
    admin.main(["groups", "set", "g1", "--ends-on", later.isoformat()])
    assert expires_on(db, device_id) == later


def redeem(client, code):
    return client.post("/api/redeem", json={"code": code}, headers=HEADERS)


def test_a_leader_invite_makes_an_account_in_the_group(client, db, capsys):
    create_group("g1", 10, ENDS_ON, "--devices", "5", "--quota-gb", "20")
    r = redeem(client, leader_code(capsys))
    assert r.status_code == 200 and r.json()["account_number"]
    assert db.execute("SELECT group_code, group_role, group_label FROM accounts").fetchone() == ("g1", "leader", "L1")
    assert client.get("/api/me").json()["device_limit"] == 5
    # used, and it says nothing about the account it made
    assert db.execute("SELECT group_code, group_role, group_label, created_by FROM invites").fetchone() == (
        None, None, None, None)
    assert db.execute("SELECT count(*) FROM invites WHERE redeemed_at = date_trunc('day', redeemed_at)").fetchone()[0] == 1


def test_a_leader_invite_works_only_once(client, db, capsys):
    create_group()
    code = leader_code(capsys)
    assert redeem(client, code).status_code == 200
    assert redeem(client, code).json() == {"error": "invalid_invite"}


def test_issuing_the_same_alias_again_replaces_the_unused_code(client, db, capsys):
    create_group()
    old, new = leader_code(capsys), leader_code(capsys)
    assert old != new
    assert redeem(client, old).json() == {"error": "invalid_invite"}
    assert redeem(client, new).status_code == 200


def test_an_alias_already_in_use_cannot_be_issued(client, db, capsys):
    create_group()
    redeem(client, leader_code(capsys))
    with pytest.raises(SystemExit):
        admin.main(["groups", "leader-invite", "g1", "--label", "L1"])


def test_an_alias_taken_meanwhile_refuses_the_invite(client, db, capsys):
    create_group()
    code = leader_code(capsys)
    db.execute("INSERT INTO accounts (number_hash, group_code, group_role, group_label) VALUES ('\\x03', 'g1', 'member', 'L1')")
    assert redeem(client, code).json() == {"error": "invalid_invite"}


def test_a_groups_invite_is_outside_the_pause_and_the_cap(client, db, capsys):
    create_group()
    leader, plain = leader_code(capsys), make_invite(db)
    db.execute("UPDATE settings SET value = 'true' WHERE key = 'redeem_paused'")
    assert redeem(client, "AAAA-BBBB-CCCC-DDDD").json() == {"error": "redeem_paused"}
    assert redeem(client, plain).json() == {"error": "redeem_paused"}
    db.execute("UPDATE settings SET value = 'false' WHERE key = 'redeem_paused'")
    db.execute("UPDATE settings SET value = '1' WHERE key = 'account_cap'")
    assert redeem(client, leader).status_code == 200
    # and its account does not take a place under the cap
    assert redeem(client, plain).status_code == 200
    assert redeem(client, make_invite(db)).json() == {"error": "full"}


def test_an_account_in_a_group_cannot_invite_people(client, db, capsys):
    create_group()
    db.execute("UPDATE settings SET value = '3' WHERE key = 'user_invites'")
    redeem(client, leader_code(capsys))
    assert client.get("/api/invites").json()["reason"] == "off"


def test_a_leader_can_be_removed_and_replaced(client, node, db, capsys):
    db.execute("INSERT INTO regions (id, node_host, is_open) VALUES ('sg', 'node-sg', true)")
    create_group()
    redeem(client, leader_code(capsys))
    device_id = create(client).json()["id"]
    capsys.readouterr()
    admin.main(["groups", "remove-leader", "g1", "--label", "L1", "--confirm", "L1"])
    assert "nobody can manage g1" in capsys.readouterr().out
    assert client.get("/api/me").status_code == 401
    worker.tick(db)
    assert device_id not in node.peers
    # the alias is free for the new leader
    new = leader_code(capsys)
    assert redeem(client, new).status_code == 200


def test_removing_a_leader_leaves_the_other_one(client, db, capsys):
    create_group()
    redeem(client, leader_code(capsys, "L1"))
    db.execute("INSERT INTO accounts (number_hash, group_code, group_role, group_label) VALUES ('\\x04', 'g1', 'leader', 'L2')")
    capsys.readouterr()
    admin.main(["groups", "remove-leader", "g1", "--label", "L2", "--confirm", "L2"])
    out = capsys.readouterr().out
    assert "1 leaders left" in out and "nobody" not in out


@pytest.mark.parametrize("argv", [
    ["--label", "L1"],
    ["--label", "L1", "--confirm", "L2"],
    ["--label", "A1", "--confirm", "A1"],  # a member, not a leader
    ["--label", "nobody", "--confirm", "nobody"],
])
def test_removing_a_leader_needs_the_right_alias_twice(client, db, capsys, argv):
    create_group()
    redeem(client, leader_code(capsys))
    db.execute("INSERT INTO accounts (number_hash, group_code, group_role, group_label) VALUES ('\\x05', 'g1', 'member', 'A1')")
    with pytest.raises(SystemExit):
        admin.main(["groups", "remove-leader", "g1", *argv])
    assert db.execute("SELECT count(*) FROM accounts WHERE group_code = 'g1'").fetchone()[0] == 2
