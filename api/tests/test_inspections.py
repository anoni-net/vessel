import datetime as dt

import pytest
from conftest import HEADERS, create, key, make_invite, needs_db
from fastapi.testclient import TestClient

from app import inspections, policy, worker
from app.main import app
from app.nodes import NodeError, set_analysis

pytestmark = needs_db
SEALED = {"epk": "e", "iv": "i", "ct": "c"}


class FakeAnalysis:
    def __init__(self):
        self.cleared, self.down, self.reports, self.flushes, self.waiting = [], False, 0, 0, 0
        self.connected = ["sg"]
        self.summaries: list[str] = []  # the keys each summary was sealed to

    def report(self, node, address, public_key):
        if self.down:
            raise NodeError("timeout")
        self.reports += 1
        return SEALED

    def summary(self, node, address, public_key):
        if self.down:
            raise NodeError("timeout")
        self.summaries.append(public_key)
        return {"sealed_to": public_key}

    def clear(self, node, address):
        if self.down:
            raise NodeError("timeout")
        self.cleared.append((node, address))

    def status(self):
        if self.down:
            raise NodeError("timeout")
        return {"last_batch": 1, "waiting": self.waiting, "connected": self.connected}

    def flush(self):
        if self.down:
            raise NodeError("timeout")
        self.flushes += 1


@pytest.fixture
def analysis():
    fake = FakeAnalysis()
    set_analysis(fake)
    yield fake
    set_analysis(None)


@pytest.fixture
def device(signed_in, node, analysis):
    return create(signed_in).json()["id"]


def start(client, device_id, **kw):
    body = {"consent_version": policy.INSPECT_CONSENT_VERSION, "public_key": key()} | kw
    return client.post(f"/api/devices/{device_id}/inspection", json=body, headers=HEADERS)


def read(client, device_id):
    return client.get(f"/api/devices/{device_id}/inspection").json()


def confirm(client, device_id, node, db, address="10.8.1.2"):
    code = start(client, device_id).json()["code"]
    node.confirms.append({"code": code, "address": address})
    worker.tick(db)
    return code


def finish_it(db):
    """The steps of ending an inspection, without waiting for the seconds between them."""
    worker.tick(db)
    db.execute("UPDATE device_inspections SET stopped_at = now() - interval '1 minute' WHERE stopped_at IS NOT NULL")
    worker.tick(db)
    worker.tick(db)


def test_nothing_starts_until_it_is_confirmed_on_the_device(signed_in, node, db, device):
    r = start(signed_in, device).json()
    assert r["url"] == f"https://{policy.INSPECT_CONFIRM_HOST}/c/{r['code']}" and r["minutes"] == policy.INSPECT_CONFIRM_MINUTES
    worker.tick(db)
    assert node.inspecting == {} and read(signed_in, device)["status"] == "confirming"


def test_confirming_on_the_device_starts_it_for_the_days_in_the_policy(signed_in, node, db, device, analysis):
    code = confirm(signed_in, device, node, db)
    after = read(signed_in, device)
    assert after["status"] == "active" and device in node.inspecting
    days = (node.inspecting[device] - dt.datetime.now(dt.UTC).timestamp()) / 86400
    assert policy.INSPECT_DAYS - 0.1 < days <= policy.INSPECT_DAYS
    assert code in node.acked
    # the address may have been someone else's: nothing of theirs carries over
    assert analysis.cleared == [("sg", "10.8.1.2")]
    assert db.execute("SELECT code_hmac FROM device_inspections").fetchone()[0] is None


def test_a_code_opened_on_another_device_confirms_nothing(signed_in, node, db, device):
    code = confirm(signed_in, device, node, db, address="10.8.1.99")
    assert read(signed_in, device)["status"] == "confirming" and node.inspecting == {}
    assert code in node.acked


def test_a_code_is_not_stored_as_it_is(signed_in, db, device):
    code = start(signed_in, device).json()["code"]
    assert bytes(db.execute("SELECT code_hmac FROM device_inspections").fetchone()[0]) != code.encode()


