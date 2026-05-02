# cucsio

Multiplayer ChatGPT-style workspace. Groups join a project with a 6-character
room code, share live LLM chat sessions, fork sessions to explore alternative
threads, pin highlights to a shared backboard, and run a stateless cross-session
AI search.

> [`AGENTS.md`](AGENTS.md) is the source of truth for stack, schema, scope, and
> conventions. Read it before changing anything.

## Quickstart

```bash
npm install
cp .env.example .env.local        # then fill in Supabase + OpenAI keys
npm run dev                       # http://localhost:3000
```

Run the SQL files in [`db/migrations/`](db/migrations/) in order, in the
Supabase SQL editor, before signing in:

1. [`0001_init.sql`](db/migrations/0001_init.sql) — base schema.
2. [`0002_session_target.sql`](db/migrations/0002_session_target.sql) —
   adds `sessions.session_target` (user-authored context for search).
3. [`0003_session_lock_and_realtime.sql`](db/migrations/0003_session_lock_and_realtime.sql) —
   adds the per-session "currently sending" lock and turns on Postgres
   realtime replication for `sessions` and `messages` so the forest UI's
   live hooks fire.

RLS is intentionally disabled for the hackathon (see AGENTS.md).

The landing page lets you create a project (currently with a fake local code,
until the create-project API lands) or join one by 6-char code. Append
`?tree=off` to any room URL to hide the React Flow background as a fallback.

## What's wired vs. what isn't

| Area | Status |
| --- | --- |
| Next.js 16 + Tailwind v4 + shadcn/ui | done |
| Folder structure from AGENTS.md | done |
| `lib/identity.ts` (anonymous clientId in localStorage) | done |
| `lib/supabase/{browser,server}.ts` clients | done |
| `lib/realtime/channels.ts` (channel-name helpers + event type unions) | done |
| `lib/llm/openai.ts` (gpt-4o-mini provider singleton) | done |
| `lib/tree/layout.ts` (dagre layout for fork tree nodes) | done |
| `db/migrations/0001_init.sql` + `types/db.ts` | done |
| Landing page + identity dialog | done |
| Room shell (top bar, 2/3 + 1/3 split, tabs) | done |
| `?tree=off` fallback flag | done |
| `app/api/{users/upsert,summarize,search}/route.ts` | stubs (501) |
| Chat / fork / tree / highlights / search behaviour | placeholders only |

## Layout

```
app/
  page.tsx                          landing: create / join
  (room)/[code]/
    layout.tsx                      top bar + body shell
    page.tsx                        2/3 chat-over-tree, 1/3 highlights+search tabs
    top-bar.tsx                     project name, room code (copy), display-name pill
    chat/ChatPanel.tsx              placeholder
    tree/TreeBackground.tsx         placeholder, hidden when ?tree=off
    highlights/HighlightsPanel.tsx  placeholder
    search/SearchPanel.tsx          placeholder
  api/
    users/upsert/route.ts           501
    summarize/route.ts              501
    search/route.ts                 501
components/
  identity-dialog.tsx               first-load display-name prompt
  ui/                               shadcn primitives
lib/
  identity.ts                       clientId + displayName + color via localStorage
  supabase/{browser,server}.ts      anon (client) + service-role (server) clients
  realtime/channels.ts              channel-name helpers + event type unions
  llm/openai.ts                     gpt-4o-mini provider singleton
  tree/layout.ts                    dagre helper for fork-tree nodes
db/migrations/0001_init.sql
types/db.ts
```

## Conventions (see AGENTS.md for the full list)

- Schema changes ship in the same PR as `types/db.ts` and `db/migrations/`.
- New deps need a one-line justification in the PR description.
- No Yjs / Liveblocks / Convex / custom WebSocket / state library beyond React + SWR / separate ORM / auth.
- Reach for the cheap solution. If unexpected scope expands past ~30 min, simplify or cut.
