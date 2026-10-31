-- Blocked lookups by kind (toomore/anoni-net-ws#445): the malware list, and for the ads filter the ad list, counted
-- apart on the node (VESSEL-BLOCKED and VESSEL-ADS). The account keeps monthly totals of both for twelve months, for
-- the monthly summary of what its filters did; counts only, no names and no days.
ALTER TABLE device_counters ADD COLUMN blocked_ads bigint NOT NULL DEFAULT 0;
ALTER TABLE device_usage ADD COLUMN blocked_ads bigint NOT NULL DEFAULT 0;
ALTER TABLE account_usage ADD COLUMN blocked bigint NOT NULL DEFAULT 0, ADD COLUMN blocked_ads bigint NOT NULL DEFAULT 0;
