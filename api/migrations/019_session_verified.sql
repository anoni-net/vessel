-- Adding or removing a passkey and deleting the account need a recent confirmation (app/auth.py, require_recent).
-- Signing in sets it; sessions from before this change have none, so their first such step asks for one.
ALTER TABLE sessions ADD COLUMN verified_until timestamptz;
ALTER TABLE webauthn_challenges DROP CONSTRAINT webauthn_challenges_purpose_check;
ALTER TABLE webauthn_challenges ADD CONSTRAINT webauthn_challenges_purpose_check
    CHECK (purpose IN ('register', 'login', 'rotate', 'verify'));
