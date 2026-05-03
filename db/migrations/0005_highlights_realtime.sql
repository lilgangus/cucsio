-- Enable Postgres changes for highlights so the right-panel list updates live.

do $$
begin
  begin
    alter publication supabase_realtime add table highlights;
  exception when duplicate_object then null;
  end;
end $$;

notify pgrst, 'reload schema';
