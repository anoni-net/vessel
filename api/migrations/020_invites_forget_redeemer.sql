-- A maintainer's invite no longer records the account it made (app/auth.py, redeem), and a used invite keeps only the
-- day it was used: the order the codes were used in matched the order the accounts were made, which tied a code to
-- an account without this column too.
ALTER TABLE invites DROP COLUMN redeemed_account;
UPDATE invites SET redeemed_at = date_trunc('day', redeemed_at) WHERE redeemed_at IS NOT NULL;
