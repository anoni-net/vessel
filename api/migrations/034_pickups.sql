-- Pickup numbers (toomore/anoni-net-ws#441): someone asks for an invite on /pickup/, gets a number shown once, and comes
-- back to it once a maintainer has approved. The number is the invite: stored like any other code, as a keyed hash,
-- and it cannot be redeemed while it waits or after it was declined. NULL for every other invite.
ALTER TABLE invites ADD COLUMN pickup_state text CHECK (pickup_state IN ('waiting', 'approved', 'declined'));

-- What the person wrote, for the maintainer deciding: choices from a list and a short note, never where they are or how
-- to reach them. Deleted as soon as the request is decided; the worker deletes the invite, and this with it, once the
-- number has run out unused.
CREATE TABLE pickup_requests (
    invite_id bigint PRIMARY KEY REFERENCES invites (id) ON DELETE CASCADE,
    purpose   text NOT NULL,
    network   text NOT NULL,
    note      text NOT NULL DEFAULT '' CHECK (char_length(note) <= 200)
);

-- closed until the maintainer opens it: `admin settings pickup_open true`
INSERT INTO settings (key, value) VALUES ('pickup_open', 'false') ON CONFLICT (key) DO NOTHING;
