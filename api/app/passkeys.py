"""Passkeys (WebAuthn): signing in without typing the account number, and replacing the number when it is lost
or seen by someone else (toomore/anoni-net-ws#444).

The account number stays the account; a passkey is another way in. The browser and the person's password
manager or security key do the checking; the backend keeps the public key, a name the person chose and the day
it was added. The relying party is vessel.anoni.net, so a passkey made here works nowhere else on anoni.net.
"""

import json
import os
import secrets
from typing import Annotated, Any

import psycopg
from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel, Field
from webauthn import (
    generate_authentication_options,
    generate_registration_options,
    options_to_json,
    verify_authentication_response,
    verify_registration_response,
)
from webauthn.helpers import base64url_to_bytes
from webauthn.helpers.exceptions import InvalidAuthenticationResponse, InvalidRegistrationResponse
from webauthn.helpers.structs import (
    AuthenticatorSelectionCriteria,
    PublicKeyCredentialDescriptor,
    ResidentKeyRequirement,
    UserVerificationRequirement,
)

from app import crypto, policy
from app.auth import COOKIE, Account, Conn, error, keep_alive, limit, require_app_header, start_session
from app.config import load

router = APIRouter(prefix="/api")

RP_ID = os.environ.get("VESSEL_RP_ID", "vessel.anoni.net")
ORIGIN = os.environ.get("VESSEL_ORIGIN", f"https://{RP_ID}")
CHALLENGE_SECONDS = 300


class Credential(BaseModel):
    # what the browser returned, as PublicKeyCredential.toJSON() gives it
    credential: dict[str, Any]


class NewPasskey(Credential):
    label: Annotated[str, Field(max_length=40)] = ""


def options(opts) -> dict:
    return json.loads(options_to_json(opts))


def new_challenge(conn: psycopg.Connection, purpose: str, account_id: int | None = None) -> bytes:
    conn.execute("DELETE FROM webauthn_challenges WHERE expires_at <= now()")
    challenge = secrets.token_bytes(32)
    conn.execute(
        "INSERT INTO webauthn_challenges (challenge, purpose, account_id, expires_at) "
        "VALUES (%s, %s, %s, now() + make_interval(secs => %s))",
        (challenge, purpose, account_id, CHALLENGE_SECONDS),
    )
    return challenge


def take_challenge(conn: psycopg.Connection, credential: dict, purpose: str, account_id: int | None = None) -> bytes:
    """The challenge this answer signed, used up. The browser puts it in clientDataJSON, which the signature covers.
    Call it outside a transaction: a failed check rolls the transaction back, and the challenge must stay used."""
    try:
        client = json.loads(base64url_to_bytes(credential["response"]["clientDataJSON"]))
        challenge = base64url_to_bytes(client["challenge"])
    except (KeyError, TypeError, ValueError):
        raise error(400, "invalid_passkey")
    row = conn.execute(
        "DELETE FROM webauthn_challenges WHERE challenge = %s AND purpose = %s AND expires_at > now() "
        "AND account_id IS NOT DISTINCT FROM %s RETURNING challenge",
        (challenge, purpose, account_id),
    ).fetchone()
    if row is None:
        raise error(400, "passkey_expired")
    return challenge


def credential_id(credential: dict) -> bytes:
    try:
        return base64url_to_bytes(credential.get("rawId") or credential["id"])
    except (KeyError, TypeError, ValueError):
        raise error(400, "invalid_passkey")


def check(conn: psycopg.Connection, credential: dict, challenge: bytes, account_id: int | None = None) -> int:
    """Verify a signed answer from a passkey; returns the account it belongs to."""
    row = conn.execute(
        "SELECT p.id, p.public_key, p.sign_count, a.id, a.webauthn_user_id FROM passkeys p "
        "JOIN accounts a ON a.id = p.account_id WHERE p.credential_id = %s AND a.status = 'active'",
        (credential_id(credential),),
    ).fetchone()
    if row is None or (account_id is not None and row[3] != account_id):
        raise error(401, "invalid_passkey")
    passkey_id, public_key, sign_count, owner, user_id = row
    handle = (credential.get("response") or {}).get("userHandle")
    try:
        if handle and base64url_to_bytes(handle) != bytes(user_id):
            raise error(401, "invalid_passkey")
        verified = verify_authentication_response(
            credential=credential, expected_challenge=challenge, expected_rp_id=RP_ID, expected_origin=ORIGIN,
            credential_public_key=bytes(public_key), credential_current_sign_count=sign_count,
        )
    except (InvalidAuthenticationResponse, ValueError):
        raise error(401, "invalid_passkey")
    conn.execute("UPDATE passkeys SET sign_count = %s WHERE id = %s", (verified.new_sign_count, passkey_id))
    return owner


def descriptors(conn: psycopg.Connection, account_id: int) -> list[PublicKeyCredentialDescriptor]:
    rows = conn.execute("SELECT credential_id FROM passkeys WHERE account_id = %s", (account_id,))
    return [PublicKeyCredentialDescriptor(id=bytes(r[0])) for r in rows]


@router.get("/passkeys")
def list_passkeys(account_id: Account, conn: Conn) -> list[dict]:
    rows = conn.execute(
        "SELECT id, label, created_on FROM passkeys WHERE account_id = %s ORDER BY id", (account_id,)
    )
    return [{"id": r[0], "label": r[1], "created_on": r[2].isoformat()} for r in rows]


