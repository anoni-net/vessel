-- Moving a region to another host (toomore/anoni-net-ws#436). Configs made before the move still point at the old
-- host's address, so `admin regions move` keeps the old exit address and the day the old host goes away, and marks
-- the region's devices: the devices page asks for a new config, and the connection check recognises the old exit
-- address until that day.
ALTER TABLE regions ADD COLUMN previous_exit_ip inet, ADD COLUMN previous_until date;
ALTER TABLE devices ADD COLUMN moved boolean NOT NULL DEFAULT false;
