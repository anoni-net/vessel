"""Someone holding a signed-in browser for a minute cannot add a passkey of their own, remove the person's, or delete
the account: those need a sign-in within VERIFY_MINUTES, or a confirmation with a passkey or the account number."""

from conftest import HEADERS, make_invite, needs_db
from softkey import SoftKey
from test_passkeys import add

from app import policy

pytestmark = needs_db


def redeem(client, db):
    return client.post("/api/redeem", json={"code": make_invite(db)}, headers=HEADERS).json()["account_number"]


def age(db):
    """The sign-in was longer than VERIFY_MINUTES ago."""
    db.execute("UPDATE sessions SET verified_until = now() - interval '1 second'")


def test_a_fresh_sign_in_counts_then_runs_out(client, db):
    redeem(client, db)
    _, r = add(client)
    assert r.status_code == 200
    age(db)
    assert client.post("/api/passkeys/options", headers=HEADERS).json() == {"error": "verify_required"}
    passkey_id = client.get("/api/passkeys").json()[0]["id"]
    assert client.delete(f"/api/passkeys/{passkey_id}", headers=HEADERS).json() == {"error": "verify_required"}
    assert client.delete("/api/account", headers=HEADERS).json() == {"error": "verify_required"}
    # reading the account still works
    assert client.get("/api/me").status_code == 200
    assert client.get("/api/passkeys").status_code == 200


def test_the_account_number_confirms(client, db):
    number = redeem(client, db)
    age(db)
    r = client.post("/api/account/verify", json={"account_number": "1234 5678 9012 3456"}, headers=HEADERS)
    assert r.status_code == 401 and r.json() == {"error": "invalid_number"}
    assert client.post("/api/account/verify", json={"account_number": "12"}, headers=HEADERS).status_code == 400
    assert client.delete("/api/account", headers=HEADERS).json() == {"error": "verify_required"}
    assert client.post("/api/account/verify", json={"account_number": number}, headers=HEADERS).json() == {"ok": True}
    assert client.delete("/api/account", headers=HEADERS).status_code == 200


def test_another_accounts_number_does_not_confirm(client, db):
    other = redeem(client, db)
    client.post("/api/logout", headers=HEADERS)
    redeem(client, db)
    age(db)
    r = client.post("/api/account/verify", json={"account_number": other}, headers=HEADERS)
    assert r.json() == {"error": "invalid_number"}


def test_a_passkey_of_the_account_confirms(client, db):
    redeem(client, db)
    key, _ = add(client)
    age(db)
    # a passkey of another account, or one never seen, does not
    options = client.post("/api/account/verify/options", headers=HEADERS).json()
    r = client.post("/api/account/verify", json={"credential": SoftKey().get(options)}, headers=HEADERS)
    assert r.json() == {"error": "invalid_passkey"}
    options = client.post("/api/account/verify/options", headers=HEADERS).json()
    assert client.post("/api/account/verify", json={"credential": key.get(options)}, headers=HEADERS).json() == {"ok": True}
    assert client.post("/api/passkeys/options", headers=HEADERS).status_code == 200
    # the confirmation lasts VERIFY_MINUTES too
    verified = db.execute("SELECT verified_until - now() FROM sessions").fetchone()[0]
    assert verified.total_seconds() <= policy.VERIFY_MINUTES * 60


def test_without_a_passkey_only_the_number_confirms(client, db):
    redeem(client, db)
    assert client.post("/api/account/verify/options", headers=HEADERS).json() == {"error": "no_passkey"}


def test_a_confirmation_is_for_this_browser_only(client, db):
    number = redeem(client, db)
    first = client.cookies.get("__Host-vessel")
    client.post("/api/login", json={"account_number": number}, headers=HEADERS)
    age(db)
    assert client.post("/api/account/verify", json={"account_number": number}, headers=HEADERS).json() == {"ok": True}
    client.cookies.set("__Host-vessel", first)
    assert client.delete("/api/account", headers=HEADERS).json() == {"error": "verify_required"}


def test_sessions_from_before_the_change_ask_first(client, db):
    redeem(client, db)
    db.execute("UPDATE sessions SET verified_until = NULL")
    assert client.post("/api/passkeys/options", headers=HEADERS).json() == {"error": "verify_required"}
