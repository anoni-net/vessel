from conftest import create, needs_db

from app import jobs, worker

pytestmark = needs_db


def test_finished_jobs_go_after_a_day(signed_in, node, db):
    kept = create(signed_in).json()["id"]
    gone = create(signed_in, name="laptop").json()["id"]
    node.down = True
    failed = create(signed_in, name="tablet").json()["id"]
    db.execute("UPDATE jobs SET status = 'failed', updated_at = now() - interval '2 days' WHERE device_id = %s", (failed,))
    # a remove that failed before removes were tried until done, for a device already gone
    db.execute("INSERT INTO jobs (region_id, device_id, action, status, updated_at) "
               "VALUES ('sg', 'd-goneforgood1', 'remove', 'failed', now() - interval '2 days')")
    db.execute("UPDATE jobs SET done_at = now() - interval '25 hours' WHERE device_id = %s", (gone,))
    # a job cancelled by a deletion has no done_at
    db.execute("INSERT INTO jobs (region_id, device_id, action, status, updated_at) "
               "VALUES ('sg', 'd-cancelled001', 'add', 'done', now() - interval '25 hours')")
    db.execute("INSERT INTO jobs (region_id, device_id, action, next_try_at, created_at, updated_at) "
               "VALUES ('sg', %s, 'resume', now() + interval '1 hour', now() - interval '3 days', now() - interval '3 days')",
               (kept,))
    jobs.forget_finished_jobs(db)
    left = {(d, a, s) for d, a, s in db.execute("SELECT device_id, action, status FROM jobs")}
    assert left == {
        (kept, "add", "done"),          # finished within the day
        (failed, "add", "failed"),      # its device still says the node failed
        (kept, "resume", "queued"),     # not finished, however old
    }
    assert signed_in.get(f"/api/devices/{failed}/config").json() == {"error": "node_failed"}


def test_the_worker_forgets_them(signed_in, node, db):
    create(signed_in)
    db.execute("UPDATE jobs SET done_at = now() - interval '2 days'")
    worker.tick(db, usage=False)
    assert db.execute("SELECT count(*) FROM jobs").fetchone()[0] == 0
