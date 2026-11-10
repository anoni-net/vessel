-- When the confirmation code was made. The page can ask for a new link before the old one runs out (WCAG 2.2.1):
-- the new code replaces the old one and the time to open it starts again; created_at stays when the inspection was asked for.
ALTER TABLE device_inspections ADD COLUMN code_at timestamptz NOT NULL DEFAULT now();
