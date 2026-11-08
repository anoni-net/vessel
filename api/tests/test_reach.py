from conftest import needs_db

from app import jobs

pytestmark = needs_db

CHECK = {"checked_at": "2026-11-08T04:20:53+00:00", "sites": {"mvdis": "blocked", "bot": "challenge", "signal": "ok"}}


def regions(db):
    db.execute("INSERT INTO regions (id, node_host, is_open) VALUES ('jp', 'n', true), ('tw', 'n', true), "
               "('sg', 'n', false)")


def rows(db):
    return db.execute("SELECT region_id, site, state FROM reach ORDER BY region_id, site").fetchall()


def test_the_worker_keeps_what_each_open_node_last_checked(db, node):
    regions(db)
    node.reach_result = CHECK
    jobs.poll_reach(db)
    # a closed region is not asked
    assert rows(db) == [("jp", "bot", "challenge"), ("jp", "mvdis", "blocked"), ("jp", "signal", "ok"),
                        ("tw", "bot", "challenge"), ("tw", "mvdis", "blocked"), ("tw", "signal", "ok")]
    assert node.reach_calls == 2


def test_it_reads_a_node_again_only_after_half_an_hour(db, node):
    regions(db)
    node.reach_result = CHECK
    jobs.poll_reach(db)
    jobs.poll_reach(db)
    assert node.reach_calls == 2
    db.execute("UPDATE reach SET fetched_at = now() - interval '31 minutes' WHERE region_id = 'jp'")
    node.reach_result = {"checked_at": "2026-11-08T05:20:00+00:00", "sites": {"mvdis": "ok"}}
    jobs.poll_reach(db)
    assert node.reach_calls == 3
    # the new check replaces the old one
    assert [r for r in rows(db) if r[0] == "jp"] == [("jp", "mvdis", "ok")]


def test_a_node_without_a_check_or_with_a_bad_one_keeps_the_last(db, node):
    regions(db)
    jobs.poll_reach(db)
    assert rows(db) == []
    node.reach_result = CHECK
    jobs.poll_reach(db)
    db.execute("UPDATE reach SET fetched_at = now() - interval '31 minutes'")
    node.reach_result = {"sites": {"mvdis": "ok"}}
    jobs.poll_reach(db)
    assert len(rows(db)) == 6
    # states and names it does not know are dropped
    node.reach_result = {"checked_at": "2026-11-08T05:20:00+00:00",
                         "sites": {"mvdis": "down", "Bad Name": "ok", "signal": "ok"}}
    jobs.poll_reach(db)
    assert [r for r in rows(db) if r[0] == "jp"] == [("jp", "signal", "ok")]


def test_the_status_page_shows_fresh_checks_of_open_regions(client, db, node):
    regions(db)
    node.reach_result = {**CHECK, "checked_at": "2099-01-01T00:00:00+00:00"}
    jobs.poll_reach(db)
    reach = client.get("/api/status").json()["reach"]
    assert reach == [
        {"region": "jp", "checked_at": "2099-01-01T00:00:00+00:00",
         "sites": {"bot": "challenge", "mvdis": "blocked", "signal": "ok"}},
        {"region": "tw", "checked_at": "2099-01-01T00:00:00+00:00",
         "sites": {"bot": "challenge", "mvdis": "blocked", "signal": "ok"}},
    ]
    # a node whose timer stopped hours ago
    db.execute("UPDATE reach SET checked_at = now() - interval '4 hours' WHERE region_id = 'tw'")
    assert [r["region"] for r in client.get("/api/status").json()["reach"]] == ["jp"]
