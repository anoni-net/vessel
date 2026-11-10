"""Inspections a group's leader asks for (toomore/anoni-net-ws#483): the member agrees and confirms on the device, and
the leaders get a summary sealed to their own keys."""

import pytest
from conftest import HEADERS, create, key, needs_db
from test_group_api import browser, join, new_group, page
from test_inspections import FakeAnalysis, finish_it, read

from app import admin, policy, worker
from app.nodes import set_analysis

pytestmark = needs_db


@pytest.fixture
def analysis():
    fake = FakeAnalysis()
    set_analysis(fake)
    yield fake
    set_analysis(None)


def set_key(client, public_key=None):
    return client.put("/api/group/key", json={"public_key": public_key or key()}, headers=HEADERS)


def ask(client, device_id):
    return client.post(f"/api/group/devices/{device_id}/inspection", headers=HEADERS)


def agree(client, device_id, **kw):
    body = {"consent_version": policy.GROUP_INSPECT_CONSENT_VERSION, "public_key": key(), "group": True} | kw
    return client.post(f"/api/devices/{device_id}/inspection", json=body, headers=HEADERS)


def seen(leader, device_id):
    """What the leader's page says of the device's inspection."""
    for a in page(leader)["accounts"]:
        for d in a["devices"]:
            if d["id"] == device_id:
                return d["inspection"]
    raise AssertionError(device_id)


def address(db, device_id):
    return str(db.execute("SELECT tunnel_address FROM devices WHERE id = %s", (device_id,)).fetchone()[0])


def confirmed(member, device_id, node, db):
    code = agree(member, device_id).json()["code"]
    node.confirms.append({"code": code, "address": address(db, device_id)})
    worker.tick(db)


def setup(capsys, client, db, node, limit=2):
    db.execute("INSERT INTO regions (id, node_host, is_open) VALUES ('sg', 'node-sg', true)")
    leader = new_group(capsys, "g1", client=client)
    admin.main(["groups", "set", "g1", "--inspections", str(limit)])
    capsys.readouterr()
    member = join(leader)
    return leader, member, create(member, name="phone").json()["id"]


def test_a_leader_needs_a_key_and_a_recent_sign_in_to_set_it(client, db, node, capsys, analysis):
    leader, member, device_id = setup(capsys, client, db, node)
    assert ask(leader, device_id).json() == {"error": "no_key"}
    assert set_key(leader, "not a key").status_code == 400
    db.execute("UPDATE sessions SET verified_until = now() - interval '1 minute'")
    assert set_key(leader).status_code == 403
    db.execute("UPDATE sessions SET verified_until = now() + interval '5 minutes'")
    mine = key()
    assert set_key(leader, mine).status_code == 200
    assert page(leader)["leader_key"] == mine
    assert set_key(member).status_code == 403


def test_none_is_offered_until_the_maintainer_sets_a_limit(client, db, node, capsys, analysis):
    leader, _member, device_id = setup(capsys, client, db, node, limit=0)
    set_key(leader)
    assert page(leader)["inspection_limit"] == 0
    assert ask(leader, device_id).json() == {"error": "inspection_limit"}


def test_a_request_waits_for_the_member_and_says_nothing_else(client, db, node, capsys, analysis):
    leader, member, device_id = setup(capsys, client, db, node)
    set_key(leader)
    assert ask(leader, device_id).status_code == 200
    assert ask(leader, device_id).status_code == 200
    assert seen(leader, device_id)["status"] == "requested"
    assert page(leader)["inspections_in_use"] == 1
    listed = member.get("/api/devices").json()[0]
    assert listed["inspection_request"]["until"] and listed["inspection"] is None
    assert read(member, device_id)["requested"] is True
    # the member's view of the group has what the leaders see, without a summary
    assert member.get("/api/group/mine").json()["devices"][0]["inspection"] == seen(leader, device_id)


def test_a_member_can_say_no_and_the_leader_can_ask_again(client, db, node, capsys, analysis):
    leader, member, device_id = setup(capsys, client, db, node)
    set_key(leader)
    ask(leader, device_id)
    assert member.post(f"/api/devices/{device_id}/inspection/decline", headers=HEADERS).status_code == 200
    assert seen(leader, device_id)["status"] == "declined"
    assert page(leader)["inspections_in_use"] == 0
    assert member.get("/api/devices").json()[0]["inspection_request"] is None
    assert member.post(f"/api/devices/{device_id}/inspection/decline", headers=HEADERS).status_code == 404
    ask(leader, device_id)
    assert seen(leader, device_id)["status"] == "requested"


