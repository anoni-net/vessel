from collections.abc import Iterator

import psycopg
from psycopg_pool import ConnectionPool

from app.config import load

_pool: ConnectionPool | None = None


def open_pool() -> None:
    global _pool
    if _pool is None:
        # autocommit, so every `with conn.transaction()` is a real transaction that commits when it ends
        _pool = ConnectionPool(load().database_url, min_size=1, max_size=5, open=True, kwargs={"autocommit": True})


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
