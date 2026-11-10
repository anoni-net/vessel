-- Devices that keep trying to connect and never get through (jobs.poll_usage, failing): the node receives their
-- handshakes, but the connection is not made, as when a network drops the node's replies. Per region and day, the most
-- seen at one reading, for the maintainer to notice a city being interfered with. A count only, no device.
ALTER TABLE daily_stats ADD COLUMN failing_devices integer NOT NULL DEFAULT 0;
