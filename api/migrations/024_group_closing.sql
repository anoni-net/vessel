-- The day a group closes (toomore/anoni-net-ws#464). Until then its service goes on; on that day the worker deletes
-- its accounts and devices, and then the group itself. NULL: it is not closing.
ALTER TABLE groups ADD COLUMN closing_on date;