def test_an_unconfirmed_request_goes_away(signed_in, db, device):
    start(signed_in, device)
    db.execute("UPDATE device_inspections SET code_at = now() - interval '31 minutes'")
    # past its time it is gone for the page at once, and from the database at the next tick
    assert read(signed_in, device)["status"] == "none"
    worker.tick(db)
    assert db.execute("SELECT count(*) FROM device_inspections").fetchone()[0] == 0


def test_the_page_is_told_how_long_the_link_is_good_for(signed_in, db, device):
    start(signed_in, device)
    assert policy.INSPECT_CONFIRM_MINUTES * 60 - 5 < read(signed_in, device)["confirm_seconds"] <= policy.INSPECT_CONFIRM_MINUTES * 60
    db.execute("UPDATE device_inspections SET code_at = now() - interval '28 minutes'")
    assert 100 < read(signed_in, device)["confirm_seconds"] <= 120


def renew(client, device_id):
    return client.post(f"/api/devices/{device_id}/inspection/code", headers=HEADERS)


def test_a_new_link_replaces_the_old_one_and_starts_the_time_again(signed_in, node, db, device):
    old = start(signed_in, device).json()["code"]
    db.execute("UPDATE device_inspections SET code_at = now() - interval '28 minutes'")
    created, consented = db.execute("SELECT created_at, consented_on FROM device_inspections").fetchone()
    r = renew(signed_in, device).json()
    assert r["code"] != old and r["url"] == f"https://{policy.INSPECT_CONFIRM_HOST}/c/{r['code']}"
    assert r["minutes"] == policy.INSPECT_CONFIRM_MINUTES
    assert read(signed_in, device)["confirm_seconds"] > policy.INSPECT_CONFIRM_MINUTES * 60 - 5
    # when it was asked for and agreed to stay as they were
    assert db.execute("SELECT created_at, consented_on FROM device_inspections").fetchone() == (created, consented)
    # the old link confirms nothing, the new one does
    node.confirms.append({"code": old, "address": "10.8.1.2"})
    worker.tick(db)
    assert read(signed_in, device)["status"] == "confirming" and old in node.acked
    node.confirms.append({"code": r["code"], "address": "10.8.1.2"})
    worker.tick(db)
    assert read(signed_in, device)["status"] == "active"


def test_a_link_past_its_time_cannot_be_renewed(signed_in, db, device):
    start(signed_in, device)
    db.execute("UPDATE device_inspections SET code_at = now() - interval '31 minutes'")
    r = renew(signed_in, device)
    assert r.status_code == 409 and r.json() == {"error": "inspection_expired"}


def test_only_a_link_waiting_to_be_opened_is_renewed(signed_in, node, db, device):
    assert renew(signed_in, device).json() == {"error": "inspection_expired"}
    confirm(signed_in, device, node, db)
    assert renew(signed_in, device).json() == {"error": "inspection_expired"}
    assert db.execute("SELECT code_hmac FROM device_inspections").fetchone()[0] is None


def test_the_node_is_given_the_code_the_device_confirmed(signed_in, node, db, device):
    """The node starts only when it holds the code as confirmed by the device (node/awgctl, confirmed)."""
    code = start(signed_in, device).json()["code"]
    node.confirms.append({"code": code, "address": "10.8.1.2"})
    original, seen = node.inspect_on, []
    node.inspect_on = lambda host, device_id, until, code: (seen.append(code), original(host, device_id, until, code))[1]
    worker.tick(db)
    assert seen == [code] and read(signed_in, device)["status"] == "active"


def test_a_node_that_does_not_hold_the_confirmation_starts_nothing(signed_in, node, db, device):
    code = start(signed_in, device).json()["code"]
    node.confirms.append({"code": code, "address": "10.8.1.2"})
    original = node.inspect_on
    node.inspect_on = lambda host, device_id, until, code: original(host, device_id, until, "ZZZZZZZZ23456789")
    worker.tick(db)
    assert read(signed_in, device)["status"] == "confirming" and device not in node.inspecting


