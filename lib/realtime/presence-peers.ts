import type { RealtimeChannel } from "@supabase/supabase-js";

import type { PresenceState } from "@/lib/realtime/channels";

/**
 * Flattens `channel.presenceState()` into a de-duped list of peers.
 * Supabase stores each client's payload under a presence key mapped to `[metas]` or a meta object.
 */
export function peersFromRealtimePresence(
  channel: RealtimeChannel
): PresenceState[] {
  let raw: Record<string, unknown>;
  try {
    raw = channel.presenceState() as Record<string, unknown>;
  } catch {
    return [];
  }

  const seen = new Map<string, PresenceState>();

  function tryAdd(entry: unknown) {
    if (!entry || typeof entry !== "object") return;
    const o = entry as Record<string, unknown>;
    const clientId = o.clientId;
    if (typeof clientId !== "string" || clientId.length === 0) return;

    let displayName: unknown = o.displayName;
    let color: unknown = o.color;
    let joinedAt: unknown = o.joinedAt;
    const fsRaw = o.focusedSessionId;

    if (typeof displayName !== "string" || displayName.length === 0) {
      displayName = "Someone";
    }
    if (typeof color !== "string" || color.length === 0) {
      color = "#94a3b8";
    }
    if (typeof joinedAt !== "string") {
      joinedAt = new Date().toISOString();
    }

    const row: PresenceState = {
      clientId,
      displayName: displayName as string,
      color: color as string,
      joinedAt: joinedAt as string,
    };
    if (typeof fsRaw === "string") {
      row.focusedSessionId = fsRaw;
    } else if (fsRaw === null) {
      row.focusedSessionId = null;
    }
    if (!seen.has(clientId)) seen.set(clientId, row);
  }

  for (const bucket of Object.values(raw ?? {})) {
    if (Array.isArray(bucket)) {
      for (const meta of bucket) tryAdd(meta);
    } else {
      tryAdd(bucket);
    }
  }

  return [...seen.values()].sort((a, b) =>
    a.joinedAt.localeCompare(b.joinedAt)
  );
}
