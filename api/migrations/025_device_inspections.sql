-- A device inspection the person asked for and confirmed on the device (toomore/anoni-net-ws#480). One per device.
-- report is sealed to public_key, which the person's browser made: the database cannot read it.
-- The confirmation code is kept only as a keyed hash, and only until it is used.
CREATE TABLE device_inspections (
    device_id       text PRIMARY KEY REFERENCES devices (id) ON DELETE CASCADE,
    status          text NOT NULL CHECK (status IN ('confirming', 'active', 'ending', 'ended')),
    code_hmac       bytea UNIQUE,
    public_key      text NOT NULL,
    consent_version text NOT NULL,
    consented_on    date NOT NULL DEFAULT current_date,
    created_at      timestamptz NOT NULL DEFAULT now(),
    started_at      timestamptz,
    ends_at         timestamptz,
    report          jsonb,
    report_until    date
);
CREATE INDEX device_inspections_status ON device_inspections (status);

-- A device deleted in the middle of an inspection, for the worker to clear on the analysis host. Removed once it is cleared.
CREATE TABLE inspection_leftovers (
    region_id text NOT NULL,
    address   inet NOT NULL,
    PRIMARY KEY (region_id, address)
);

CREATE FUNCTION note_inspection_leftover() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM device_inspections WHERE device_id = OLD.id AND status IN ('active', 'ending')) THEN
        INSERT INTO inspection_leftovers (region_id, address) VALUES (OLD.region_id, OLD.tunnel_address) ON CONFLICT DO NOTHING;
    END IF;
    RETURN OLD;
END $$;

CREATE TRIGGER devices_inspection_leftover BEFORE DELETE ON devices FOR EACH ROW EXECUTE FUNCTION note_inspection_leftover();
