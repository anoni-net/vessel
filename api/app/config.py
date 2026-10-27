"""Settings from the environment. Secrets never have defaults."""

import os
from dataclasses import dataclass
from functools import lru_cache


@dataclass(frozen=True)
class Settings:
    database_url: str
    # mixed into the Argon2id hash of account numbers; kept outside the database and its backups
    account_pepper: str
    # HMAC key for invite codes and session tokens; kept outside the database and its backups
    hmac_key: str


@lru_cache
def load() -> Settings:
    return Settings(
        database_url=os.environ["VESSEL_DATABASE_URL"],
        account_pepper=os.environ["VESSEL_ACCOUNT_PEPPER"],
        hmac_key=os.environ["VESSEL_HMAC_KEY"],
    )
