"use client";

import { CheckIcon, LockIcon } from "lucide-react";
import type { CSSProperties, KeyboardEvent } from "react";

import type { PresenceState } from "@/lib/realtime/channels";
import { cn } from "@/lib/utils";

import { NODE_H, NODE_W } from "./compute-layout";

/**
 * Visual atom of the DAG. One rounded card per session.
 *
 * Selection model:
 *   `isSelected`  — blue ring; the Select control shows a check.
 *   The card body is a `div role="button"` (not a `<button>`) so the
 *   inner Select can remain a real `<button>` without invalid nesting.
 */

type Props = {
  position: { x: number; y: number };
  label: string;
  summary: string;
  isRoot: boolean;
  isMerged: boolean;
  /** True when someone in the session is mid-send. Drawn as a lock chip. */
  isLocked: boolean;
  /** Other clients currently viewing this session. Self should be filtered out by caller. */
  presence: PresenceState[];
  focused?: boolean;
  isSelected?: boolean;
  onSelect?: () => void;
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
  isRoot,
  isMerged,
  isLocked,
  presence,
  focused,
  isSelected,
  onSelect,
  onClick,
  className,
}: Props) {
  const displaySummary =
    summary.trim().length > 0 ? summary : "No summary yet for this agent thread";

  const chipLabel = isMerged ? "blended agents" : isRoot ? "root agent" : "agent";

  const onCardKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onClick?.();
    }
  };

  return (
    <div
      style={baseStyle(position)}
      className={cn("group/node-wrap", className)}
    >
      {/* `div` + role="button" so the Select control can be a nested `<button>`. */}
      <div
        role="button"
        tabIndex={0}
        aria-label={`Open chat: ${label}`}
        onClick={() => onClick?.()}
        onKeyDown={onCardKeyDown}
        className={cn(
          "flex h-full w-full cursor-pointer flex-col items-stretch justify-between gap-1 rounded-2xl border bg-card px-3 py-2 text-left",
          "shadow-sm transition-all hover:scale-[1.02] hover:shadow-md",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          isSelected
            ? "border-blue-500 ring-2 ring-blue-400/60 dark:border-blue-400 dark:ring-blue-300/50"
            : focused
              ? "border-primary/70 ring-2 ring-primary/40"
              : "border-border hover:border-foreground/20"
        )}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1.5">
            <span
              className={cn(
                "truncate text-[11px] font-semibold uppercase tracking-wider",
                isMerged
                  ? "text-violet-500 dark:text-violet-300"
                  : "text-muted-foreground"
              )}
            >
              {chipLabel}
            </span>
            {isLocked ? (
              <LockIcon
                className="size-3 shrink-0 text-amber-500"
                aria-label="Someone is sending"
              />
            ) : null}
          </div>

          <div className="flex items-center gap-1.5">
            <PresenceDots users={presence} />
            <button
              type="button"
              aria-label={isSelected ? "Deselect node" : "Select node"}
              onClick={(e) => {
                e.stopPropagation();
                onSelect?.();
              }}
              onKeyDown={(e) => e.stopPropagation()}
              className={cn(
                "inline-flex size-5 items-center justify-center rounded-full border transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400",
                isSelected
                  ? "border-blue-500 bg-blue-500 text-white dark:border-blue-400 dark:bg-blue-400"
                  : "border-border bg-card text-transparent hover:border-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950"
              )}
            >
              <CheckIcon className="size-3" strokeWidth={3} />
            </button>
          </div>
        </div>

        <span className="line-clamp-2 text-sm font-medium leading-snug text-foreground">
          {label}
        </span>

        <span className="line-clamp-2 text-xs leading-snug text-muted-foreground">
          {displaySummary}
        </span>
      </div>
    </div>
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
