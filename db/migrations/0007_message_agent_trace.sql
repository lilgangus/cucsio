-- 0007_message_agent_trace.sql
--
-- Persists the visible agent timeline (Differential brainstorming →
-- Evidence retrieval → Attending synthesis) alongside the assistant
-- message it produced. Without this, refreshing the page or coming back
-- later loses the reasoning trace and only the final answer remains.
--
-- Shape on disk matches `PersistedAgentTrace` from
-- `lib/llm/agent-trace.ts`:
--   {
--     "version": 1,
--     "phases": [...AgentPhaseState],
--     "errorMessage": null,
--     "finishedAt": "<iso>"
--   }
--
-- Old assistant rows have NULL — the UI just hides the disclosure for
-- those, no migration / backfill needed.
--
-- Idempotent. Safe to re-run.

alter table messages
  add column if not exists agent_trace jsonb;

notify pgrst, 'reload schema';
