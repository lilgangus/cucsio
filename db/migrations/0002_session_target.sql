-- 0002_session_target.sql
-- Add an explicit user-authored target for each session. Search uses this as
-- first-class context when deciding which nodes to inspect.

alter table sessions
  add column if not exists session_target text not null default '';

-- Backfill any pre-existing rows created before this migration.
update sessions
set session_target = coalesce(nullif(trim(session_target), ''), 'General exploration')
where coalesce(nullif(trim(session_target), ''), '') = '';

