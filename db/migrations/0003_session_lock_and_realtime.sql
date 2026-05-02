-- 0003_session_lock_and_realtime.sql
--
-- Adds the per-session "currently sending" lock (see AGENTS.md don't-forget
-- list: "Lock all chat inputs in a session while an assistant stream is in
-- flight. Unlock on assistant_done.") and turns on Postgres realtime
-- replication for sessions + messages so client hooks can subscribe to
-- inserts/updates without polling.
--
-- Run after 0001_init.sql and 0002_session_target.sql. Idempotent.

alter table sessions
  add column if not exists pending_user_id uuid references users(id) on delete set null,
  add column if not exists pending_since timestamptz;

-- Realtime publication membership. Wrapping in a do-block lets us swallow
-- the "table is already part of the publication" error so this script is
-- safely re-runnable in the SQL editor.
do $$
begin
  begin
    alter publication supabase_realtime add table sessions;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table messages;
  exception when duplicate_object then null;
  end;
end $$;

-- Tell PostgREST to drop its schema cache so the new columns are
-- visible immediately. Without this, /api/sessions/[id]/messages can
-- return PGRST204 until the cache refreshes on its own.
notify pgrst, 'reload schema';
