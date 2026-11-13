import datetime as dt
import importlib.util
from pathlib import Path

from conftest import needs_db

from app import admin, jobs

pytestmark = needs_db

spec = importlib.util.spec_from_file_location("health_warn", Path(__file__).parents[2] / "deploy" / "health_warn.py")
health_warn = importlib.util.module_from_spec(spec)
spec.loader.exec_module(health_warn)

HEADER = ("hour,packets,sources,taiwan,hk_macau,china,japan_korea,southeast_asia,other_apac,outside_apac,dropped,"
          "probe_packets,handshake_sources,handshake_china")
NOW = dt.datetime.now(dt.UTC).replace(minute=0, second=0, microsecond=0)


def hour(ago: int) -> str:
    """The label of the hour that started `ago` hours before this one."""
    return f"{NOW - dt.timedelta(hours=ago):%Y-%m-%dT%H:00Z}"


def regions(db):
    db.execute("INSERT INTO regions (id, node_host, is_open) VALUES ('jp', 'n', true), ('tw', 'n', true), "
               "('sg', 'n', false)")


def stored(db, region="jp"):
    return db.execute("SELECT packets, sources, china, dropped, probe_packets, handshake_sources, handshake_china "
                      "FROM probe_hours WHERE region_id = %s ORDER BY hour", (region,)).fetchall()


def test_the_worker_copies_each_open_nodes_hours(db, node):
    regions(db)
    node.probe_result = "\n".join([
        HEADER,
        # from before the zones, then before the last three columns, then all of them
        f"{hour(3)},5,2,,,,,,,,,,,",
        f"{hour(2)},9,3,1,0,2,0,0,0,0,0,,,",
        f"{hour(1)},40,6,1,0,3,0,0,0,2,7,30,2,1",
    ]) + "\n"
    jobs.poll_probe(db)
    assert stored(db) == [(5, 2, None, None, None, None, None), (9, 3, 2, 0, None, None, None), (40, 6, 3, 7, 30, 2, 1)]
    # a closed region is not asked
    assert node.probe_calls == 2 and stored(db, "sg") == []
    assert stored(db, "tw") == stored(db)


def test_it_reads_a_node_again_after_half_an_hour_and_keeps_the_hours_it_has(db, node):
    regions(db)
    node.probe_result = f"{HEADER}\n{hour(2)},9,3,1,0,2,0,0,0,0,0,4,1,0\n"
    jobs.poll_probe(db)
    jobs.poll_probe(db)
    assert node.probe_calls == 2
    db.execute("UPDATE heartbeats SET at = now() - interval '31 minutes' WHERE name = 'probe:jp'")
    # the same hour again with other numbers, and a new one
    node.probe_result = f"{HEADER}\n{hour(2)},1,1,0,0,0,0,0,0,0,0,0,0,0\n{hour(1)},2,2,0,0,0,0,0,0,2,0,2,0,0\n"
    jobs.poll_probe(db)
    assert node.probe_calls == 3
    assert [r[0] for r in stored(db)] == [9, 2] and [r[0] for r in stored(db, "tw")] == [9]


def test_a_node_without_the_call_and_rows_that_are_not_counts_leave_nothing(db, node):
    regions(db)
    jobs.poll_probe(db)
    assert stored(db) == []
    # no header: nothing is taken, and the node is asked again on the next round
    node.probe_result = f"{hour(1)},1,1\n"
    jobs.poll_probe(db)
    assert stored(db) == [] and node.probe_calls == 4
    node.probe_result = "\n".join([
        HEADER,
        HEADER,                                          # the header again, from a file shorter than what is sent
        f"{hour(4)},1,1,0,0,0,0,0,0,0,0,0,0,0",
        f"{hour(3)},-1,1,0,0,0,0,0,0,0,0,0,0,0",         # not a count
        f"{hour(2)},1,192.0.2.7,0,0,0,0,0,0,0,0,0,0,0",  # nothing but counts is taken
        f"{hour(1)},,1,0,0,0,0,0,0,0,0,0,0,0",           # the first two are needed
        "2026-13-40T99:00Z,1,1,0,0,0,0,0,0,0,0,0,0,0",   # not an hour
        f"{NOW + dt.timedelta(hours=2):%Y-%m-%dT%H:00Z},1,1,0,0,0,0,0,0,0,0,0,0,0",  # not yet
        "",
    ])
    jobs.poll_probe(db)
    assert len(stored(db)) == 1


def test_a_node_with_fewer_columns_is_read_by_its_header(db, node):
    regions(db)
    node.probe_result = f"hour,packets,sources,dropped\n{hour(1)},8,2,5\n"
    jobs.poll_probe(db)
    assert stored(db) == [(8, 2, None, 5, None, None, None)]


def test_hours_older_than_400_days_go(db, node):
    regions(db)
    db.execute("INSERT INTO probe_hours (region_id, hour, packets, sources) VALUES "
               "('jp', now() - interval '401 days', 1, 1), ('jp', now() - interval '399 days', 1, 1)")
    jobs.poll_probe(db)
    assert len(stored(db)) == 1


def fill(db, region, hours, **counts):
    """One row for each of the hours `hours` (ago), with the same counts."""
    names = ", ".join(counts)
    for ago in hours:
        db.execute(f"INSERT INTO probe_hours (region_id, hour, packets, sources, {names}) VALUES (%s, %s, 0, 0, "
                   + ", ".join(["%s"] * len(counts)) + ")", (region, NOW - dt.timedelta(hours=ago), *counts.values()))


