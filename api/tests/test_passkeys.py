from conftest import HEADERS, make_invite, needs_db
from softkey import SoftKey

pytestmark = needs_db


def add(client, key=None, label="phone"):
    key = key or SoftKey()
    options = client.post("/api/passkeys/options", headers=HEADERS).json()
    return key, client.post("/api/passkeys", json={"credential": key.create(options), "label": label}, headers=HEADERS)


def sign_in(client, key):
    options = client.post("/api/passkeys/login/options", headers=HEADERS).json()
    return client.post("/api/passkeys/login", json={"credential": key.get(options)}, headers=HEADERS)


def test_add_a_passkey_and_sign_in_with_it(signed_in, db):
    options = signed_in.post("/api/passkeys/options", headers=HEADERS).json()
    assert options["rp"] == {"id": "vessel.anoni.net", "name": "Vessel"}
    assert options["authenticatorSelection"]["residentKey"] == "required"
    assert options["attestation"] == "none"
    # the name in the password manager says only the service and the day the account was made
    assert options["user"]["name"].startswith("Vessel 20")
    key = SoftKey()
    r = signed_in.post("/api/passkeys", json={"credential": key.create(options), "label": " iPhone "}, headers=HEADERS)
    assert r.status_code == 200
    assert [(p["label"]) for p in r.json()] == ["iPhone"]
    assert db.execute("SELECT count(*) FROM webauthn_challenges").fetchone()[0] == 0

    signed_in.post("/api/logout", headers=HEADERS)
    assert signed_in.get("/api/me").status_code == 401
    assert sign_in(signed_in, key).status_code == 200
    assert signed_in.get("/api/me").status_code == 200


def test_answers_that_do_not_count(signed_in, db):
    key, _ = add(signed_in)
    signed_in.post("/api/logout", headers=HEADERS)
    # signed for another site
    options = signed_in.post("/api/passkeys/login/options", headers=HEADERS).json()
    r = signed_in.post("/api/passkeys/login", json={"credential": key.get(options, origin="https://evil.example")}, headers=HEADERS)
    assert r.status_code == 401
    # the same challenge cannot be used twice, even with a good signature
    r = signed_in.post("/api/passkeys/login", json={"credential": key.get(options)}, headers=HEADERS)
    assert r.json() == {"error": "passkey_expired"}
    # a passkey this service never saw
    assert sign_in(signed_in, SoftKey()).json() == {"error": "invalid_passkey"}
    # a challenge that ran out
    options = signed_in.post("/api/passkeys/login/options", headers=HEADERS).json()
    db.execute("UPDATE webauthn_challenges SET expires_at = now() - interval '1 second'")
    assert signed_in.post("/api/passkeys/login", json={"credential": key.get(options)}, headers=HEADERS).json() == {"error": "passkey_expired"}
    assert signed_in.post("/api/passkeys/login", json={"credential": {"response": {}}}, headers=HEADERS).status_code == 400


def test_at_most_five_and_delete(signed_in, client, db):
    for i in range(5):
        assert add(signed_in, label=f"k{i}")[1].status_code == 200
    assert signed_in.post("/api/passkeys/options", headers=HEADERS).json() == {"error": "passkey_limit"}
    first = signed_in.get("/api/passkeys").json()[0]["id"]
    assert [p["label"] for p in signed_in.delete(f"/api/passkeys/{first}", headers=HEADERS).json()] == ["k1", "k2", "k3", "k4"]
    assert signed_in.delete(f"/api/passkeys/{first}", headers=HEADERS).status_code == 404
    # someone else's passkey cannot be deleted
    other = signed_in.get("/api/passkeys").json()[0]["id"]
    signed_in.post("/api/logout", headers=HEADERS)
    client.post("/api/redeem", json={"code": make_invite(db)}, headers=HEADERS)
    assert client.delete(f"/api/passkeys/{other}", headers=HEADERS).status_code == 404
    assert client.get("/api/passkeys").json() == []


def test_replace_the_account_number_with_a_passkey(signed_in, client, db):
    # without a passkey there is nothing to confirm it with
    assert signed_in.post("/api/account/number/options", headers=HEADERS).json() == {"error": "no_passkey"}
    key, _ = add(signed_in)
    # another browser signed in to the same account, as someone holding the old number would be
    sessions_before = db.execute("SELECT count(*) FROM sessions").fetchone()[0]
    sign_in(client.__class__(signed_in.app, base_url="https://testserver"), key)
    assert db.execute("SELECT count(*) FROM sessions").fetchone()[0] == sessions_before + 1

    options = signed_in.post("/api/account/number/options", headers=HEADERS).json()
    assert [c["id"] for c in options["allowCredentials"]] == [key.get(options)["id"]]
    r = signed_in.post("/api/account/number", json={"credential": key.get(options)}, headers=HEADERS)
    number = r.json()["account_number"]
    assert len(number.replace(" ", "")) == 16
    # this browser stays in; every other session of the account is gone
    assert signed_in.get("/api/me").status_code == 200
    assert db.execute("SELECT count(*) FROM sessions").fetchone()[0] == sessions_before
    signed_in.post("/api/logout", headers=HEADERS)
    assert signed_in.post("/api/login", json={"account_number": number}, headers=HEADERS).status_code == 200


def test_another_accounts_passkey_cannot_replace_the_number(signed_in, client, db):
    key, _ = add(signed_in)
    signed_in.post("/api/logout", headers=HEADERS)
    client.post("/api/redeem", json={"code": make_invite(db)}, headers=HEADERS)
    add(client)
    options = client.post("/api/account/number/options", headers=HEADERS).json()
    assert client.post("/api/account/number", json={"credential": key.get(options)}, headers=HEADERS).json() == {"error": "invalid_passkey"}
