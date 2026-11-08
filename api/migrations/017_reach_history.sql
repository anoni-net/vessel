-- Every check of the sites each node can open, for the last two days, so the status page can show the last 24 hours
-- instead of the latest check alone. The worker adds a node's check when it reads one it has not seen and deletes
-- what is older than 48 hours. Sites and results only: nothing about any user.
CREATE TABLE reach_history (
    region_id  text NOT NULL REFERENCES regions (id) ON DELETE CASCADE,
    site       text NOT NULL,
    state      text NOT NULL CHECK (state IN ('ok', 'challenge', 'blocked')),
    checked_at timestamptz NOT NULL,
    PRIMARY KEY (region_id, site, checked_at)
);
CREATE INDEX reach_history_checked_at ON reach_history (checked_at);

INSERT INTO reach_history (region_id, site, state, checked_at) SELECT region_id, site, state, checked_at FROM reach;
