"use client";

import { PinIcon } from "lucide-react";

/**
 * Placeholder for the shared backboard.
 *
 * Owner: highlights feature PR. Replace with:
 *   - subscribe to `project:{id}` highlight_created events
 *   - list of pinned snippets, click → scrolls source message into view
 *     in the chat panel (and switches sessions if needed)
 *   - selection-driven "pin this" flow on text inside the chat
 * See AGENTS.md MVP scope #7.
 */
export function HighlightsPanel() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-muted-foreground">
      <PinIcon className="size-6 opacity-40" />
      <p className="text-sm">Highlight a chat snippet to pin it here.</p>
    </div>
  );
}
