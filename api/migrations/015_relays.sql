-- Relay routes (anoni-net/vessel#136): an entry point that forwards UDP as it is to a region's node, which stays
-- the exit. A device made through one is an ordinary peer of that region; only its config's Endpoint is the
-- relay's. Relay addresses are operational data like regions.node_host and are set with `admin relays set`,
-- never seeded here.
CREATE TABLE relays (
    id        text PRIMARY KEY,
    region_id text NOT NULL REFERENCES regions (id),
    -- host:port, never shown to the browser
    endpoint  text NOT NULL,
    is_open   boolean NOT NULL DEFAULT false
);
-- NULL is a direct connection to the region's node
ALTER TABLE devices ADD COLUMN relay_id text REFERENCES relays (id);
