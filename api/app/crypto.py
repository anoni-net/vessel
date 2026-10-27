"""Account numbers, invite codes and session tokens.

Account numbers are 16 random digits (about 53 bits, the same as Mullvad). The database keeps only an
Argon2id hash, made deterministic with a fixed salt so a sign-in can look the account up, and keyed with a
pepper that lives outside the database and its backups. Leaking the database alone reveals nothing; leaking
it together with the pepper still makes every guess cost one Argon2id run.
"""

import hashlib
import hmac
import secrets

from argon2.low_level import Type, hash_secret_raw

NUMBER_DIGITS = 16
# Crockford base32: no I, L, O or U, so codes survive being read aloud or copied by hand
INVITE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
INVITE_LENGTH = 16  # 80 bits


def new_account_number() -> str:
    return f"{secrets.randbelow(10**NUMBER_DIGITS):0{NUMBER_DIGITS}d}"


def normalize_account_number(raw: str) -> str | None:
    digits = "".join(ch for ch in raw if not ch.isspace() and ch != "-")
    return digits if len(digits) == NUMBER_DIGITS and digits.isascii() and digits.isdigit() else None


def format_account_number(number: str) -> str:
    return " ".join(number[i:i + 4] for i in range(0, NUMBER_DIGITS, 4))


def hash_account_number(number: str, pepper: str) -> bytes:
    salt = hashlib.sha256(b"vessel-account-salt:" + pepper.encode()).digest()[:16]
    return hash_secret_raw(
        secret=number.encode(), salt=salt, time_cost=3, memory_cost=64 * 1024, parallelism=1,
        hash_len=32, type=Type.ID,
    )


def new_invite_code() -> str:
    code = "".join(secrets.choice(INVITE_ALPHABET) for _ in range(INVITE_LENGTH))
    return "-".join(code[i:i + 4] for i in range(0, INVITE_LENGTH, 4))


def normalize_invite_code(raw: str) -> str | None:
    code = raw.upper().translate(str.maketrans({"I": "1", "L": "1", "O": "0"}))
    code = "".join(ch for ch in code if not ch.isspace() and ch != "-")
    if len(code) != INVITE_LENGTH or any(ch not in INVITE_ALPHABET for ch in code):
        return None
    return code


def keyed_hash(key: str, value: str) -> bytes:
    return hmac.new(key.encode(), value.encode(), hashlib.sha256).digest()


def new_session_token() -> str:
    return secrets.token_urlsafe(32)
