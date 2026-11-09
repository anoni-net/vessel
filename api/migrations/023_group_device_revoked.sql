-- The last day a leader revoked one of this account's devices, for the person's own page (toomore/anoni-net-ws#464).
-- Only the day: not which device, not which leader.
ALTER TABLE accounts ADD COLUMN device_revoked_on date;