def test_the_node_down_at_confirmation_is_tried_again(signed_in, node, db, device):
    code = start(signed_in, device).json()["code"]
    node.confirms.append({"code": code, "address": "10.8.1.2"})
    original = node.inspect_on
    node.inspect_on = lambda *a: (_ for _ in ()).throw(NodeError("timeout"))
    worker.tick(db)
    assert read(signed_in, device)["status"] == "confirming" and code not in node.acked
    node.inspect_on = original
    worker.tick(db)
    assert read(signed_in, device)["status"] == "active"


@pytest.mark.parametrize(("body", "status", "err"), [
    ({"consent_version": "1999-01-01"}, 400, "consent_outdated"),
    ({"public_key": "nope"}, 400, "invalid_key"),
])
def test_bad_requests(signed_in, device, body, status, err):
    r = start(signed_in, device, **body)
    assert r.status_code == status and r.json() == {"error": err}


def test_without_an_analysis_host_it_is_not_offered(signed_in, node):
    set_analysis(None)
    device_id = create(signed_in).json()["id"]
    r = start(signed_in, device_id)
    assert r.status_code == 503 and r.json() == {"error": "inspection_unavailable"}


def test_only_the_devices_account(signed_in, db, device):
    other = TestClient(app, base_url="https://testserver")
    other.post("/api/redeem", json={"code": make_invite(db)}, headers=HEADERS)
    assert start(other, device).status_code == 404
    assert other.get(f"/api/devices/{device}/inspection").status_code == 404
    assert other.delete(f"/api/devices/{device}/inspection", headers=HEADERS).status_code == 404
    assert renew(other, device).status_code == 404


def test_one_at_a_time(signed_in, node, db, device):
    confirm(signed_in, device, node, db)
    assert start(signed_in, device).json() == {"error": "inspection_running"}


def test_a_suspended_device_cannot_start(signed_in, db, device):
    db.execute("UPDATE devices SET status = 'suspended'")
    assert start(signed_in, device).json() == {"error": "device_not_active"}


def test_turning_it_off_stops_the_node_and_keeps_a_report_for_seven_days(signed_in, node, db, device, analysis):
    confirm(signed_in, device, node, db)
    assert signed_in.delete(f"/api/devices/{device}/inspection", headers=HEADERS).status_code == 200
    finish_it(db)
    after = read(signed_in, device)
    assert after["status"] == "ended" and device not in node.inspecting
    assert after["report"] == SEALED
    assert after["report_until"] == (dt.datetime.now(dt.UTC).date() + dt.timedelta(days=policy.INSPECT_REPORT_DAYS)).isoformat()
    # the analysis host keeps nothing once the report is out
    assert analysis.cleared.count(("sg", "10.8.1.2")) == 2


def test_an_inspection_ended_early_says_when_it_stopped(signed_in, node, db, device, analysis):
    confirm(signed_in, device, node, db)
    # running: nothing has stopped yet
    assert read(signed_in, device)["stopped_at"] is None
    signed_in.delete(f"/api/devices/{device}/inspection", headers=HEADERS)
    finish_it(db)
    after = read(signed_in, device)
    stopped, ends = (dt.datetime.fromisoformat(after[k]) for k in ("stopped_at", "ends_at"))
    # the report's days end where copying stopped, days before the planned end
    assert after["status"] == "ended" and stopped < ends - dt.timedelta(days=policy.INSPECT_DAYS - 1)
    assert abs(stopped - dt.datetime.now(dt.UTC)) < dt.timedelta(minutes=5)


def test_it_ends_by_itself_on_the_day(signed_in, node, db, device):
    confirm(signed_in, device, node, db)
    db.execute("UPDATE device_inspections SET ends_at = now() - interval '1 minute'")
    finish_it(db)
    assert read(signed_in, device)["status"] == "ended" and device not in node.inspecting


def test_the_analysis_host_down_at_the_end_is_tried_again(signed_in, node, db, device, analysis):
    confirm(signed_in, device, node, db)
    signed_in.delete(f"/api/devices/{device}/inspection", headers=HEADERS)
    analysis.down = True
    finish_it(db)
    assert read(signed_in, device)["status"] == "ending"
    analysis.down = False
    finish_it(db)
    assert read(signed_in, device)["report"] == SEALED


