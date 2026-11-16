-- A group's leaders write announcements for their group's accounts on /group/ (app/groups.py). Which leader wrote one is
-- not kept, as for the inspections they ask for. A leader writes in one language, the one their page is in, so only the
-- maintainers' announcements need zh-TW.
ALTER TABLE messages ADD COLUMN from_leader boolean NOT NULL DEFAULT false,
    ADD CONSTRAINT messages_leader_group CHECK (NOT from_leader OR group_code IS NOT NULL),
    DROP CONSTRAINT messages_texts_check,
    ADD CONSTRAINT messages_texts_check CHECK (from_leader OR texts ? 'zh-TW');
