"""Invites an account makes (app/invites.py): who may, how many, and that who invited whom is never kept."""

from conftest import HEADERS, create, make_invite, needs_db
from fastapi.testclient import TestClient

from app import jobs
from app.main import app

pytestmark = needs_db


def ready(db, per: int = 1):
    """The one account made by signed_in, old enough and with a device that connected; `per` invites each."""
    db.execute("UPDATE settings SET value = %s WHERE key = 'user_invites'", (str(per),))
    db.execute("UPDATE accounts SET created_on = current_date - 14")
    db.execute("UPDATE devices SET connected = true")


def make(client):
    return client.post("/api/invites", headers=HEADERS)


def other_client():
    return TestClient(app, base_url="https://testserver")


def test_off_until_the_setting_is_on(signed_in, db):
    assert signed_in.get("/api/invites").json()["reason"] == "off"
    r = make(signed_in)
    assert r.status_code == 409 and r.json() == {"error": "invites_off"}


def test_new_accounts_and_accounts_that_never_connected_wait(signed_in, db):
    db.execute("UPDATE settings SET value = '1' WHERE key = 'user_invites'")
    state = signed_in.get("/api/invites").json()
    assert state["reason"] == "too_new"
    assert make(signed_in).json() == {"error": "invites_too_new"}
    db.execute("UPDATE accounts SET created_on = current_date - 14")
    assert make(signed_in).json() == {"error": "invites_not_connected"}
    create(signed_in)
    assert make(signed_in).json() == {"error": "invites_not_connected"}
    db.execute("UPDATE devices SET connected = true")
    assert make(signed_in).status_code == 200


def test_make_one_redeem_it_and_nothing_says_who_invited_whom(signed_in, db):
    create(signed_in)
    ready(db)
    r = make(signed_in)
    assert r.status_code == 200
    code = r.json()["code"]
    state = signed_in.get("/api/invites").json()
    assert state["left"] == 0 and state["reason"] == "none_left" and len(state["open"]) == 1
    assert make(signed_in).json() == {"error": "invites_none_left"}
    # the code itself is not stored
    assert code.replace("-", "") not in str(db.execute("SELECT * FROM invites").fetchall())

    inviter = db.execute("SELECT id FROM accounts").fetchone()[0]
    with other_client() as friend:
        assert friend.post("/api/redeem", json={"code": code}, headers=HEADERS).status_code == 200
    invited = db.execute("SELECT id FROM accounts WHERE id <> %s", (inviter,)).fetchone()[0]
    # the inviter's count went up; no row anywhere ties the two accounts together
    assert db.execute("SELECT invites_used FROM accounts WHERE id = %s", (inviter,)).fetchone()[0] == 1
    row = db.execute("SELECT created_by, redeemed_account, from_account FROM invites WHERE redeemed_at IS NOT NULL "
                     "AND from_account").fetchone()
    assert row == (None, None, True)
    columns = {c for (c,) in db.execute(
        "SELECT column_name FROM information_schema.columns WHERE table_name = 'accounts'")}
    assert "invited_by" not in columns
    assert str(inviter) not in str(db.execute("SELECT * FROM accounts WHERE id = %s", (invited,)).fetchall()[0][1:])
    state = signed_in.get("/api/invites").json()
    assert state["used"] == 1 and state["open"] == [] and state["left"] == 0


def test_withdrawn_and_expired_invites_give_their_place_back(signed_in, db):
    create(signed_in)
    ready(db)
    first = make(signed_in).json()
    after = signed_in.delete(f"/api/invites/{first['id']}", headers=HEADERS).json()
    assert after["left"] == 1 and after["open"] == []
    with other_client() as friend:
        assert friend.post("/api/redeem", json={"code": first["code"]}, headers=HEADERS).status_code == 400
    second = make(signed_in).json()
    db.execute("UPDATE invites SET expires_at = now() - interval '1 minute' WHERE id = %s", (second["id"],))
    assert signed_in.get("/api/invites").json()["left"] == 1
    # the worker forgets which account made an expired one
    jobs.forget_expired_invites(db)
    assert db.execute("SELECT created_by FROM invites WHERE id = %s", (second["id"],)).fetchone()[0] is None


def test_an_invite_expires_after_a_week(signed_in, db):
    create(signed_in)
    ready(db)
    make(signed_in)
    days = db.execute("SELECT extract(day FROM expires_at - created_at) FROM invites WHERE from_account").fetchone()[0]
    assert days == 7


def test_only_the_maker_can_withdraw(signed_in, db):
    create(signed_in)
    ready(db)
    mine = make(signed_in).json()
    with other_client() as other:
        other.post("/api/redeem", json={"code": make_invite(db)}, headers=HEADERS)
        assert other.delete(f"/api/invites/{mine['id']}", headers=HEADERS).status_code == 404
        assert other.get("/api/invites").json()["open"] == []
    assert len(signed_in.get("/api/invites").json()["open"]) == 1


def test_none_while_the_service_is_full_or_paused(signed_in, db):
    create(signed_in)
    ready(db)
    db.execute("UPDATE settings SET value = '1' WHERE key = 'account_cap'")
    assert make(signed_in).json() == {"error": "invites_full"}
    db.execute("UPDATE settings SET value = '0' WHERE key = 'account_cap'")
    db.execute("UPDATE settings SET value = 'true' WHERE key = 'redeem_paused'")
    assert make(signed_in).json() == {"error": "invites_full"}


def test_unused_invites_go_with_the_account(signed_in, db):
    create(signed_in)
    ready(db)
    code = make(signed_in).json()["code"]
    signed_in.delete("/api/account", headers=HEADERS)
    assert db.execute("SELECT count(*) FROM invites WHERE from_account").fetchone()[0] == 0
    with other_client() as friend:
        assert friend.post("/api/redeem", json={"code": code}, headers=HEADERS).status_code == 400


def test_needs_the_header_and_a_session(client, db):
    assert client.post("/api/invites").status_code == 403
    assert client.get("/api/invites").status_code == 401


def test_admin_turns_it_on_and_the_report_counts_them(signed_in, db, capsys):
    from app import admin

    create(signed_in)
    ready(db, per=0)
    admin.main(["settings", "user_invites", "2"])
    assert db.execute("SELECT value FROM settings WHERE key = 'user_invites'").fetchone()[0] == "2"
    code = make(signed_in).json()["code"]
    make(signed_in)
    with other_client() as friend:
        friend.post("/api/redeem", json={"code": code}, headers=HEADERS)
    admin.report(db, 14)
    out = capsys.readouterr().out
    assert "invites from maintainers: redeemed 1" in out
    assert "invites from accounts: redeemed 1, unused 1" in out
    assert "redeemed 1 of 2 (50%)" in out