def test_health_gives_the_last_day_next_to_the_usual_day(client, db):
    regions(db)
    # jp: a week at 1 handshake source an hour, then 5 an hour for the last day
    fill(db, "jp", range(25, 193), handshake_sources=1, probe_packets=10, dropped=0)
    fill(db, "jp", range(1, 25), handshake_sources=5, probe_packets=10, dropped=0)
    # tw: only two days before the last one, too little to compare with; and no handshake counts at all
    fill(db, "tw", range(1, 73), dropped=0)
    # a closed region is left out
    fill(db, "sg", range(1, 6), dropped=9)
    data = client.get("/internal/health").json()
    assert set(data["probe"]) == {"jp", "tw"}
    jp, tw = data["probe"]["jp"], data["probe"]["tw"]
    assert jp["day"]["handshake_sources"] == 120 and jp["usual"]["handshake_sources"] == 24.0
    assert jp["day"]["probe_packets"] == 240 and jp["day"]["china"] is None and jp["usual"]["china"] is None
    assert tw["day"] == {"probe_packets": None, "handshake_sources": None, "handshake_china": None, "china": None, "dropped": 0}
    assert tw["usual"]["dropped"] is None
    # the last hour written ended within the hour
    assert 0 <= data["probe_age"]["jp"] < 3600 and "sg" not in data["probe_age"]
    # 120 is over the floor of 30 and over three times 24
    assert health_warn.probe_raised(data) == {"jp:handshake_sources"}


def level(**days):
    """{region: (day, usual)} of handshake sources into /internal/health's probe."""
    return {"probe": {r: {"day": {"handshake_sources": d}, "usual": {"handshake_sources": u}} for r, (d, u) in days.items()}}


def test_a_count_is_raised_at_its_floor_and_three_times_its_usual_day():
    raised = health_warn.probe_raised
    assert raised(level(jp=(29, 0.0))) == set()            # under the floor
    assert raised(level(jp=(30, 0.0))) == {"jp:handshake_sources"}
    assert raised(level(jp=(60, 24.0))) == set()           # a removed device that keeps trying is the usual day
    assert raised(level(jp=(72, 24.0))) == {"jp:handshake_sources"}
    assert raised(level(jp=(500, None), tw=(None, 3.0))) == set()   # nothing to compare with, or not counted
    assert raised({"probe": {"jp": {"day": {"dropped": 1}, "usual": {"dropped": 0.0}}}}) == {"jp:dropped"}


def test_a_rise_is_notified_once_and_again_when_it_is_over(tmp_path, monkeypatch):
    sent = []
    monkeypatch.setattr(health_warn, "PROBE_STATE", tmp_path / "probe.state")
    monkeypatch.setattr(health_warn, "notify", lambda title, body, priority, tags: sent.append((body, priority)))
    quiet = level(jp=(3, 2.0), tw=(0, 0.0))
    health_warn.watch_probe(quiet)
    health_warn.watch_probe({})  # a backend from before the counts
    assert sent == []
    risen = level(jp=(90, 2.0), tw=(4, 0.0))
    health_warn.watch_probe(risen)
    health_warn.watch_probe(risen)
    assert len(sent) == 1 and sent[0][1] == "high"
    assert sent[0][0].startswith("- jp 節點近 24 小時送出握手長度封包的來源：90（前 7 天平均每天 2.0，新出現），其他節點：tw 4\n")
    health_warn.watch_probe(quiet)
    assert len(sent) == 2 and sent[1][1] == "default" and sent[1][0].startswith("- jp 節點的送出握手長度封包的來源回到平常")


def test_a_failed_probe_notice_is_tried_again(tmp_path, monkeypatch):
    monkeypatch.setattr(health_warn, "PROBE_STATE", tmp_path / "probe.state")

    def fail(*_):
        raise OSError("ntfy down")

    monkeypatch.setattr(health_warn, "notify", fail)
    health_warn.watch_probe(level(jp=(90, 2.0)))
    assert not (tmp_path / "probe.state").exists()


def test_a_node_whose_counts_stopped_is_a_problem():
    ok = {"worker_age": 12, "usage_age": {"jp": 60}, "stuck_jobs": 0}
    assert health_warn.evaluate({**ok, "probe_age": {"jp": 7000, "tw": 1}}) == ("ok", [])
    state, lines = health_warn.evaluate({**ok, "probe_age": {"jp": 4 * 3600, "tw": 1}})
    assert state == "probe:jp" and lines == ["- jp 節點：探測的統計 4 小時沒有新的一筆"]
    assert "vessel-probe-watch" in health_warn.check({**ok, "probe_age": {"jp": 4 * 3600}})[1]


def test_probes_prints_days_and_hours_as_counts(db, capsys):
    regions(db)
    fill(db, "jp", [30, 29], handshake_sources=2, handshake_china=1, probe_packets=10, china=3, dropped=0)
    fill(db, "tw", [30], dropped=0)
    admin.probes(db, 14, csv=False)
    out = capsys.readouterr().out
    day = (NOW - dt.timedelta(hours=30)).date().isoformat()
    rows = [line.split() for line in out.splitlines() if line.split()[:2] in ([day, "jp"], [day, "tw"])]
    if (NOW - dt.timedelta(hours=29)).date().isoformat() == day:
        assert rows[0] == [day, "jp", "2", "20", "4", "2", "0", "6", "0"]
    assert rows[-1] == [day, "tw", "1", "-", "-", "-", "0", "-", "0"]
    admin.probes(db, 14, csv=True)
    lines = capsys.readouterr().out.splitlines()
    assert lines[0] == "region,hour," + HEADER.removeprefix("hour,")
    assert f"jp,{hour(30)},0,0,,,3,,,,,0,10,2,1" in lines and f"tw,{hour(30)},0,0,,,,,,,,0,,," in lines
