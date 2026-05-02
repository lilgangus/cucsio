"use client";

import { LockIcon, MessageSquareIcon } from "lucide-react";
import type { CSSProperties } from "react";

import type { PresenceState } from "@/lib/realtime/channels";
import { cn } from "@/lib/utils";

import { NODE_H, NODE_W } from "./compute-layout";

/**
 * Visual atom of the forest. One rounded card per session, sat on top
 * of the canvas at its computed (x, y).
 *
 * Carries three live signals from the DB / realtime layer:
 *   - `messageCount` — informational badge
 *   - `pendingUserId` (boolean here, kept generic) — lock chip
 *   - `presence` — small avatar stack so users can spot at a glance
 *     "another user is in here right now"
 */

type Props = {
  position: { x: number; y: number };
  label: string;
  summary: string;
  messageCount: number;
  isRoot: boolean;
  /** True when someone in the session is mid-send. Drawn as a lock chip. */
  isLocked: boolean;
  /** Other clients currently viewing this session. Self should be filtered out by caller. */
  presence: PresenceState[];
  focused?: boolean;
  onClick?: () => void;
  className?: string;
};

const baseStyle = (position: { x: number; y: number }): CSSProperties => ({
  position: "absolute",
  left: position.x - NODE_W / 2,
  top: position.y - NODE_H / 2,
  width: NODE_W,
  height: NODE_H,
});

export function NodeCard({
  position,
  label,
  summary,
  messageCount,
  isRoot,
  isLocked,
  presence,
  focused,
  onClick,
  className,
}: Props) {
  const displaySummary =
    summary.trim().length > 0
      ? summary
      : messageCount === 0
        ? "Empty chat — click to start"
        : `${messageCount} message${messageCount === 1 ? "" : "s"}`;

  return (
    <button
      type="button"
      onClick={onClick}
      style={baseStyle(position)}
      className={cn(
        "group/node flex flex-col items-stretch justify-between gap-1 rounded-2xl border bg-card px-3 py-2 text-left",
        "shadow-sm transition-all hover:scale-[1.02] hover:shadow-md",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        focused
          ? "border-primary/70 ring-2 ring-primary/40"
          : "border-border hover:border-foreground/20",
        className
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {isRoot ? "root" : label}
          </span>
          {isLocked ? (
            <LockIcon
              className="size-3 shrink-0 text-amber-500"
              aria-label="Someone is sending"
            />
          ) : null}
        </div>
        <PresenceDots users={presence} />
      </div>

      <span className="line-clamp-2 text-sm font-medium leading-snug text-foreground">
        {displaySummary}
      </span>

      <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
        <MessageSquareIcon className="size-3" />
        <span>{messageCount}</span>
      </div>
    </button>
  );
}

/**
 * Compact stack of avatars rendered inside a node card. Stays small
 * (two visible + overflow chip) so it never elbows out the summary.
 */
function PresenceDots({ users }: { users: PresenceState[] }) {
  if (users.length === 0) return null;
  const visible = users.slice(0, 2);
  const overflow = users.length - visible.length;
  return (
    <div className="flex items-center" aria-label={`${users.length} viewing`}>
      {visible.map((u) => (
        <span
          key={u.clientId}
          className="-ml-1 inline-block size-3.5 rounded-full ring-2 ring-card first:ml-0"
          style={{ background: u.color }}
          title={u.displayName}
          aria-hidden
        />
      ))}
      {overflow > 0 ? (
        <span className="-ml-1 inline-flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-muted px-1 text-[9px] font-medium text-muted-foreground ring-2 ring-card">
          +{overflow}
        </span>
      ) : null}
    </div>
  );
}
