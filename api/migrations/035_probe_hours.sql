-- What reached each node's AWG port from addresses that are not a device's, one row per node and hour, as the node
-- counted it (node/host/vessel-probe-watch.sh, hourly.csv): packets, how many addresses sent them, how many of those
-- are registered in each broad zone, what the port's guard dropped, and from 2026-11-13 the three counts that leave
-- the devices out. Counts only: the addresses never leave the node's memory. The worker copies the rows here so they
-- outlive the node (a blocked node is replaced, and its file goes with it) and so deploy/health_warn.py can tell when
-- a count rises. A column the node did not have yet at that hour is NULL. Kept for 400 days.
CREATE TABLE probe_hours (
    region_id         text        NOT NULL REFERENCES regions (id) ON DELETE CASCADE,
    hour              timestamptz NOT NULL,          -- the start of the hour
    packets           bigint      NOT NULL,
    sources           bigint      NOT NULL,
    taiwan            bigint,
    hk_macau          bigint,
    china             bigint,
    japan_korea       bigint,
    southeast_asia    bigint,
    other_apac        bigint,
    outside_apac      bigint,
    dropped           bigint,
    probe_packets     bigint,
    handshake_sources bigint,
    handshake_china   bigint,
    PRIMARY KEY (region_id, hour)
);
