"use client";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { PresenceState } from "@/lib/realtime/channels";
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

function Avatar({ user }: { user: PresenceState }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            className={`${AVATAR_SIZE} ${STACK_OVERLAP} inline-flex items-center justify-center rounded-full text-[10px] font-medium text-white ring-2 ring-background select-none`}
            style={{ background: user.color }}
            aria-label={user.displayName}
          >
            {initials(user.displayName)}
          </span>
        }
      />
      <TooltipContent>
        <div className="flex flex-col gap-0.5">
          <span className="font-medium">{user.displayName}</span>
          <span className="font-mono text-[10px] opacity-70">
            {shortId(user.clientId)}
          </span>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * Live presence list in the room top bar. Subscribes to the project's
 * Realtime channel and renders one colored avatar per connected client.
 * Hovering an avatar shows the display name + first 8 chars of the
 * clientId. Collapses into a `+N` pill past `max`.
 */
export function PresenceBar({ projectId, max = 5 }: Props) {
  const users = useProjectPresence(projectId);

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
            <div className="flex flex-col gap-0.5">
              {users.slice(max).map((user) => (
                <span key={user.clientId}>
                  {user.displayName}{" "}
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
