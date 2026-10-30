from conftest import needs_db

pytestmark = needs_db


def ask(client, ip):
    return client.get("/api/exit", headers={"CF-Connecting-IP": ip})


def test_exit_names_the_node_the_request_came_through(client, db):
    db.execute("INSERT INTO regions (id, node_host, is_open, exit_ip) VALUES ('sg', 'n', true, '198.51.100.1'), "
               "('jp', 'n', true, NULL)")
    r = ask(client, "198.51.100.1")
    assert r.json() == {"region": "sg", "ipv6": False}
    assert r.headers["cache-control"] == "no-store"
    assert ask(client, "203.0.113.9").json() == {"region": None, "ipv6": False}
    assert ask(client, "2001:db8::1").json() == {"region": None, "ipv6": True}


def test_exit_needs_no_session_and_is_rate_limited(client, db):
    for _ in range(30):
        assert ask(client, "203.0.113.9").status_code == 200
    assert ask(client, "203.0.113.9").status_code == 429
    assert ask(client, "203.0.113.10").status_code == 200


def test_admin_keeps_the_exit_ip_unless_given(db, capsys):
    from app import admin

    # conftest points VESSEL_DATABASE_URL at the test database
    admin.main(["regions", "set", "sg", "--node-host", "n1", "--open", "--exit-ip", "198.51.100.1"])
    admin.main(["regions", "set", "sg", "--node-host", "n2", "--closed"])
    assert "sg  n2  closed  exit 198.51.100.1" in capsys.readouterr().out


def test_a_moved_region_keeps_its_old_exit_until_the_old_host_goes(client, db, capsys):
    from app import admin

    admin.main(["regions", "set", "jp", "--node-host", "old", "--open", "--exit-ip", "198.51.100.7"])
    admin.main(["regions", "move", "jp", "--node-host", "new", "--exit-ip", "203.0.113.7", "--until", "2999-01-01"])
    out = capsys.readouterr().out
    assert "jp: 0 devices asked for a new config" in out
    assert "jp  new  open  exit 203.0.113.7  previous 198.51.100.7 until 2999-01-01" in out
    assert ask(client, "203.0.113.7").json() == {"region": "jp", "ipv6": False}
    assert ask(client, "198.51.100.7").json() == {"region": "jp", "ipv6": False, "previous": True}
    # once the old host is gone its address may be someone else's
    db.execute("UPDATE regions SET previous_until = current_date - 1")
    assert ask(client, "198.51.100.7").json() == {"region": None, "ipv6": False}
