# components/chat

Drop-in Discord-thread-style live chat for a single Cucsio session.

## Public API

```tsx
import { ChatSession, type ChatSessionProps } from "@/components/chat";

<ChatSession
  sessionId="<uuid>"   // required — Supabase sessions.id
  projectId="<uuid>"   // required — used for /api/highlights POST
  identity={identity}  // required — from loadIdentity(); must be non-null
/>
```

Pass `key={sessionId}` at the call site when the session can change, so
React remounts the component and resets all subscriptions.

## Side effects on mount

- **Initial fetch**: `messages` filtered by `session_id`, `is_deleted=false`, limit 200.
- **Realtime channel**: subscribes to `session:{sessionId}` for broadcast
  events (`user_msg`, `assistant_chunk`, `assistant_done`, `stream_error`)
  and a `postgres_changes` INSERT backstop on the same filter. One channel
  per `<ChatSession>` instance.
- **Window event listener**: listens for `cucsio:scroll-to-message`
  `{ sessionId, messageId, snippet? }` — scrolls and flashes the target
  message when `detail.sessionId` matches.

On unmount all three are cleaned up. A `console.assert` verifies the
Supabase channel is fully removed.

## Dev / mock playground

Navigate to `/dev/chat` (no backend required). The page wraps
`<ChatSession sessionId="mock" ...>` inside `<MockChatDriver>`, which
provides the same `UseChatSession` context shape via window CustomEvents
instead of Supabase.

Simulate events from the browser console:

```js
__chatMock.userMsg('user-2', 'hello')
__chatMock.assistantStart()
__chatMock.chunk('some text ')
__chatMock.assistantDone()
__chatMock.streamError('network timeout')
```

Use the **Unmount ChatSession** button in the toolbar to verify the
WebSocket subscription drops (check the Network → WS tab).

## Known limitations

- **Out-of-order chunks**: broadcast chunks are appended in arrival order.
  If the server delivers two deltas slightly out of sequence mid-stream,
  the in-flight text may look odd. The final assistant row from Postgres is
  authoritative and replaces the draft on `assistant_done`.
- **Snippet matching is first-occurrence-only**: `findAndFlashMessage`
  wraps the first matching text node in a `<mark>`. If the snippet appears
  multiple times in the same message, only the first instance is highlighted.
- **No char-offset persistence**: `highlights.content` is a plain string;
  position within the message is not stored.
