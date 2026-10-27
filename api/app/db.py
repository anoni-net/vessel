from collections.abc import Iterator

import psycopg
from psycopg_pool import ConnectionPool

from app.config import load

_pool: ConnectionPool | None = None

# TCP keepalives notice a connection that went away without a word reaching us; on 2026-10-27 the worker
# lost its connection that way and kept retrying the dead one for over an hour
KEEPALIVE = {"keepalives": 1, "keepalives_idle": 30, "keepalives_interval": 10, "keepalives_count": 3}


def open_pool() -> None:
    global _pool
    if _pool is None:
        # autocommit, so every `with conn.transaction()` is a real transaction that commits when it ends
        # check: a connection that died while idle in the pool is replaced before a request gets it
        _pool = ConnectionPool(
            load().database_url, min_size=1, max_size=5, open=True, check=ConnectionPool.check_connection,
            kwargs={"autocommit": True, **KEEPALIVE},
        )


def close_pool() -> None:
    global _pool
    if _pool is not None:
        _pool.close()
        _pool = None


def get_conn() -> Iterator[psycopg.Connection]:
    open_pool()
    assert _pool is not None
    with _pool.connection() as conn:
        yield conn
