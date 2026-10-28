-- This month's traffic per device, and how many lookups the malware list blocked for it. Only the counts:
-- the node never records which names were looked up. Rows of past months are deleted by the worker.
CREATE TABLE device_usage (
    device_id text   NOT NULL REFERENCES devices (id) ON DELETE CASCADE,
    period    date   NOT NULL,
    rx_bytes  bigint NOT NULL DEFAULT 0,
    tx_bytes  bigint NOT NULL DEFAULT 0,
    blocked   bigint NOT NULL DEFAULT 0,
    PRIMARY KEY (device_id, period)
);

ALTER TABLE device_counters ADD COLUMN blocked bigint NOT NULL DEFAULT 0;
