"use client";

import { MessageSquareIcon } from "lucide-react";

type Props = {
  roomCode: string;
};

/**
 * Placeholder for the shared chat surface.
 *
 * Owner: chat feature PR. Replace this stub with:
 *   - editable master prompt textarea (debounced 300ms; broadcast on
 *     `project:{id}` master_context events; do not stomp the focused typist)
 *   - message list (subscribed to `session:{id}` user_msg + assistant_chunk
 *     + assistant_done events)
 *   - per-user input (locked while a stream is in flight)
 * See AGENTS.md "Realtime model" and "How a chat turn flows".
 */
export function ChatPanel({ roomCode }: Props) {
  return (
    <section className="relative z-10 flex h-full min-h-0 flex-1 flex-col bg-background/80 backdrop-blur-sm">
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center text-muted-foreground">
        <MessageSquareIcon className="size-8 opacity-40" />
        <h2 className="font-heading text-lg text-foreground">Chat</h2>
        <p className="max-w-sm text-sm">
          Wire up the shared session here. Room <code className="font-mono">{roomCode}</code>.
          See <code className="font-mono">AGENTS.md</code> §Realtime model.
        </p>
      </div>
    </section>
  );
}
