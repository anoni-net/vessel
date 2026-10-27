"""Settings from the environment. Secrets never have defaults."""

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    database_url: str
    # mixed into the Argon2id hash of account numbers; kept outside the database and its backups
    account_pepper: str
    # HMAC key for invite codes and session IDs; kept outside the database and its backups
    hmac_key: str


def load() -> Settings:
    return Settings(
        database_url=os.environ["VESSEL_DATABASE_URL"],
        account_pepper=os.environ["VESSEL_ACCOUNT_PEPPER"],
        hmac_key=os.environ["VESSEL_HMAC_KEY"],
    )
