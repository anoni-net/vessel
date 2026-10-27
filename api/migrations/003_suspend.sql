-- A device whose account used up the monthly quota is suspended: the node keeps its peer (and preshared key)
-- aside, and puts it back next month. The backend never stored the preshared key, so it cannot re-add it.
ALTER TABLE devices DROP CONSTRAINT devices_status_check;
ALTER TABLE devices ADD CONSTRAINT devices_status_check
    CHECK (status IN ('pending', 'active', 'suspended', 'revoking'));
ALTER TABLE jobs DROP CONSTRAINT jobs_action_check;
ALTER TABLE jobs ADD CONSTRAINT jobs_action_check CHECK (action IN ('add', 'remove', 'suspend', 'resume'));