def test_agreeing_needs_a_request_and_the_groups_consent(client, db, node, capsys, analysis):
    leader, member, device_id = setup(capsys, client, db, node)
    set_key(leader)
    assert agree(member, device_id).json() == {"error": "not_requested"}
    ask(leader, device_id)
    assert agree(member, device_id, consent_version=policy.INSPECT_CONSENT_VERSION).json() == {"error": "consent_outdated"}
    assert leader.post(f"/api/devices/{device_id}/inspection", json={
        "consent_version": policy.GROUP_INSPECT_CONSENT_VERSION, "public_key": key(), "group": True,
    }, headers=HEADERS).status_code == 404


def test_the_leaders_with_a_key_get_a_summary_and_the_member_the_report(client, db, node, capsys, analysis):
    leader, member, device_id = setup(capsys, client, db, node)
    leader_key = key()
    set_key(leader, leader_key)
    ask(leader, device_id)
    confirmed(member, device_id, node, db)
    shown = seen(leader, device_id)
    assert shown["status"] == "active" and shown["summary"]["key"] == leader_key
    assert read(member, device_id)["group"] is True
    assert member.get("/api/devices").json()[0]["inspection_group"] is True
    assert "summary" not in member.get("/api/group/mine").json()["devices"][0]["inspection"]
    # the refresh seals what there is so far to the leader's key
    worker.tick(db)
    assert analysis.summaries and set(analysis.summaries) == {leader_key}
    assert seen(leader, device_id)["summary"]["sealed"] == {"sealed_to": leader_key}
    refreshed = len(analysis.summaries)
    member.delete(f"/api/devices/{device_id}/inspection", headers=HEADERS)
    finish_it(db)
    shown = seen(leader, device_id)
    assert shown["status"] == "ended" and shown["ended_early"] is True and shown["report_until"]
    assert shown["stopped_at"] < shown["ends_at"]
    assert analysis.summaries[refreshed:] == [leader_key]


def test_a_leader_with_no_key_when_the_member_agreed_gets_none(client, db, node, capsys, analysis):
    leader, member, device_id = setup(capsys, client, db, node)
    set_key(leader)
    second = new_group_leader(capsys, db)
    ask(leader, device_id)
    confirmed(member, device_id, node, db)
    set_key(second, later := key())
    assert seen(second, device_id)["status"] == "active"
    assert seen(second, device_id)["summary"] is None
    worker.tick(db)
    assert analysis.summaries and later not in analysis.summaries


def new_group_leader(capsys, db):
    admin.main(["groups", "leader-invite", "g1", "--label", "L2"])
    second = browser()
    assert second.post("/api/redeem", json={"code": capsys.readouterr().out.strip()}, headers=HEADERS).status_code == 200
    return second


def test_deleting_the_report_deletes_the_summaries_and_says_so(client, db, node, capsys, analysis):
    leader, member, device_id = setup(capsys, client, db, node)
    set_key(leader)
    ask(leader, device_id)
    confirmed(member, device_id, node, db)
    member.delete(f"/api/devices/{device_id}/inspection", headers=HEADERS)
    finish_it(db)
    until = seen(leader, device_id)["report_until"]
    assert member.delete(f"/api/devices/{device_id}/inspection", headers=HEADERS).status_code == 200
    shown = seen(leader, device_id)
    assert shown["status"] == "deleted" and shown["until"] == until and "summary" not in shown
    assert db.execute("SELECT count(*) FROM leader_summaries").fetchone()[0] == 0


def test_a_new_inspection_of_the_members_own_replaces_and_says_so(client, db, node, capsys, analysis):
    leader, member, device_id = setup(capsys, client, db, node)
    set_key(leader)
    ask(leader, device_id)
    confirmed(member, device_id, node, db)
    member.delete(f"/api/devices/{device_id}/inspection", headers=HEADERS)
    finish_it(db)
    member.post(f"/api/devices/{device_id}/inspection",
                json={"consent_version": policy.INSPECT_CONSENT_VERSION, "public_key": key()}, headers=HEADERS)
    assert seen(leader, device_id)["status"] == "deleted"


def test_cancelling_before_the_device_confirms_is_a_no(client, db, node, capsys, analysis):
    leader, member, device_id = setup(capsys, client, db, node)
    set_key(leader)
    ask(leader, device_id)
    agree(member, device_id)
    assert seen(leader, device_id)["status"] == "confirming"
    member.delete(f"/api/devices/{device_id}/inspection", headers=HEADERS)
    assert seen(leader, device_id)["status"] == "declined"


