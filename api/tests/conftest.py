"""Tests run against a real PostgreSQL given by VESSEL_TEST_DATABASE_URL; its public schema is recreated."""

import base64
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
from app.nodes import NodeError, set_node

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
        conn.execute(
            "TRUNCATE accounts, invites, sessions, regions, devices, account_usage, device_counters, jobs, heartbeats CASCADE"
        )
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


def key() -> str:
    return base64.b64encode(os.urandom(32)).decode()


class FakeNode:
    """Stands in for awgctl on a node."""

    def __init__(self):
        self.peers: dict[str, dict] = {}
        self.suspended: dict[str, dict] = {}
        self.counters: dict[str, tuple[int, int]] = {}
        self.blocked: dict[str, int] = {}
        self.handshakes: dict[str, int] = {}
        self.started = "2026-10-27T00:00:00Z"
        self.down = False

    def add_pubkey(self, host, device_id, public_key, psk, dns_filter):
        if self.down:
            raise NodeError("timeout")
        if device_id in self.peers:
            raise NodeError(f"awgctl: {device_id} already exists")
        n = len(self.peers) + 2
        self.peers[device_id] = {"public_key": public_key, "psk": psk, "dns_filter": dns_filter}
        return {"name": device_id,
                "interface": {"Address": f"10.8.1.{n}/32", "DNS": "10.8.1.1", "MTU": "1280", "Jc": "5"},
                "peer": {"PublicKey": "srv", "AllowedIPs": "0.0.0.0/0, ::/0", "Endpoint": "198.51.100.1:443"}}

    def remove(self, host, device_id):
        if self.down:
            raise NodeError("timeout")
        self.peers.pop(device_id, None)
        self.suspended.pop(device_id, None)

    def suspend(self, host, device_id):
        if self.down:
            raise NodeError("timeout")
        if device_id in self.peers:
            self.suspended[device_id] = self.peers.pop(device_id)

    def resume(self, host, device_id):
        if self.down:
            raise NodeError("timeout")
        if device_id in self.suspended:
            self.peers[device_id] = self.suspended.pop(device_id)
            self.counters[device_id] = (0, 0)

    def usage(self, host):
        if self.down:
            raise NodeError("timeout")
        return {"interface_started": self.started,
                "peers": [{"name": n, "rx": self.counters.get(n, (0, 0))[0], "tx": self.counters.get(n, (0, 0))[1],
                           "latest_handshake": self.handshakes.get(n, 0), "blocked": self.blocked.get(n, 0)} for n in self.peers]}


@pytest.fixture
def node():
    fake = FakeNode()
    set_node(fake)
    yield fake
    set_node(None)


@pytest.fixture
def signed_in(client, db, node):
    db.execute("INSERT INTO regions (id, node_host, is_open) VALUES ('sg', 'node-sg', true), ('jp', 'node-jp', false)")
    client.post("/api/redeem", json={"code": make_invite(db)}, headers=HEADERS)
    return client


def create(client, **kw):
    body = {"name": "phone", "region": "sg", "dns_filter": "ads", "public_key": key(), "preshared_key": key()} | kw
    return client.post("/api/devices", json=body, headers=HEADERS)
