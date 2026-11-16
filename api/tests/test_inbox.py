"""The inbox (app/inbox.py): announcements for every account, a region or a group, what is unread, and the notes worked
out from what the portal already keeps."""

import io
from datetime import date, timedelta

import pytest
from conftest import HEADERS, create, make_invite, needs_db
from fastapi.testclient import TestClient
from test_group_api import join, new_group

from app import admin, jobs
from app.main import app

pytestmark = needs_db

TOML = """
[zh-TW]
title = "新加坡節點維護"
body = "11 月 20 日 02:00 起約 10 分鐘。"

[en]
title = "Singapore maintenance"
body = "From 02:00 on 20 November, about 10 minutes."
"""


def post(monkeypatch, capsys, *args, text=TOML) -> int:
    monkeypatch.setattr("sys.stdin", io.StringIO(text))
    admin.main(["messages", "add", *args])
    return int(capsys.readouterr().out.splitlines()[0].split()[-1])


def box(client) -> dict:
    return client.get("/api/inbox").json()


def me(client) -> dict:
    return client.get("/api/me").json()["inbox"]


def browser() -> TestClient:
    return TestClient(app, base_url="https://testserver")


def test_an_announcement_for_everyone_is_unread_until_the_inbox_is_read(signed_in, db, monkeypatch, capsys):
    assert me(signed_in) == {"unread": 0, "notes": []}
    mid = post(monkeypatch, capsys)
    assert me(signed_in)["unread"] == 1
    [m] = box(signed_in)["messages"]
    assert m["id"] == mid and m["unread"] and m["region"] is None and not m["group"]
    assert m["texts"]["zh-TW"]["title"] == "新加坡節點維護" and set(m["texts"]) == {"zh-TW", "en"}
    assert m["expires_on"] == (date.today() + timedelta(days=30)).isoformat()
    # the browser's word is not taken for it: there is nothing to send
    assert signed_in.post("/api/inbox/read").status_code == 403
    assert signed_in.post("/api/inbox/read", headers=HEADERS).json() == {"unread": 0}
    assert me(signed_in)["unread"] == 0 and not box(signed_in)["messages"][0]["unread"]
    post(monkeypatch, capsys)
    assert me(signed_in)["unread"] == 1


def test_announcements_from_before_the_account_count_as_read(signed_in, db, monkeypatch, capsys):
    post(monkeypatch, capsys)
    db.execute("UPDATE messages SET created_at = now() - interval '3 days'")
    db.execute("UPDATE accounts SET created_on = current_date - 1")
    assert me(signed_in)["unread"] == 0
    # it is still there to read
    assert len(box(signed_in)["messages"]) == 1


def test_a_region_is_whoever_has_a_device_there_now(signed_in, db, monkeypatch, capsys):
    post(monkeypatch, capsys, "--region", "sg")
    assert box(signed_in)["messages"] == [] and me(signed_in)["unread"] == 0
    device = create(signed_in).json()["id"]
    assert box(signed_in)["messages"][0]["region"] == "sg"
    assert me(signed_in)["unread"] == 1
    signed_in.delete(f"/api/devices/{device}", headers=HEADERS)
    assert box(signed_in)["messages"] == []


def test_a_groups_announcement_is_for_its_accounts_only(client, db, node, capsys, monkeypatch):
    db.execute("INSERT INTO regions (id, node_host, is_open) VALUES ('sg', 'node-sg', true)")
    leader = new_group(capsys, "g1", client=client)
    member = join(leader)
    personal = browser()
    personal.post("/api/redeem", json={"code": make_invite(db)}, headers=HEADERS)
    other = new_group(capsys, "g2", label="L2")
    post(monkeypatch, capsys, "--group", "g1")
    for c in (leader, member):
        assert box(c)["messages"][0]["group"] and me(c)["unread"] == 1
    for c in (personal, other):
        assert box(c)["messages"] == [] and me(c)["unread"] == 0
    # reading it on one account leaves the others' unread
    member.post("/api/inbox/read", headers=HEADERS)
    assert me(member)["unread"] == 0 and me(leader)["unread"] == 1


def test_a_closed_group_takes_its_announcements_with_it(client, db, node, capsys, monkeypatch):
    db.execute("INSERT INTO regions (id, node_host, is_open) VALUES ('sg', 'node-sg', true)")
    new_group(capsys, "g1", client=client)
    post(monkeypatch, capsys, "--group", "g1")
    db.execute("UPDATE groups SET closing_on = current_date")
    jobs.close_groups(db)
    assert db.execute("SELECT count(*) FROM messages").fetchone()[0] == 0


def test_an_announcement_goes_after_its_last_day(signed_in, db, monkeypatch, capsys):
    post(monkeypatch, capsys, "--days", "1")
    jobs.forget_expired_messages(db)
    assert len(box(signed_in)["messages"]) == 1
    db.execute("UPDATE messages SET expires_on = current_date - 1")
    assert box(signed_in)["messages"] == [] and me(signed_in)["unread"] == 0
    jobs.forget_expired_messages(db)
    assert db.execute("SELECT count(*) FROM messages").fetchone()[0] == 0


