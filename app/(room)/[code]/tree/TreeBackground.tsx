"use client";

import { GitBranchIcon } from "lucide-react";

type Props = {
  roomCode: string;
};

/**
 * Placeholder for the React Flow + dagre fork tree that lives BEHIND
 * the chat panel. When a user clicks an empty tree area, the chat panel
 * fades and the tree takes the foreground (zoom out). Clicking a node
 * re-opens that session over the tree.
 *
 * Owner: tree feature PR. Use `lib/tree/layout.ts` for the dagre pass.
 * Hide entirely when `?tree=off` is set (handled in page.tsx).
 * See AGENTS.md "Forking semantics" and the don't-forget list.
 */
export function TreeBackground({ roomCode }: Props) {
  return (
    <div
      aria-hidden
      className="absolute inset-0 z-0 flex items-end justify-end p-4 text-muted-foreground/40"
    >
      <div className="flex items-center gap-2 text-xs">
        <GitBranchIcon className="size-3.5" />
        <span>Fork tree placeholder · room {roomCode}</span>
      </div>
    </div>
  );
}
