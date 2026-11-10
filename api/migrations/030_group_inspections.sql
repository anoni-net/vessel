-- Inspections a group's leader asks for and the member agrees to (toomore/anoni-net-ws#483). The member still turns it
-- on and confirms it on the device; the leaders get a summary sealed to their own keys: the verdict and the kinds of
-- finding, never the sites, the counts or the hours. A member's own inspection, without a request, stays theirs alone.

-- How many of a group's devices can have a requested inspection at once. 0 until the maintainer turns it on.
ALTER TABLE groups ADD COLUMN inspection_limit integer NOT NULL DEFAULT 0 CHECK (inspection_limit >= 0);

-- A leader's key for the summaries, made in the leader's browser: the database has the public half only.
CREATE TABLE leader_keys (
    account_id bigint PRIMARY KEY REFERENCES accounts (id) ON DELETE CASCADE,
    public_key text NOT NULL,
    created_on date NOT NULL DEFAULT current_date
);

-- Where a requested inspection stands for the leaders. Not who asked: any leader of the group sees the same.
--   requested  waiting for the member, until `until`
--   declined   the member said no, until `until`
--   started    the member agreed; device_inspections has the rest, and this row goes when that one does
--   deleted    the member deleted the report, until the day it would have gone
CREATE TABLE group_inspections (
    device_id    text PRIMARY KEY REFERENCES devices (id) ON DELETE CASCADE,
    status       text NOT NULL CHECK (status IN ('requested', 'declined', 'started', 'deleted')),
    requested_on date NOT NULL DEFAULT current_date,
    until        date
);

-- One summary for each leader who had a key when the member agreed, sealed to that key. A leader who comes later, or
-- who makes a new key, cannot open it. It goes with the inspection, and with the leader's account.
CREATE TABLE leader_summaries (
    device_id  text NOT NULL REFERENCES device_inspections (device_id) ON DELETE CASCADE,
    account_id bigint NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
    public_key text NOT NULL,
    summary    jsonb,
    PRIMARY KEY (device_id, account_id)
);
