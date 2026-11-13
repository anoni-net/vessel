import datetime as dt

from conftest import needs_db

from app import jobs

pytestmark = needs_db

# Relative to now: reach_history keeps 48 hours, so a fixed date stops being kept two days after it was written
NOW = dt.datetime.now(dt.UTC).replace(microsecond=0)
FIRST = (NOW - dt.timedelta(hours=1)).isoformat()
LATER = NOW.isoformat()
CHECK = {"checked_at": FIRST, "sites": {"mvdis": "blocked", "bot": "challenge", "signal": "ok"}}


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
    node.reach_result = {"checked_at": LATER, "sites": {"mvdis": "ok"}}
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
    node.reach_result = {"checked_at": LATER,
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


def history_rows(db):
    return db.execute("SELECT region_id, site, state FROM reach_history ORDER BY region_id, site, checked_at").fetchall()


def test_every_new_check_is_kept_for_two_days(db, node):
    regions(db)
    node.reach_result = CHECK
    jobs.poll_reach(db)
    # read again half an hour later: the node has not checked since
    db.execute("UPDATE reach SET fetched_at = now() - interval '31 minutes'")
    jobs.poll_reach(db)
    assert len(history_rows(db)) == 6
    db.execute("UPDATE reach SET fetched_at = now() - interval '31 minutes'")
    node.reach_result = {"checked_at": LATER, "sites": {"mvdis": "ok"}}
    jobs.poll_reach(db)
    assert ("jp", "mvdis", "ok") in history_rows(db) and len(history_rows(db)) == 8
    db.execute("UPDATE reach_history SET checked_at = now() - interval '49 hours' WHERE state = 'challenge'")
    db.execute("UPDATE reach SET fetched_at = now() - interval '31 minutes'")
    jobs.poll_reach(db)
    assert all(state != "challenge" for _, _, state in history_rows(db))


def test_the_status_page_shows_the_last_day_of_the_sites_with_trouble(client, db):
    regions(db)
    # slots are hours of the clock in UTC, the current one last: offsets are seconds from the start of this hour
    hour = db.execute("SELECT date_trunc('hour', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'").fetchone()[0]
    for at, mvdis in ((-30 * 3600, "blocked"), (-23 * 3600 - 60, "blocked"), (-23 * 3600 + 60, "blocked"),
                      (-5 * 3600 + 120, "ok"), (-5 * 3600 + 1200, "blocked"), (-3600, "ok"), (-1, "blocked"), (0, "ok")):
        db.execute("INSERT INTO reach_history (region_id, site, state, checked_at) VALUES "
                   "('jp', 'mvdis', %s, %s), ('jp', 'signal', 'ok', %s), ('tw', 'mvdis', 'ok', %s), "
                   "('sg', 'mvdis', 'blocked', %s)",
                   (mvdis, *[hour + dt.timedelta(seconds=at)] * 4))
    h = client.get("/api/status").json()["reach_history"]
    assert h["hours"] == 24 and "until" in h
    # signal never had trouble; the checks 30 hours ago and a minute before the first hour are outside the day
    assert set(h["sites"]) == {"mvdis"}
    jp = h["sites"]["mvdis"]["jp"]
    assert len(jp) == 24 and jp[0] == "blocked" and jp[23] == "ok"
    # two checks in one hour of the clock: the later wins, even when they are nearly an hour apart
    assert jp[18] == "blocked" and jp[22] == "blocked"
    assert jp.count(None) == 20
    assert h["sites"]["mvdis"]["tw"][23] == "ok"
    # a closed region is left out
    assert set(h["sites"]["mvdis"]) == {"jp", "tw"}
