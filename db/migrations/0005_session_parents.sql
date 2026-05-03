-- 0004_session_parents.sql
--
-- Adds the session_parents join table to support multi-parent (merged /
-- combined-context) nodes, turning the tree into a DAG.
--
-- Design:
--   - sessions.parent_session_id stays as the "primary" parent used by
--     the layout engine to determine a node's column position.
--   - session_parents stores ALL parent edges (including the primary one).
--     The UI reads from here to render "Branched from [A, B, C]" and to
--     draw the extra edges in the background graph.
--   - For regular single-parent forks, exactly one row exists per child.
--   - For combined-context nodes, two or more rows exist.
--
-- Idempotent. Safe to re-run.

create table if not exists session_parents (
  session_id uuid not null references sessions(id) on delete cascade,
  parent_id  uuid not null references sessions(id) on delete cascade,
  primary key (session_id, parent_id)
);
create index if not exists session_parents_parent_id_idx on session_parents (parent_id);

-- Backfill single-parent forks that were created before this migration.
insert into session_parents (session_id, parent_id)
select id, parent_session_id
from sessions
where parent_session_id is not null
on conflict do nothing;

-- Enable Postgres realtime so the client hooks see new rows immediately.
do $$
begin
  begin
    alter publication supabase_realtime add table session_parents;
  exception when duplicate_object then null;
  end;
end $$;

notify pgrst, 'reload schema';
