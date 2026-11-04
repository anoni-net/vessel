-- Invites an account makes for people it knows (toomore/anoni-net-ws#458). Who invited whom is not kept: an
-- invite remembers its maker only while it is unused, to count what the account has left, and forgets it when it
-- is redeemed or expires; the maker keeps a count of how many were used. The never-filled accounts.invited_by
-- goes, so the database has no column for it.
ALTER TABLE accounts DROP COLUMN invited_by;
ALTER TABLE accounts ADD COLUMN invites_used integer NOT NULL DEFAULT 0;
ALTER TABLE invites ADD COLUMN from_account boolean NOT NULL DEFAULT false;
-- an account's unused invites go with the account
ALTER TABLE invites DROP CONSTRAINT invites_created_by_fkey,
    ADD CONSTRAINT invites_created_by_fkey FOREIGN KEY (created_by) REFERENCES accounts (id) ON DELETE CASCADE;
CREATE INDEX invites_created_by ON invites (created_by) WHERE created_by IS NOT NULL;
-- how many invites each account may make; 0 turns it off
INSERT INTO settings (key, value) VALUES ('user_invites', '0');
