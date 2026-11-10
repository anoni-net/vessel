-- Over the monthly quota a device is slowed down instead of suspended (node/awgctl, throttle). The worker suspends no
-- more devices; the ones it suspended before come back online, slowed down while their account is still over.
ALTER TABLE devices ADD COLUMN throttled boolean NOT NULL DEFAULT false;
ALTER TABLE jobs DROP CONSTRAINT jobs_action_check;
ALTER TABLE jobs ADD CONSTRAINT jobs_action_check
    CHECK (action IN ('add', 'remove', 'suspend', 'resume', 'throttle', 'unthrottle'));
