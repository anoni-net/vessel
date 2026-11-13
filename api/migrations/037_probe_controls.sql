-- A host without Vessel that counts the same things as a region's node (node/host/vessel-probe-watch.sh, PROBE_ONLY),
-- to set next to the node: what a host in the same place gets with no devices on it (toomore/anoni-net-ws#487). One
-- for a region at most. The worker reads it over SSH like a node, through a jump host when it is not on the tailnet.
-- The addresses stay in the database only, like regions.node_host. Its hours go into probe_hours with control set.
CREATE TABLE probe_controls (
    region_id text PRIMARY KEY REFERENCES regions (id) ON DELETE CASCADE,
    host      text NOT NULL,
    jump      text                        -- user@host of the jump host, or NULL to connect directly
);
ALTER TABLE probe_hours ADD COLUMN control boolean NOT NULL DEFAULT false;
ALTER TABLE probe_hours DROP CONSTRAINT probe_hours_pkey, ADD PRIMARY KEY (region_id, control, hour);
