"""Tests run against a real PostgreSQL given by VESSEL_TEST_DATABASE_URL; its public schema is recreated."""

import os

import psycopg
import pytest
from fastapi.testclient import TestClient

DB_URL = os.environ.get("VESSEL_TEST_DATABASE_URL")
os.environ.setdefault("VESSEL_DATABASE_URL", DB_URL or "postgresql:///unused")
os.environ.setdefault("VESSEL_ACCOUNT_PEPPER", "test-pepper")
os.environ.setdefault("VESSEL_HMAC_KEY", "test-hmac-key")

from app import auth, crypto, migrate
from app.config import load
from app.main import app

needs_db = pytest.mark.skipif(not DB_URL, reason="VESSEL_TEST_DATABASE_URL not set")
HEADERS = {"X-Vessel-Request": "1"}


@pytest.fixture(scope="session")
def schema():
    if not DB_URL:
        pytest.skip("VESSEL_TEST_DATABASE_URL not set")
    with psycopg.connect(DB_URL, autocommit=True) as conn:
        conn.execute("DROP SCHEMA public CASCADE")
        conn.execute("CREATE SCHEMA public")
    migrate.main()


@pytest.fixture
def db(schema):
    with psycopg.connect(DB_URL, autocommit=True) as conn:
        conn.execute("TRUNCATE accounts, invites, sessions, regions, devices, account_usage, device_counters, jobs CASCADE")
        conn.execute("UPDATE settings SET value = '0' WHERE key = 'account_cap'")
        conn.execute("UPDATE settings SET value = 'false' WHERE key = 'redeem_paused'")
        yield conn


@pytest.fixture
def client(db):
    auth.sign_in_limiter.reset()
    # the session cookie is Secure, so the test client has to speak https
    with TestClient(app, base_url="https://testserver") as c:
        yield c


def make_invite(conn, days: int = 30) -> str:
    code = crypto.new_invite_code()
    conn.execute(
        "INSERT INTO invites (code_hmac, expires_at) VALUES (%s, now() + make_interval(days => %s))",
        (crypto.keyed_hash(load().hmac_key, crypto.normalize_invite_code(code)), days),
    )
    return code
