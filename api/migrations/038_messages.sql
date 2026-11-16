-- The inbox's announcements (app/inbox.py): what maintainers write with `admin messages add`, for every account, the
-- accounts with a device in one region, or one group. Who an announcement is for is a condition read when the inbox
-- is opened, so no row says which accounts got it.
CREATE TABLE messages (
    id         bigserial PRIMARY KEY,
    -- NULL: every account
    region_id  text REFERENCES regions (id) ON DELETE CASCADE,
    group_code text REFERENCES groups (code) ON DELETE CASCADE,
    -- {"zh-TW": {"title": ..., "body": ...}, "zh-CN": ..., "en": ...}; zh-TW is always there
    texts      jsonb NOT NULL CHECK (texts ? 'zh-TW'),
    created_at timestamptz NOT NULL DEFAULT now(),
    -- the worker deletes it the day after
    expires_on date NOT NULL,
    CHECK (region_id IS NULL OR group_code IS NULL)
);
CREATE INDEX messages_expires_on ON messages (expires_on);

-- The newest announcement the account has seen, a number and no time: what is unread is what comes after it
ALTER TABLE accounts ADD COLUMN messages_read bigint NOT NULL DEFAULT 0;
