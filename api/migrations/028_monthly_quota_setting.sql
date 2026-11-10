-- The monthly quota of personal accounts, in GB, set with `python -m app.admin settings monthly_quota_gb N` instead of
-- a release. Groups keep their own (groups.monthly_quota_bytes).
INSERT INTO settings (key, value) VALUES ('monthly_quota_gb', '50') ON CONFLICT (key) DO NOTHING;
