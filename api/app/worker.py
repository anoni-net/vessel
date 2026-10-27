"""Background worker: runs queued node jobs, expires devices, clears unfetched configs, and every few minutes
reads the nodes' transfer counters and enforces the monthly quota.
Usage: python -m app.worker [--once]"""

import sys
import time
import traceback

import psycopg

from app import jobs, policy
from app.config import load

USAGE_EVERY = 300  # seconds


def tick(conn: psycopg.Connection, usage: bool = True) -> None:
    jobs.expire_devices(conn)
    if usage:
        jobs.poll_usage(conn)
        jobs.enforce_quota(conn, policy.MONTHLY_QUOTA_BYTES)
    jobs.run_due_jobs(conn)
    jobs.clear_stale_results(conn)


def main(argv: list[str]) -> None:
    last_usage = 0.0
    with psycopg.connect(load().database_url, autocommit=True) as conn:
        while True:
            now = time.monotonic()
            due = now - last_usage >= USAGE_EVERY
            try:
                tick(conn, usage=due)
            except psycopg.Error:
                # a database hiccup (or a deploy that has not migrated yet) should not kill the worker
                traceback.print_exc()
                if "--once" in argv:
                    raise
            if due:
                last_usage = now
            if "--once" in argv:
                return
            time.sleep(10)


if __name__ == "__main__":
    main(sys.argv[1:])