def test_a_report_past_its_days_is_gone(signed_in, node, db, device):
    confirm(signed_in, device, node, db)
    signed_in.delete(f"/api/devices/{device}/inspection", headers=HEADERS)
    finish_it(db)
    db.execute("UPDATE device_inspections SET report_until = current_date - 1")
    worker.tick(db)
    assert read(signed_in, device)["status"] == "none"
    assert db.execute("SELECT count(*) FROM device_inspections").fetchone()[0] == 0


def test_a_report_on_its_last_day_is_still_there(signed_in, node, db, device):
    confirm(signed_in, device, node, db)
    signed_in.delete(f"/api/devices/{device}/inspection", headers=HEADERS)
    finish_it(db)
    db.execute("UPDATE device_inspections SET report_until = current_date")
    worker.tick(db)
    assert read(signed_in, device)["report"] == SEALED


def test_the_node_stops_first_and_the_rest_waits_for_what_was_on_its_way(signed_in, node, db, device, analysis):
    confirm(signed_in, device, node, db)
    signed_in.delete(f"/api/devices/{device}/inspection", headers=HEADERS)
    worker.tick(db)
    assert device not in node.inspecting and read(signed_in, device)["status"] == "ending"
    worker.tick(db)
    assert analysis.flushes == 0


def test_the_report_waits_for_what_is_still_being_analysed(signed_in, node, db, device, analysis):
    confirm(signed_in, device, node, db)
    signed_in.delete(f"/api/devices/{device}/inspection", headers=HEADERS)
    analysis.reports = 0  # the report so far, from the tick that confirmed it
    analysis.waiting = 1
    finish_it(db)
    assert analysis.flushes == 1 and analysis.reports == 0 and read(signed_in, device)["status"] == "ending"
    # nothing is cleared before the report, or the last packets' results would come back afterwards
    assert analysis.cleared.count(("sg", "10.8.1.2")) == 1
    analysis.waiting = 0
    worker.tick(db)
    assert read(signed_in, device)["report"] == SEALED


def test_a_capture_that_cannot_be_analysed_does_not_hold_the_report_back(signed_in, node, db, device, analysis):
    confirm(signed_in, device, node, db)
    signed_in.delete(f"/api/devices/{device}/inspection", headers=HEADERS)
    analysis.waiting = 1
    finish_it(db)
    db.execute("UPDATE device_inspections SET flushed_at = now() - interval '21 minutes'")
    worker.tick(db)
    assert read(signed_in, device)["status"] == "ended"


def test_the_person_can_delete_a_finished_report(signed_in, node, db, device):
    confirm(signed_in, device, node, db)
    signed_in.delete(f"/api/devices/{device}/inspection", headers=HEADERS)
    finish_it(db)
    signed_in.delete(f"/api/devices/{device}/inspection", headers=HEADERS)
    assert read(signed_in, device)["status"] == "none"


def test_a_new_inspection_can_follow_a_finished_one(signed_in, node, db, device):
    confirm(signed_in, device, node, db)
    signed_in.delete(f"/api/devices/{device}/inspection", headers=HEADERS)
    finish_it(db)
    assert start(signed_in, device).status_code == 200
    assert read(signed_in, device)["report"] is None


def test_a_running_inspection_gets_a_report_so_far(signed_in, node, db, device, analysis):
    confirm(signed_in, device, node, db)
    worker.tick(db, usage=True)
    assert read(signed_in, device)["report"] == SEALED


def test_deleting_the_device_takes_the_inspection_with_it(signed_in, node, db, device, analysis):
    confirm(signed_in, device, node, db)
    analysis.cleared.clear()
    signed_in.delete(f"/api/devices/{device}", headers=HEADERS)
    worker.tick(db)
    assert db.execute("SELECT count(*) FROM device_inspections").fetchone()[0] == 0
    # what the analysis host counted goes too, and the note of it
    assert analysis.cleared == [("sg", "10.8.1.2")]
    assert db.execute("SELECT count(*) FROM inspection_leftovers").fetchone()[0] == 0


def test_deleting_a_device_that_is_not_being_inspected_leaves_no_note(signed_in, db, device):
    signed_in.delete(f"/api/devices/{device}", headers=HEADERS)
    assert db.execute("SELECT count(*) FROM inspection_leftovers").fetchone()[0] == 0