@pytest.mark.parametrize("text, why", [
    ("[en]\ntitle = 'a'\nbody = 'b'\n", "[zh-TW] is needed"),
    ("[zh-TW]\ntitle = 'a'\nbody = 'b'\n[ja]\ntitle = 'a'\nbody = 'b'\n", "unknown language [ja]"),
    ("[zh-TW]\ntitle = 'a'\n", "has a title and a body"),
    ("[zh-TW]\ntitle = ' '\nbody = 'b'\n", "empty title or body"),
    (f"[zh-TW]\ntitle = '{'長' * 81}'\nbody = 'b'\n", "too long"),
    ("[zh-TW\n", "not TOML"),
])
def test_what_maintainers_write_is_checked(db, monkeypatch, text, why):
    monkeypatch.setattr("sys.stdin", io.StringIO(text))
    with pytest.raises(SystemExit, match=why.replace("[", r"\[")):
        admin.main(["messages", "add"])
    assert db.execute("SELECT count(*) FROM messages").fetchone()[0] == 0


def test_list_and_delete(signed_in, db, monkeypatch, capsys):
    with pytest.raises(SystemExit, match="no region tw"):
        post(monkeypatch, capsys, "--region", "tw")
    mid = post(monkeypatch, capsys, "--region", "sg")
    admin.main(["messages"])
    assert f"{mid}  region sg  {date.today()} to {date.today() + timedelta(days=30)}  新加坡節點維護" in capsys.readouterr().out
    admin.main(["messages", "delete", str(mid)])
    with pytest.raises(SystemExit, match=f"no message {mid}"):
        admin.main(["messages", "delete", str(mid)])


def inspected(db, device_id, until_days=7):
    db.execute(
        "INSERT INTO device_inspections (device_id, status, public_key, consent_version, report_until) "
        "VALUES (%s, 'ended', 'k', 'v', current_date + %s)",
        (device_id, until_days),
    )


def test_a_report_to_download_is_a_note_until_it_is_deleted(signed_in, db):
    device = create(signed_in).json()["id"]
    inspected(db, device)
    until = (date.today() + timedelta(days=7)).isoformat()
    [note] = box(signed_in)["notes"]
    assert note == {"key": f"report:{device}:{until}", "kind": "report", "device": device, "name": "phone", "until": until}
    assert me(signed_in)["notes"] == [note["key"]]
    db.execute("DELETE FROM device_inspections")
    assert box(signed_in)["notes"] == [] and me(signed_in)["notes"] == []


def test_a_members_report_and_a_leaders_request_are_the_members_alone(client, db, node, capsys):
    db.execute("INSERT INTO regions (id, node_host, is_open) VALUES ('sg', 'node-sg', true)")
    leader = new_group(capsys, "g1", client=client)
    member = join(leader)
    device = create(member).json()["id"]
    inspected(db, device)
    other = create(member, name="laptop").json()["id"]
    db.execute("INSERT INTO group_inspections (device_id, status, until) VALUES (%s, 'requested', current_date + 7)",
               (other,))
    assert [n["kind"] for n in box(member)["notes"]] == ["report", "inspect_request"]
    assert box(leader)["notes"] == [] and me(leader)["notes"] == []


def test_the_other_notes(signed_in, db):
    device = create(signed_in).json()["id"]
    db.execute("UPDATE devices SET throttled = true, moved = true")
    db.execute("UPDATE regions SET previous_until = current_date + 10 WHERE id = 'sg'")
    month = date.today().replace(day=1)
    following = (month + timedelta(days=32)).replace(day=1)
    notes = box(signed_in)["notes"]
    assert notes == [
        {"key": f"moved:sg:{date.today() + timedelta(days=10)}", "kind": "moved", "region": "sg", "names": ["phone"],
         "until": (date.today() + timedelta(days=10)).isoformat()},
        {"key": f"throttled:{month:%Y-%m}", "kind": "throttled", "until": following.isoformat()},
    ]
    signed_in.delete(f"/api/devices/{device}", headers=HEADERS)
    assert box(signed_in)["notes"] == []


def test_a_closing_group_is_a_note_for_its_accounts(client, db, node, capsys):
    db.execute("INSERT INTO regions (id, node_host, is_open) VALUES ('sg', 'node-sg', true)")
    leader = new_group(capsys, "g1", client=client)
    admin.main(["groups", "close", "g1", "--until", (date.today() + timedelta(days=30)).isoformat()])
    until = (date.today() + timedelta(days=30)).isoformat()
    assert box(leader)["notes"] == [{"key": f"group_closing:{until}", "kind": "group_closing", "until": until}]


def test_invites_to_give_are_a_note_that_stays_seen(signed_in, db):
    create(signed_in)
    db.execute("UPDATE accounts SET created_on = current_date - 14")
    db.execute("UPDATE devices SET connected = true")
    assert box(signed_in)["notes"] == []
    db.execute("UPDATE settings SET value = '2' WHERE key = 'user_invites'")
    assert box(signed_in)["notes"] == [{"key": "invites:2", "kind": "invites", "left": 2}]
    # one made: the key stays, so a note already seen is not new again
    signed_in.post("/api/invites", headers=HEADERS)
    assert box(signed_in)["notes"] == [{"key": "invites:2", "kind": "invites", "left": 1}]
    signed_in.post("/api/invites", headers=HEADERS)
    assert box(signed_in)["notes"] == []
