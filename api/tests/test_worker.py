import psycopg
import pytest
from conftest import needs_db

from app import worker


class Stop(Exception):
    pass


@needs_db
def test_worker_reconnects_after_losing_its_connection(db, monkeypatch):
    opened = []
    real_connect = worker.connect

    def connect():
        opened.append(real_connect())
        return opened[-1]

    ticks = 0

    def tick(conn, usage=True):
        nonlocal ticks
        ticks += 1
        conn.execute("SELECT 1")
        if ticks == 1:
            # the server drops the worker's connection, as happened in production
            db.execute("SELECT pg_terminate_backend(%s)", (conn.info.backend_pid,))
        if ticks == 3:
            raise Stop

    monkeypatch.setattr(worker, "connect", connect)
    monkeypatch.setattr(worker, "tick", tick)
    monkeypatch.setattr(worker.time, "sleep", lambda _: None)
    with pytest.raises(Stop):
        worker.main([])
    # tick 2 failed on the dead connection; tick 3 ran on a new one
    assert len(opened) == 2
    assert opened[0].closed and not opened[1].closed


@needs_db
def test_worker_connections_use_tcp_keepalives(db):
    with worker.connect() as conn:
        assert conn.info.get_parameters()["keepalives_idle"] == "30"
        assert isinstance(conn, psycopg.Connection)