def test_a_link_never_opened_puts_the_request_back(client, db, node, capsys, analysis):
    leader, member, device_id = setup(capsys, client, db, node)
    set_key(leader)
    ask(leader, device_id)
    agree(member, device_id)
    db.execute("UPDATE device_inspections SET code_at = now() - interval '1 hour'")
    worker.tick(db)
    assert seen(leader, device_id)["status"] == "requested"
    assert member.get("/api/devices").json()[0]["inspection_request"] is not None


def test_the_members_own_inspection_is_not_told_even_with_a_request(client, db, node, capsys, analysis):
    leader, member, device_id = setup(capsys, client, db, node)
    set_key(leader)
    ask(leader, device_id)
    code = member.post(f"/api/devices/{device_id}/inspection",
                       json={"consent_version": policy.INSPECT_CONSENT_VERSION, "public_key": key()}, headers=HEADERS).json()["code"]
    node.confirms.append({"code": code, "address": address(db, device_id)})
    worker.tick(db)
    assert seen(leader, device_id)["status"] == "requested"
    assert read(member, device_id)["group"] is False
    assert agree(member, device_id).json() == {"error": "inspection_running"}
    # cancelling one's own does not answer the leader
    member.delete(f"/api/devices/{device_id}/inspection", headers=HEADERS)
    finish_it(db)
    assert seen(leader, device_id)["status"] == "requested"
    assert analysis.summaries == []


def test_withdrawing_is_for_what_the_member_has_not_agreed_to(client, db, node, capsys, analysis):
    leader, member, device_id = setup(capsys, client, db, node)
    set_key(leader)
    ask(leader, device_id)
    assert leader.delete(f"/api/group/devices/{device_id}/inspection", headers=HEADERS).status_code == 200
    assert seen(leader, device_id) is None
    assert member.get("/api/devices").json()[0]["inspection_request"] is None
    ask(leader, device_id)
    agree(member, device_id)
    assert leader.delete(f"/api/group/devices/{device_id}/inspection", headers=HEADERS).json() == {"error": "inspection_started"}
    assert ask(leader, device_id).json() == {"error": "inspection_running"}


def test_the_limit_counts_requests_and_running_ones(client, db, node, capsys, analysis):
    leader, member, device_id = setup(capsys, client, db, node, limit=1)
    set_key(leader)
    other = create(member, name="laptop").json()["id"]
    ask(leader, device_id)
    assert ask(leader, other).json() == {"error": "inspection_limit"}
    confirmed(member, device_id, node, db)
    assert ask(leader, other).json() == {"error": "inspection_limit"}
    member.delete(f"/api/devices/{device_id}/inspection", headers=HEADERS)
    finish_it(db)
    assert ask(leader, other).status_code == 200


def test_another_groups_device_is_not_found(client, db, node, capsys, analysis):
    _leader, member, device_id = setup(capsys, client, db, node)
    other = new_group(capsys, "g2", label="other")
    admin.main(["groups", "set", "g2", "--inspections", "1"])
    set_key(other)
    assert ask(other, device_id).status_code == 404
    assert other.delete(f"/api/group/devices/{device_id}/inspection", headers=HEADERS).status_code == 404
    assert ask(member, device_id).status_code == 403


def test_a_removed_leader_takes_the_key_and_summaries(client, db, node, capsys, analysis):
    leader, member, device_id = setup(capsys, client, db, node)
    set_key(leader)
    second = new_group_leader(capsys, db)
    set_key(second)
    ask(leader, device_id)
    confirmed(member, device_id, node, db)
    assert db.execute("SELECT count(*) FROM leader_summaries").fetchone()[0] == 2
    admin.main(["groups", "remove-leader", "g1", "--label", "L2", "--confirm", "L2"])
    assert db.execute("SELECT count(*) FROM leader_summaries").fetchone()[0] == 1
    assert db.execute("SELECT count(*) FROM leader_keys").fetchone()[0] == 1


def test_a_closing_group_takes_no_requests(client, db, node, capsys, analysis):
    leader, _member, device_id = setup(capsys, client, db, node)
    set_key(leader)
    admin.main(["groups", "close", "g1"])
    assert ask(leader, device_id).json() == {"error": "group_closing"}


def test_what_the_leaders_see_goes_on_its_day(client, db, node, capsys, analysis):
    leader, _member, device_id = setup(capsys, client, db, node)
    set_key(leader)
    ask(leader, device_id)
    db.execute("UPDATE group_inspections SET until = current_date - 1")
    worker.tick(db)
    assert seen(leader, device_id) is None
