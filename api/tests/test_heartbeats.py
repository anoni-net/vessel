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