INSPECTION_FIELDS = ("inspection", "inspection_ends_at", "inspection_days", "inspection_report_until", "inspection_confirm_minutes")


def listed(client) -> dict:
    """The inspection's own fields; a leader's request is in test_group_inspections.py."""
    return {k: v for k, v in client.get("/api/devices").json()[0].items()
            if k.startswith("inspection") and k not in ("inspection_request", "inspection_group")}


def test_the_device_list_says_there_is_one(signed_in, node, db, device):
    assert listed(signed_in) == dict.fromkeys(INSPECTION_FIELDS)
    code = start(signed_in, device).json()["code"]
    # the link's time from the policy, for the card to say; the same the inspection's page is told when it is made
    assert listed(signed_in) == {"inspection": "confirming", "inspection_ends_at": None,
                                 "inspection_days": policy.INSPECT_DAYS, "inspection_report_until": None,
                                 "inspection_confirm_minutes": policy.INSPECT_CONFIRM_MINUTES}
    node.confirms.append({"code": code, "address": "10.8.1.2"})
    worker.tick(db)
    assert signed_in.get("/api/devices").json()[0]["inspection"] == "active"


def test_the_device_list_gives_the_dates_the_inspection_page_has(signed_in, node, db, device, analysis):
    confirm(signed_in, device, node, db)
    page = read(signed_in, device)
    running = listed(signed_in)
    # the same end and the same days, so the card and the inspection's page count the same day
    assert running == {"inspection": "active", "inspection_ends_at": page["ends_at"], "inspection_days": page["days"],
                       "inspection_report_until": None, "inspection_confirm_minutes": None}
    signed_in.delete(f"/api/devices/{device}/inspection", headers=HEADERS)
    assert listed(signed_in)["inspection"] == "ending"
    finish_it(db)
    ended = listed(signed_in)
    assert ended["inspection"] == "ended" and ended["inspection_report_until"] == read(signed_in, device)["report_until"]


def test_the_device_list_drops_a_request_past_its_link(signed_in, db, device):
    start(signed_in, device)
    db.execute("UPDATE device_inspections SET code_at = now() - interval '31 minutes'")
    # as on the inspection's page, before the worker deletes it
    assert listed(signed_in) == dict.fromkeys(INSPECTION_FIELDS)


def test_the_device_list_never_carries_the_report(signed_in, node, db, device, analysis):
    """Only where the inspection stands: what it found stays on the inspection's own page (toomore/anoni-net-ws#461)."""
    confirm(signed_in, device, node, db)
    signed_in.delete(f"/api/devices/{device}/inspection", headers=HEADERS)
    finish_it(db)
    body = signed_in.get("/api/devices").json()
    assert set(listed(signed_in)) == set(INSPECTION_FIELDS)
    for value in SEALED.values():
        assert f"'{value}'" not in str(body)
    assert "report" not in str(body).replace("inspection_report_until", "")


def test_health_watches_the_analysis_host_only_while_something_is_inspected(client, signed_in, node, db, device, analysis):
    assert client.get("/internal/health").json()["analysis_age"] is None
    confirm(signed_in, device, node, db)
    worker.tick(db, usage=True)
    assert client.get("/internal/health").json()["analysis_age"] is not None


def test_health_says_how_long_ago_a_node_under_inspection_was_connected(client, signed_in, node, db, device, analysis):
    assert client.get("/internal/health").json()["stream_age"] == {}
    confirm(signed_in, device, node, db)
    assert client.get("/internal/health").json()["stream_age"]["sg"] is not None
    analysis.connected = []
    db.execute("UPDATE heartbeats SET at = now() - interval '20 minutes' WHERE name = 'stream:sg'")
    worker.tick(db, usage=True)
    assert client.get("/internal/health").json()["stream_age"]["sg"] >= 1200
    analysis.connected = ["sg"]
    worker.tick(db, usage=True)
    assert client.get("/internal/health").json()["stream_age"]["sg"] < 60


def test_nothing_happens_without_an_analysis_host(db, node):
    set_analysis(None)
    inspections.tick(db, True)
