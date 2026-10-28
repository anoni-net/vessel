-- One row per UTC day and region, totals only, to follow the test over time: how many devices connected that
-- day, the traffic through the node, and how many devices expired. Nothing per account or device; which
-- devices connected comes from the node's last-handshake times and is not stored. Kept for 400 days.
CREATE TABLE daily_stats (
    day             date    NOT NULL,
    region_id       text    NOT NULL REFERENCES regions (id),
    active_devices  integer NOT NULL DEFAULT 0,
    rx_bytes        bigint  NOT NULL DEFAULT 0,
    tx_bytes        bigint  NOT NULL DEFAULT 0,
    expired_devices integer NOT NULL DEFAULT 0,
    PRIMARY KEY (day, region_id)
);
