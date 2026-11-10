-- Ending an inspection takes steps: the node stops copying, the analysis host closes what it has received, and the
-- report waits until that has been analysed. Otherwise the last packets are left out, and counted again after the clear.
ALTER TABLE device_inspections ADD COLUMN stopped_at timestamptz, ADD COLUMN flushed_at timestamptz;
