-- Counts for a whole node since its container started (node/awgctl, node_totals): packets that look like BitTorrent,
-- new connections refused because a device was at its limit, and all new connections for scale. The worker keeps the
-- latest it read with the usage, for deploy/health_warn.py. Nothing in them is per device or per address.
CREATE TABLE node_totals (
    region_id text NOT NULL REFERENCES regions (id) ON DELETE CASCADE,
    name      text NOT NULL,
    value     bigint NOT NULL,
    since     text NOT NULL,                      -- when the node's container started, as the node says it
    PRIMARY KEY (region_id, name)
);
