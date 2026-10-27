-- Vessel portal schema. Keep only what the service needs (#433): no email, no IPs, no connection logs.

CREATE TABLE accounts (
    id            bigserial PRIMARY KEY,
    -- Argon2id of the 16-digit account number with a fixed salt and a pepper kept outside the database,
    -- deterministic so a login can look the account up
    number_hash   bytea NOT NULL UNIQUE,
    created_on    date NOT NULL DEFAULT current_date,
    -- day only, enough to expire devices
    last_login_on date,
    -- who invited this account; stays NULL until we decide whether to record invite chains (#433)
    invited_by    bigint REFERENCES accounts (id) ON DELETE SET NULL,
    status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled'))
);

CREATE TABLE invites (
    id               bigserial PRIMARY KEY,
    code_hmac        bytea NOT NULL UNIQUE,
    -- NULL when a maintainer created it from the command line
    created_by       bigint REFERENCES accounts (id) ON DELETE SET NULL,
    created_at       timestamptz NOT NULL DEFAULT now(),
    expires_at       timestamptz NOT NULL,
    redeemed_at      timestamptz,
    redeemed_account bigint REFERENCES accounts (id) ON DELETE SET NULL
);

CREATE TABLE sessions (
    id_hmac    bytea PRIMARY KEY,
    account_id bigint NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
    expires_at timestamptz NOT NULL
);
CREATE INDEX sessions_expires_at ON sessions (expires_at);

CREATE TABLE regions (
    id                text PRIMARY KEY,           -- e.g. 'sg'
    -- how the backend reaches the node's awgctl over the tailnet; never shown to users
    node_host         text NOT NULL,
    -- host:port users connect to; only returned to signed-in users
    endpoint          text NOT NULL,
    server_public_key text NOT NULL,
    is_open           boolean NOT NULL DEFAULT false
);

CREATE TABLE devices (
    id             text PRIMARY KEY,              -- also the peer name on the node; carries no account data
    account_id     bigint NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
    region_id      text NOT NULL REFERENCES regions (id),
    name           text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 40),
    public_key     text NOT NULL UNIQUE,
    tunnel_address inet,
    dns_filter     text NOT NULL CHECK (dns_filter IN ('none', 'malware', 'ads')),
    status         text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'revoking')),
    created_on     date NOT NULL DEFAULT current_date,
    expires_on     date NOT NULL
);
CREATE INDEX devices_account ON devices (account_id);

-- monthly quota is per account and shared by its devices, so deleting a device does not reset it
CREATE TABLE account_usage (
    account_id bigint NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
    period     date NOT NULL,                     -- first day of the month
    rx_bytes   bigint NOT NULL DEFAULT 0,
    tx_bytes   bigint NOT NULL DEFAULT 0,
    PRIMARY KEY (account_id, period)
);

-- last counters read from the node, to turn them into deltas; the node resets them when its container restarts
CREATE TABLE device_counters (
    device_id         text PRIMARY KEY REFERENCES devices (id) ON DELETE CASCADE,
    interface_started text NOT NULL,
    rx_bytes          bigint NOT NULL,
    tx_bytes          bigint NOT NULL
);

-- work for the nodes, done by a background worker so a node being down does not block the portal
CREATE TABLE jobs (
    id         bigserial PRIMARY KEY,
    region_id  text NOT NULL REFERENCES regions (id),
    device_id  text NOT NULL,
    action     text NOT NULL CHECK (action IN ('add', 'remove')),
    -- add: public key, preshared key and DNS filter, cleared once the job is done
    payload    jsonb,
    status     text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'done', 'failed')),
    attempts   integer NOT NULL DEFAULT 0,
    last_error text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX jobs_queued ON jobs (status, created_at) WHERE status = 'queued';

-- switches the maintainers flip without a deploy, e.g. the account cap of a test wave or pausing redemption
CREATE TABLE settings (
    key   text PRIMARY KEY,
    value text NOT NULL
);
INSERT INTO settings (key, value) VALUES ('account_cap', '0'), ('redeem_paused', 'false');
