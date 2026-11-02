-- Passkeys: another way to sign in, and the way to replace a lost or leaked account number
-- (toomore/anoni-net-ws#444). Only what checking a signature needs is kept: no AAGUID, which would name the
-- password manager or the key model, and no time of last use; the account already has its last sign-in day.
ALTER TABLE accounts ADD COLUMN webauthn_user_id bytea UNIQUE;

CREATE TABLE passkeys (
    id            bigserial PRIMARY KEY,
    account_id    bigint NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
    credential_id bytea NOT NULL UNIQUE,
    public_key    bytea NOT NULL,
    sign_count    bigint NOT NULL DEFAULT 0,
    -- a name the person chose, to tell their passkeys apart
    label         text NOT NULL DEFAULT '' CHECK (length(label) <= 40),
    created_on    date NOT NULL DEFAULT current_date
);
CREATE INDEX passkeys_account ON passkeys (account_id);

-- what the browser is asked to sign; good for five minutes and one use
CREATE TABLE webauthn_challenges (
    challenge  bytea PRIMARY KEY,
    purpose    text NOT NULL CHECK (purpose IN ('register', 'login', 'rotate')),
    account_id bigint REFERENCES accounts (id) ON DELETE CASCADE,
    expires_at timestamptz NOT NULL
);
