-- An invite that makes an account in a group (toomore/anoni-net-ws#464): it carries the group, the role and the alias
-- until it is used, then forgets them (app/auth.py, redeem), so a used invite says nothing about the account it made.
ALTER TABLE invites
    ADD COLUMN group_code  text REFERENCES groups (code) ON DELETE CASCADE,
    ADD COLUMN group_role  text CHECK (group_role IN ('leader', 'member')),
    ADD COLUMN group_label text CHECK (char_length(group_label) BETWEEN 1 AND 40),
    ADD CONSTRAINT invites_group_complete CHECK (
        (group_code IS NULL) = (group_role IS NULL) AND (group_code IS NULL) = (group_label IS NULL)
    ),
    ADD CONSTRAINT invites_group_label_unique UNIQUE (group_code, group_label);
