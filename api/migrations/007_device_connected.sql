-- Whether a device has ever completed a handshake with its node: yes or no, no time. Enough to count the
-- devices that were created but never connected (toomore/anoni-net-ws#441). Devices that already moved
-- traffic start as connected.
ALTER TABLE devices ADD COLUMN connected boolean NOT NULL DEFAULT false;
UPDATE devices d SET connected = true
WHERE EXISTS (SELECT 1 FROM device_counters c WHERE c.device_id = d.id AND c.rx_bytes + c.tx_bytes > 0)
   OR EXISTS (SELECT 1 FROM device_usage u WHERE u.device_id = d.id AND u.rx_bytes + u.tx_bytes > 0);
