"""A deleted device has to come off its node, whatever the node was doing at the time."""

import pytest
from conftest import HEADERS, create, needs_db

from app import jobs, worker
from app.nodes import NodeError, SSHNode

pytestmark = needs_db


def retry(db, times=1):
    for _ in range(times):
        db.execute("UPDATE jobs SET next_try_at = now()")
        worker.tick(db, usage=False)


def test_remove_keeps_trying_until_the_node_answers(signed_in, node, db):
    device_id = create(signed_in).json()["id"]
    node.down = True
    assert signed_in.delete(f"/api/devices/{device_id}", headers=HEADERS).status_code == 200
    retry(db, jobs.MAX_ATTEMPTS + 2)
    assert db.execute("SELECT status FROM jobs WHERE action = 'remove'").fetchone()[0] == "queued"
    node.down = False
    retry(db)
    assert device_id not in node.peers
    assert db.execute("SELECT count(*) FROM devices").fetchone()[0] == 0


def test_deleting_a_device_twice_queues_one_remove(signed_in, node, db):
    device_id = create(signed_in).json()["id"]
    node.down = True
    for _ in range(3):
        assert signed_in.delete(f"/api/devices/{device_id}", headers=HEADERS).status_code == 200
    assert db.execute("SELECT count(*) FROM jobs WHERE action = 'remove'").fetchone()[0] == 1


def test_deleting_the_account_drops_an_add_still_waiting(signed_in, node, db):
    node.down = True
    device_id = create(signed_in).json()["id"]
    assert signed_in.delete("/api/account", headers=HEADERS).status_code == 200
    node.down = False
    # the remove runs first, while the add is still waiting out its backoff
    worker.tick(db, usage=False)
    retry(db)
    assert device_id not in node.peers
    assert db.execute("SELECT payload FROM jobs WHERE action = 'add'").fetchone()[0] is None


def test_an_add_for_a_device_gone_meanwhile_does_not_reach_the_node(signed_in, node, db):
    node.down = True
    device_id = create(signed_in).json()["id"]
    # the row went some other way, with the add still queued
    db.execute("DELETE FROM devices")
    node.down = False
    retry(db)
    assert device_id not in node.peers


def test_a_suspend_that_waited_past_the_resume_is_dropped(signed_in, node, db):
    device_id = create(signed_in).json()["id"]
    region = "sg"
    db.execute("UPDATE devices SET status = 'suspended'")
    db.execute("INSERT INTO jobs (region_id, device_id, action, next_try_at) VALUES (%s, %s, 'suspend', now() + interval '1 hour')",
               (region, device_id))
    db.execute("INSERT INTO jobs (region_id, device_id, action) VALUES (%s, %s, 'resume')", (region, device_id))
    node.suspend("node-sg", device_id)
    worker.tick(db, usage=False)
    assert device_id in node.peers
    retry(db)
    assert device_id in node.peers and device_id not in node.suspended


def test_peers_without_a_device_are_removed(signed_in, node, db):
    device_id = create(signed_in).json()["id"]
    node.peers["d-leftover0001"] = {}
    node.peers["awg-test"] = {}
    assert jobs.reconcile_peers(db) == 1
    retry(db)
    assert set(node.peers) == {device_id, "awg-test"}
    # once an hour per region
    node.peers["d-leftover0002"] = {}
    assert jobs.reconcile_peers(db) == 0


def test_many_peers_without_a_device_are_left_to_a_person(signed_in, node, db, capsys):
    for i in range(jobs.RECONCILE_MAX + 1):
        node.peers[f"d-leftover{i:04d}"] = {}
    assert jobs.reconcile_peers(db) == 0
    assert "left alone" in capsys.readouterr().err
    assert len(node.peers) == jobs.RECONCILE_MAX + 1


@pytest.mark.parametrize(("stderr", "gone"), [
    ("awgctl: d-abcdefghijkl not found", True),
    ("OCI runtime exec failed: exec: \"awg\": executable file not found in $PATH", False),
])
def test_only_awgctls_own_not_found_counts_as_removed(monkeypatch, stderr, gone):
    ssh = SSHNode("key", "known_hosts")

    def run(host, *args):
        raise NodeError(stderr)

    monkeypatch.setattr(ssh, "_run", run)
    for call in (ssh.remove, ssh.suspend):
        if gone:
            call("node", "d-abcdefghijkl")
        else:
            with pytest.raises(NodeError):
                call("node", "d-abcdefghijkl")
