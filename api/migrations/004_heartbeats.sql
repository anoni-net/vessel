-- When the worker last finished a round, and when it last read each node's counters. A check on the host
-- (deploy/health_warn.py) reads them through /internal/health and alerts when either goes quiet: on
-- 2026-10-27 the worker lost its database connection and nothing noticed for over an hour.
CREATE TABLE heartbeats (
    name text PRIMARY KEY,           -- 'worker', or 'usage:<region id>'
    at   timestamptz NOT NULL
);
