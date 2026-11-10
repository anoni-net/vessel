-- Removing and suspending a device are now tried until the node answers (app/jobs.py, UNTIL_DONE). Ones that gave up
-- before this change are tried again: a removed device may still be on its node. A suspend for a device resumed since
-- is skipped when it runs.
UPDATE jobs SET status = 'queued', next_try_at = now(), updated_at = now()
WHERE status = 'failed' AND action IN ('remove', 'suspend');
