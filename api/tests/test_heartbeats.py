import importlib.util
from pathlib import Path

from conftest import needs_db

from app import worker

pytestmark = needs_db

spec = importlib.util.spec_from_file_location("health_warn", Path(__file__).parents[2] / "deploy" / "health_warn.py")
health_warn = importlib.util.module_from_spec(spec)
spec.loader.exec_module(health_warn)


def health(client) -> dict:
    return client.get("/internal/health").json()


def test_worker_and_usage_leave_heartbeats(signed_in, node, db):
    before = health(signed_in)
    assert before["worker_age"] is None and before["usage_age"] == {"jp": None, "sg": None}
    worker.tick(db)
    after = health(signed_in)
    assert after["worker_age"] == 0 and after["usage_age"] == {"jp": 0, "sg": 0} and after["stuck_jobs"] == 0


def test_a_node_that_cannot_be_read_leaves_no_usage_heartbeat(signed_in, node, db):
    node.down = True
    worker.tick(db)
    data = health(signed_in)
    assert data["worker_age"] == 0 and data["usage_age"] == {"jp": None, "sg": None}
    assert health_warn.evaluate(data)[0] == "usage:jp,usage:sg"


def test_stuck_jobs_are_reported(signed_in, db):
    db.execute("INSERT INTO jobs (region_id, device_id, action, created_at) VALUES ('sg', 'd-x', 'remove', now() - interval '1 hour')")
    assert health(signed_in)["stuck_jobs"] == 1


def test_evaluate():
    ok = {"worker_age": 12, "usage_age": {"sg": 200}, "stuck_jobs": 0}
    assert health_warn.evaluate(ok) == ("ok", [])
    state, lines = health_warn.evaluate({"worker_age": 3600, "usage_age": {"sg": 4000, "jp": 30}, "stuck_jobs": 2})
    assert state == "worker,usage:sg,jobs"
    assert lines[0] == "- worker：60 分鐘沒有完成一輪"


def test_internal_health_is_not_under_api(client):
    # nginx forwards /api/ only; keeping the route outside it keeps it off the public site
    assert client.get("/internal/health").status_code == 200
    assert client.get("/api/internal/health").status_code == 404


def test_health_reports_the_sites_a_node_cannot_open(signed_in, db):
    db.execute("UPDATE regions SET is_open = true WHERE id = 'jp'")
    db.execute("INSERT INTO reach (region_id, site, state, checked_at) VALUES "
               "('jp', 'mvdis', 'blocked', now() - interval '10 minutes'), ('jp', 'ptt', 'blocked', now() - interval '10 minutes'), "
               "('jp', 'bot', 'challenge', now() - interval '10 minutes'), "
               "('sg', 'mvdis', 'ok', now() - interval '4 hours'), ('sg', 'ptt', 'blocked', now() - interval '4 hours')")
    data = health(signed_in)
    assert set(data["reach_age"]) == {"jp", "sg"} and data["reach_age"]["sg"] > 3 * 3600
    # sg's check is stale, so nothing is known to open mvdis: no region lists it
    assert data["reach_blocked"] == {"jp": []}
    db.execute("UPDATE reach SET checked_at = now() - interval '5 minutes' WHERE region_id = 'sg'")
    data = health(signed_in)
    # ptt fails on every node, so it is not the node's fault
    assert data["reach_blocked"] == {"jp": ["mvdis"], "sg": []}
    # a closed region is left out
    db.execute("UPDATE regions SET is_open = false WHERE id = 'sg'")
    assert set(health(signed_in)["reach_age"]) == {"jp"}


def test_evaluate_a_stopped_site_check():
    state, lines = health_warn.evaluate({"worker_age": 12, "usage_age": {"jp": 60}, "stuck_jobs": 0,
                                         "reach_age": {"jp": 4 * 3600, "sg": 1800}})
    assert state == "reach:jp" and lines == ["- jp 節點：網站自測 4 小時沒有更新"]
    assert "vessel-reach" in health_warn.check({"worker_age": 12, "usage_age": {}, "stuck_jobs": 0, "reach_age": {"jp": 4 * 3600}})[1]


def test_a_change_in_blocked_sites_is_notified_once(tmp_path, monkeypatch):
    sent = []
    monkeypatch.setattr(health_warn, "REACH_STATE", tmp_path / "reach.state")
    monkeypatch.setattr(health_warn, "notify", lambda title, body, priority, tags: sent.append((title, body, priority)))
    data = {"reach_blocked": {"jp": ["momo", "mvdis"], "tw": []}}
    # the first run only remembers
    health_warn.watch_reach(data)
    health_warn.watch_reach(data)
    assert sent == []
    health_warn.watch_reach({"reach_blocked": {"jp": ["mvdis"], "tw": ["reddit"]}})
    assert len(sent) == 1 and sent[0][2] == "default"
    assert sent[0][1].startswith("- tw 節點打不開 reddit\n- jp 節點恢復 momo")
    health_warn.watch_reach({"reach_blocked": {"jp": ["mvdis"], "tw": ["reddit"]}})
    assert len(sent) == 1


def test_a_failed_notice_is_tried_again(tmp_path, monkeypatch):
    monkeypatch.setattr(health_warn, "REACH_STATE", tmp_path / "reach.state")
    (tmp_path / "reach.state").write_text("jp:mvdis\n")

    def fail(*_):
        raise OSError("ntfy down")

    monkeypatch.setattr(health_warn, "notify", fail)
    health_warn.watch_reach({"reach_blocked": {"jp": []}})
    assert (tmp_path / "reach.state").read_text() == "jp:mvdis\n"
