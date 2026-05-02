"use client";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { PresenceState } from "@/lib/realtime/channels";
import { useSessionFocus } from "@/lib/realtime/session-focus-context";
import { useProjectPresence } from "@/lib/realtime/use-presence";

type Props = {
  projectId: string;
  /** Maximum number of avatars to render before collapsing into a "+N" pill. */
  max?: number;
};

const AVATAR_SIZE = "size-6";
const STACK_OVERLAP = "-ml-1.5 first:ml-0";

function initials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "?";
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function shortId(clientId: string): string {
  return clientId.slice(0, 8);
}

function focusChip(focusedSessionId?: string | null): string | null {
  if (focusedSessionId == null || focusedSessionId === "") return null;
  const x = focusedSessionId;
  const short =
    x.length <= 14 ? `${x.slice(0, 8)}…` : `${x.slice(0, 6)}…${x.slice(-4)}`;
  return `Focused session ${short}`;
}

function Avatar({ user }: { user: PresenceState }) {
  const subtitle = focusChip(user.focusedSessionId);
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            className={`${AVATAR_SIZE} ${STACK_OVERLAP} inline-flex items-center justify-center rounded-full text-[10px] font-medium text-white ring-2 ring-background select-none`}
            style={{ background: user.color }}
            aria-label={`${user.displayName}${subtitle ? ` — ${subtitle}` : ""}`}
          >
            {initials(user.displayName)}
          </span>
        }
      />
      <TooltipContent>
        <div className="flex max-w-[220px] flex-col gap-0.5">
          <span className="font-medium">{user.displayName}</span>
          {subtitle ? (
            <span className="text-xs text-muted-foreground">{subtitle}</span>
          ) : (
            <span className="text-xs text-muted-foreground">
              Browsing the tree (no chat open)
            </span>
          )}
          <span className="font-mono text-[10px] opacity-70">
            {shortId(user.clientId)}
          </span>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * Live presence in the room top bar. Mirrors `focusedSessionId` from
 * ForestCanvas so avatars reveal which branch another user popped open (or
 * that they&apos;re browsing only).
 */
export function PresenceBar({ projectId, max = 5 }: Props) {
  const { focusedSessionId } = useSessionFocus();
  const users = useProjectPresence(projectId, focusedSessionId);

  if (users.length === 0) {
    return null;
  }

  const visible = users.slice(0, max);
  const overflow = users.length - visible.length;

  return (
    <div className="flex items-center pr-1" aria-label={`${users.length} present`}>
      {visible.map((user) => (
        <Avatar key={user.clientId} user={user} />
      ))}
      {overflow > 0 ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <span
                className={`${AVATAR_SIZE} ${STACK_OVERLAP} inline-flex items-center justify-center rounded-full bg-muted text-[10px] font-medium text-muted-foreground ring-2 ring-background select-none`}
              >
                +{overflow}
              </span>
            }
          />
          <TooltipContent>
            <div className="flex max-w-[220px] flex-col gap-0.5">
              {users.slice(max).map((user) => (
                <span key={user.clientId}>
                  <span className="font-medium">{user.displayName}</span>
                  {focusChip(user.focusedSessionId) ? (
                    <>
                      {" "}
                      <span className="text-xs text-muted-foreground">
                        — {focusChip(user.focusedSessionId)}
                      </span>
                    </>
                  ) : (
                    <>
                      {" "}
                      <span className="text-xs text-muted-foreground">
                        — Browsing tree
                      </span>
                    </>
                  )}{" "}
                  <span className="font-mono opacity-70">
                    {shortId(user.clientId)}
                  </span>
                </span>
              ))}
            </div>
          </TooltipContent>
        </Tooltip>
      ) : null}
    </div>
  );
}
