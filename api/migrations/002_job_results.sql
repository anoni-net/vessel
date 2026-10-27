-- add-pubkey returns the client config minus the private key. The browser fetches it once; it is cleared
-- right after, and the worker clears any left unfetched after an hour.
ALTER TABLE jobs ADD COLUMN result jsonb;
ALTER TABLE jobs ADD COLUMN done_at timestamptz;
ALTER TABLE jobs ADD COLUMN next_try_at timestamptz NOT NULL DEFAULT now();
CREATE INDEX jobs_device ON jobs (device_id);

-- the node returns the endpoint and its public key with every add-pubkey, so regions only need to know the node
ALTER TABLE regions DROP COLUMN endpoint;
ALTER TABLE regions DROP COLUMN server_public_key;
