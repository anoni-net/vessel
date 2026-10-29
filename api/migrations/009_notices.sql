-- Notices for the status page (/status/): node restarts, maintenance and outages, written by maintainers with
-- `admin notices` (toomore/anoni-net-ws#441). The page shows the last 30 days.
CREATE TABLE notices (
    id        bigserial PRIMARY KEY,
    -- NULL: every region
    region_id text REFERENCES regions (id) ON DELETE CASCADE,
    kind      text NOT NULL CHECK (kind IN ('restart', 'maintenance', 'outage')),
    starts_at timestamptz NOT NULL DEFAULT now(),
    -- NULL while it is still going on
    ends_at   timestamptz,
    CHECK (ends_at IS NULL OR ends_at >= starts_at)
);
CREATE INDEX notices_starts_at ON notices (starts_at);
