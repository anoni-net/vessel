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

from app import auth, blocklists, check, crypto, migrate, network
from app.config import load
from app.main import app
from app.nodes import NodeError, set_node

needs_db = pytest.mark.skipif(not DB_URL, reason="VESSEL_TEST_DATABASE_URL not set")
HEADERS = {"X-Vessel-Request": "1"}


@pytest.fixture(autouse=True)
def no_blocklist_downloads(monkeypatch):
    # the app fetches the DNS blocklists from HaGeZi when it starts; tests never reach the network
    monkeypatch.setattr(blocklists, "_rcode", lambda host, server, port=53: 0)
    monkeypatch.setattr(network, "refresh_in_background", lambda: None)
    monkeypatch.setattr(blocklists, "refresh_in_background", lambda force=False: None)


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
            "TRUNCATE groups, accounts, invites, sessions, regions, relays, devices, account_usage, device_counters, jobs, heartbeats, node_totals CASCADE"
        )
        conn.execute("UPDATE settings SET value = '0' WHERE key = 'account_cap'")
        conn.execute("UPDATE settings SET value = 'false' WHERE key = 'redeem_paused'")
        conn.execute("UPDATE settings SET value = '0' WHERE key = 'user_invites'")
        conn.execute("UPDATE settings SET value = '50' WHERE key = 'monthly_quota_gb'")
        yield conn


@pytest.fixture
def client(db):
    auth.sign_in_limiter.reset()
    check.check_limiter.reset()
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
        self.blocked_ads: dict[str, int] = {}
        self.handshakes: dict[str, int] = {}
        self.started = "2026-10-27T00:00:00Z"
        self.down = False
        # what node/host/vessel-reach.py last wrote, or None before its first run
        self.reach_result: dict | None = None
        self.reach_calls = 0
        self.totals = None  # the node's own counts in usage; None like a node from before they were added
        # device inspection
        self.inspecting: dict[str, int] = {}
        self.confirms: list[dict] = []
        self.acked: list[str] = []
        # devices held to a low speed (awgctl throttle)
        self.throttled: set[str] = set()

    def add_pubkey(self, host, device_id, public_key, psk, dns_filter):
        if self.down:
            raise NodeError("timeout")
        if device_id in self.peers:
            raise NodeError(f"awgctl: {device_id} already exists")
        n = len(self.peers) + 2
        self.peers[device_id] = {"public_key": public_key, "psk": psk, "dns_filter": dns_filter}
        return {"name": device_id,
                "interface": {"Address": f"10.8.1.{n}/32, fd60:f74e:973c::{n}/128", "DNS": "10.8.1.1", "MTU": "1280", "Jc": "5"},
                "peer": {"PublicKey": "srv", "AllowedIPs": "0.0.0.0/0, ::/0", "Endpoint": "198.51.100.1:443"}}

    def remove(self, host, device_id):
        if self.down:
            raise NodeError("timeout")
        self.peers.pop(device_id, None)
        self.suspended.pop(device_id, None)
        self.throttled.discard(device_id)

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

    def throttle_on(self, host, device_id):
        if self.down:
            raise NodeError("timeout")
        if device_id in self.peers or device_id in self.suspended:
            self.throttled.add(device_id)

    def throttle_off(self, host, device_id):
        if self.down:
            raise NodeError("timeout")
        self.throttled.discard(device_id)

    def inspect_on(self, host, device_id, until):
        if self.down:
            raise NodeError("timeout")
        self.inspecting[device_id] = until

    def inspect_off(self, host, device_id):
        if self.down:
            raise NodeError("timeout")
        self.inspecting.pop(device_id, None)

    def inspect_confirms(self, host):
        if self.down:
            raise NodeError("timeout")
        return list(self.confirms)

    def inspect_ack(self, host, code):
        self.acked.append(code)
        self.confirms = [c for c in self.confirms if c["code"] != code]

    def list_peers(self, host):
        if self.down:
            raise NodeError("timeout")
        return [{"name": n} for n in self.peers]

    def reach(self, host):
        self.reach_calls += 1
        if self.down or self.reach_result is None:
            raise NodeError("cat: /opt/vessel-node/reach.json: No such file or directory")
        return self.reach_result

    def usage(self, host):
        if self.down:
            raise NodeError("timeout")
        return {"interface_started": self.started,
                "peers": [{"name": n, "rx": self.counters.get(n, (0, 0))[0], "tx": self.counters.get(n, (0, 0))[1],
                           "latest_handshake": self.handshakes.get(n, 0), "blocked": self.blocked.get(n, 0),
                           "blocked_ads": self.blocked_ads.get(n, 0), "throttled": n in self.throttled}
                          for n in self.peers], **({} if self.totals is None else {"totals": self.totals})}


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
