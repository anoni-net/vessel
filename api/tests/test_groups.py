from datetime import date, timedelta

import psycopg
import pytest
from conftest import create, needs_db

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


def test_the_groups_quota_suspends_only_that_account(signed_in, node, db):
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
    assert status(db, device_id) == "suspended"
    assert status(db, "d-other") == "active"
    # the group's quota goes up: the account is under it again
    db.execute("UPDATE groups SET monthly_quota_bytes = %s", (2 * GB,))
    jobs.enforce_quota(db, policy.MONTHLY_QUOTA_BYTES)
    db.execute("UPDATE jobs SET next_try_at = now()")
    jobs.run_due_jobs(db)
    assert status(db, device_id) == "active"


def account_id_of_device(db, device_id: str) -> int:
    return db.execute("SELECT account_id FROM devices WHERE id = %s", (device_id,)).fetchone()[0]


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
