"""Background worker: runs queued node jobs, expires devices, clears unfetched configs, and every few minutes
reads the nodes' transfer counters and enforces the monthly quota.
Usage: python -m app.worker [--once]"""

import sys
import time
import traceback

import psycopg

from app import jobs, policy
from app.config import load
from app.db import KEEPALIVE

USAGE_EVERY = 300  # seconds


def tick(conn: psycopg.Connection, usage: bool = True) -> None:
    jobs.expire_devices(conn)
    if usage:
        jobs.poll_usage(conn)
        jobs.enforce_quota(conn, policy.MONTHLY_QUOTA_BYTES)
    jobs.run_due_jobs(conn)
    jobs.clear_stale_results(conn)
    jobs.beat(conn, "worker")


def connect() -> psycopg.Connection:
    return psycopg.connect(load().database_url, autocommit=True, **KEEPALIVE)


def main(argv: list[str]) -> None:
    last_usage = 0.0
    conn: psycopg.Connection | None = None
    while True:
        now = time.monotonic()
        due = now - last_usage >= USAGE_EVERY
        try:
            # a lost connection stays lost, so open a new one instead of retrying it every tick
            if conn is None or conn.closed or conn.broken:
                conn = connect()
            tick(conn, usage=due)
            if due:
                last_usage = now
        except psycopg.Error:
            # a database hiccup (or a deploy that has not migrated yet) should not kill the worker
            traceback.print_exc()
            if "--once" in argv:
                raise
        if "--once" in argv:
            return
        time.sleep(10)


if __name__ == "__main__":
    main(sys.argv[1:])
