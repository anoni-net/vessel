-- The node keeps receiving this device's handshakes but the connection is not made (jobs.failing): most likely the
-- network it is on drops the node's replies. Yes or no only, for the devices page to say so; cleared at the next
-- handshake. Not shown to a group's leaders.
ALTER TABLE devices ADD COLUMN failing boolean NOT NULL DEFAULT false;
