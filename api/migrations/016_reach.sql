-- Which common sites each region's node can open, as the node last checked them (node/host/vessel-reach.py, every
-- hour). The status page and the connection check tell people on a node that blocks a site which city opens it.
-- Sites and results only: nothing about any user.
CREATE TABLE reach (
    region_id  text NOT NULL REFERENCES regions (id) ON DELETE CASCADE,
    site       text NOT NULL,
    state      text NOT NULL CHECK (state IN ('ok', 'challenge', 'blocked')),
    -- when the node checked, from its file
    checked_at timestamptz NOT NULL,
    -- when the worker read the file, so it reads it again only every half hour
    fetched_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (region_id, site)
);
