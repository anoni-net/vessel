-- The address a node's traffic leaves from, so the connection check (/api/exit) can tell a visitor whether a
-- request came through a Vessel node (toomore/anoni-net-ws#441). Set with `admin regions set --exit-ip`; never
-- shown, only compared with the request's address.
ALTER TABLE regions ADD COLUMN exit_ip inet;
