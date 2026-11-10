"""node/host/vessel-reach.py, the check each node runs every hour: how it reads an answer and settles a block."""

import importlib.util
from pathlib import Path

from app.jobs import REACH_STATES, SITE_ID

NODE = Path(__file__).resolve().parents[2] / "node"
spec = importlib.util.spec_from_file_location("vessel_reach", NODE / "host" / "vessel-reach.py")
reach = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reach)


def test_an_answer_is_ok_only_with_the_text_of_the_real_page():
    assert reach.classify(0, 200, "", "<title>監理服務網-首頁</title>", "監理服務網") == "ok"
    assert reach.classify(0, 200, "", "<title>Error</title>", "監理服務網") == "blocked"
    assert reach.classify(0, 403, "", "Forbidden", "momo購物網") == "blocked"
    # curl timed out or could not connect
    assert reach.classify(28, 0, "", "", "監理服務網") == "blocked"


def test_a_bot_check_is_a_challenge_not_a_block():
    assert reach.classify(0, 403, "cf-mitigated: challenge\n", "", "動畫瘋") == "challenge"
    assert reach.classify(0, 200, "", "<title>Challenge Validation</title>", "臺灣銀行") == "challenge"
    assert reach.classify(0, 429, "", '<form action="/sorry/index">', "Google") == "challenge"


def test_a_block_counts_after_two_runs_in_a_row():
    first = reach.settle({"mvdis": "blocked", "bot": "challenge"}, {}, {})
    assert first == {"mvdis": "ok", "bot": "challenge"}
    assert reach.settle({"mvdis": "blocked"}, {"mvdis": "blocked"}, first) == {"mvdis": "blocked"}
    # one good answer clears it at once
    assert reach.settle({"mvdis": "ok"}, {"mvdis": "blocked"}, {"mvdis": "blocked"}) == {"mvdis": "ok"}
    # one bad answer after a block keeps the block
    assert reach.settle({"mvdis": "blocked"}, {"mvdis": "ok"}, {"mvdis": "blocked"}) == {"mvdis": "blocked"}


def test_the_site_list_is_what_the_portal_accepts():
    rows = reach.sites(str(NODE / "reach-sites.tsv"))
    ids = [site for site, _, _ in rows]
    assert len(ids) == len(set(ids)) >= 20
    assert all(SITE_ID.match(site) and url.startswith("https://") and expect for site, url, expect in rows)
    assert {"ok", "challenge", "blocked"} == REACH_STATES
