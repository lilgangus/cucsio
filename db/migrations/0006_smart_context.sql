-- Distilled context from ancestor sessions, aligned to `session_target`.
-- Populated when branching (fork / combine) via an LLM pass over parent lineage.

alter table sessions
  add column if not exists smart_context text not null default '';
