-- 0004_projects_realtime.sql
-- Enable Postgres realtime for `projects` so master_context edits propagate
-- to all clients via postgres_changes (same pattern as sessions/messages).
--
-- Run after 0003. Idempotent.

do $$
begin
  begin
    alter publication supabase_realtime add table projects;
  exception when duplicate_object then null;
  end;
end $$;

notify pgrst, 'reload schema';
