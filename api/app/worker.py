"""Background worker: runs queued node jobs, expires devices, clears unfetched configs.
Usage: python -m app.worker [--once]"""

import sys
import time

import psycopg

from app import jobs
from app.config import load


def tick(conn: psycopg.Connection) -> None:
    jobs.expire_devices(conn)
    jobs.run_due_jobs(conn)
    jobs.clear_stale_results(conn)


def main(argv: list[str]) -> None:
    with psycopg.connect(load().database_url, autocommit=True) as conn:
        while True:
            tick(conn)
            if "--once" in argv:
                return
            time.sleep(10)


if __name__ == "__main__":
    main(sys.argv[1:])