@router.post("/passkeys/options", dependencies=[Depends(require_app_header)])
def register_options(account_id: Account, conn: Conn) -> dict:
    with conn.transaction():
        count = conn.execute("SELECT count(*) FROM passkeys WHERE account_id = %s", (account_id,)).fetchone()[0]
        if count >= policy.PASSKEY_LIMIT:
            raise error(409, "passkey_limit")
        # a random handle for this account, so the password manager never holds the account's id or number
        user_id = conn.execute(
            "UPDATE accounts SET webauthn_user_id = coalesce(webauthn_user_id, %s) WHERE id = %s "
            "RETURNING webauthn_user_id, created_on",
            (secrets.token_bytes(32), account_id),
        ).fetchone()
        challenge = new_challenge(conn, "register", account_id)
        exclude = descriptors(conn, account_id)
    # the name the password manager lists it under: the service and the day the account was made, nothing more
    name = f"Vessel {user_id[1].isoformat()}"
    return options(generate_registration_options(
        rp_id=RP_ID, rp_name="Vessel", user_id=bytes(user_id[0]), user_name=name, user_display_name=name,
        challenge=challenge, timeout=CHALLENGE_SECONDS * 1000, exclude_credentials=exclude,
        authenticator_selection=AuthenticatorSelectionCriteria(
            resident_key=ResidentKeyRequirement.REQUIRED, user_verification=UserVerificationRequirement.PREFERRED,
        ),
    ))


@router.post("/passkeys", dependencies=[Depends(require_app_header)])
def add_passkey(body: NewPasskey, account_id: Account, conn: Conn) -> list[dict]:
    challenge = take_challenge(conn, body.credential, "register", account_id)
    with conn.transaction():
        try:
            verified = verify_registration_response(
                credential=body.credential, expected_challenge=challenge, expected_rp_id=RP_ID, expected_origin=ORIGIN,
            )
        except (InvalidRegistrationResponse, ValueError):
            raise error(400, "invalid_passkey")
        conn.execute("SELECT id FROM accounts WHERE id = %s FOR UPDATE", (account_id,))
        count = conn.execute("SELECT count(*) FROM passkeys WHERE account_id = %s", (account_id,)).fetchone()[0]
        if count >= policy.PASSKEY_LIMIT:
            raise error(409, "passkey_limit")
        try:
            with conn.transaction():
                conn.execute(
                    "INSERT INTO passkeys (account_id, credential_id, public_key, sign_count, label) "
                    "VALUES (%s, %s, %s, %s, %s)",
                    (account_id, verified.credential_id, verified.credential_public_key, verified.sign_count,
                     body.label.strip()),
                )
        except psycopg.errors.UniqueViolation:
            raise error(409, "passkey_in_use")
    return list_passkeys(account_id, conn)


@router.delete("/passkeys/{passkey_id}", dependencies=[Depends(require_app_header)])
def delete_passkey(passkey_id: int, account_id: Account, conn: Conn) -> list[dict]:
    if conn.execute(
        "DELETE FROM passkeys WHERE id = %s AND account_id = %s RETURNING id", (passkey_id, account_id)
    ).fetchone() is None:
        raise error(404, "not_found")
    return list_passkeys(account_id, conn)


@router.post("/passkeys/login/options", dependencies=[Depends(require_app_header), Depends(limit)])
def login_options(conn: Conn) -> dict:
    # no account yet and no list of credentials: the browser offers the passkeys it has for this site
    challenge = new_challenge(conn, "login")
    return options(generate_authentication_options(
        rp_id=RP_ID, challenge=challenge, timeout=CHALLENGE_SECONDS * 1000,
        user_verification=UserVerificationRequirement.PREFERRED,
    ))


@router.post("/passkeys/login", dependencies=[Depends(require_app_header), Depends(limit)])
def login(body: Credential, response: Response, conn: Conn) -> dict[str, bool]:
    challenge = take_challenge(conn, body.credential, "login")
    with conn.transaction():
        account_id = check(conn, body.credential, challenge)
        keep_alive(conn, account_id)
        conn.execute("DELETE FROM sessions WHERE expires_at <= now()")
        start_session(conn, response, account_id)
    return {"ok": True}


@router.post("/account/number/options", dependencies=[Depends(require_app_header)])
def rotate_options(account_id: Account, conn: Conn) -> dict:
    with conn.transaction():
        allow = descriptors(conn, account_id)
        if not allow:
            raise error(409, "no_passkey")
        challenge = new_challenge(conn, "rotate", account_id)
    # signed in already, but replacing the number asks for one of this account's passkeys again, right now
    return options(generate_authentication_options(
        rp_id=RP_ID, challenge=challenge, timeout=CHALLENGE_SECONDS * 1000, allow_credentials=allow,
        user_verification=UserVerificationRequirement.PREFERRED,
    ))


@router.post("/account/number", dependencies=[Depends(require_app_header)])
def rotate_number(body: Credential, request: Request, account_id: Account, conn: Conn) -> dict[str, str]:
    settings = load()
    challenge = take_challenge(conn, body.credential, "rotate", account_id)
    with conn.transaction():
        check(conn, body.credential, challenge, account_id)
        while True:
            number = crypto.new_account_number()
            try:
                with conn.transaction():
                    conn.execute(
                        "UPDATE accounts SET number_hash = %s WHERE id = %s",
                        (crypto.hash_account_number(number, settings.account_pepper), account_id),
                    )
                break
            except psycopg.errors.UniqueViolation:
                continue
        # whoever signed in elsewhere, perhaps with the old number, is signed out; this browser stays in
        conn.execute(
            "DELETE FROM sessions WHERE account_id = %s AND id_hmac <> %s",
            (account_id, crypto.keyed_hash(settings.hmac_key, request.cookies.get(COOKIE, ""))),
        )
    return {"account_number": crypto.format_account_number(number)}
