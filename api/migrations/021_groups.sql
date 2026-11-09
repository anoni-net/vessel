-- Groups that manage their own accounts (toomore/anoni-net-ws#464). A group is only a code: its real name is kept
-- nowhere the portal can read. An account belongs to at most one group; an existing personal account never joins one.
-- group_label is the alias its leader gave it, which is how the leader knows whose devices these are.
CREATE TABLE groups (
    code                text PRIMARY KEY,
    account_limit       integer NOT NULL CHECK (account_limit > 0),
    device_limit        integer NOT NULL CHECK (device_limit > 0),    -- per account
    monthly_quota_bytes bigint  NOT NULL CHECK (monthly_quota_bytes > 0),    -- per account
    ends_on             date    NOT NULL
);

ALTER TABLE accounts
    ADD COLUMN group_code  text REFERENCES groups (code),
    ADD COLUMN group_role  text CHECK (group_role IN ('leader', 'member')),
    ADD COLUMN group_label text CHECK (char_length(group_label) BETWEEN 1 AND 40),
    ADD CONSTRAINT accounts_group_complete CHECK (
        (group_code IS NULL) = (group_role IS NULL) AND (group_code IS NULL) = (group_label IS NULL)
    ),
    ADD CONSTRAINT accounts_group_label_unique UNIQUE (group_code, group_label);
