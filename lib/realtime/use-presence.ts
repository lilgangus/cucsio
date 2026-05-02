"use client";

import type { RealtimeChannel } from "@supabase/supabase-js";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { loadIdentity, type Identity } from "@/lib/identity";
import { projectChannel, type PresenceState } from "@/lib/realtime/channels";
import { getSupabaseBrowser } from "@/lib/supabase/browser";

/** Shared payload builders keep project + forest presence payloads identical. */
function buildPresencePayload(
  identity: Identity,
  focusedSessionId: string | null
): PresenceState {
  return {
    clientId: identity.clientId,
    displayName: identity.displayName,
    color: identity.color,
    joinedAt: new Date().toISOString(),
    focusedSessionId,
  };
}

async function safeUntrack(channel: RealtimeChannel) {
  try {
    await channel.untrack();
  } catch {
    // Older supabase-js / race during teardown — swallow.
  }
}

/**
 * Subscribe to a project's Realtime channel and surface live presence.
 *
 * `focusedSessionId` should reflect which chat node (session) the local
 * user currently has popped open in `ForestCanvas` — `null` when they are
 * only browsing the canvas. This mirrors the AGENTS session presence
 * story at the coarse project level so the top-bar avatars stay in sync.
 *
 * Reliability knobs:
 *   - Tracks only **after** the channel reaches `SUBSCRIBED`
 *   - Re-track on focus transitions, tab visibility regain, heartbeat
 */
export function useProjectPresence(
  projectId: string | null,
  focusedSessionId: string | null
): PresenceState[] {
  const [users, setUsers] = useState<PresenceState[]>([]);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const focusedRef = useRef(focusedSessionId);

  useLayoutEffect(() => {
    focusedRef.current = focusedSessionId;
  }, [focusedSessionId]);

  useEffect(() => {
    if (!projectId) return;

    const identity = loadIdentity();
    const supabase = getSupabaseBrowser();
    const channel = supabase.channel(projectChannel(projectId), {
      config: {
        presence: {
          key: identity?.clientId ?? `anon-${crypto.randomUUID()}`,
        },
      },
    });
    channelRef.current = channel;

    const sync = () => {
      const state = channel.presenceState<PresenceState>();
      const seen = new Map<string, PresenceState>();
      for (const refList of Object.values(state)) {
        for (const entry of refList) {
          if (!entry?.clientId) continue;
          if (!seen.has(entry.clientId)) seen.set(entry.clientId, entry);
        }
      }
      const next = [...seen.values()].sort((a, b) =>
        a.joinedAt.localeCompare(b.joinedAt)
      );
      setUsers(next);
    };

    const pushTrack = async () => {
      const me = loadIdentity();
      if (!me) return;
      try {
        await channel.track(
          buildPresencePayload(me, focusedRef.current)
        );
      } catch (err) {
        console.warn("[presence] project track failed", err);
      }
    };

    channel
      .on("presence", { event: "sync" }, sync)
      .on("presence", { event: "join" }, sync)
      .on("presence", { event: "leave" }, sync)
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          void pushTrack();
        }
      });

    const heartbeat = window.setInterval(() => {
      void pushTrack();
    }, 12000);

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        void pushTrack();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.clearInterval(heartbeat);
      void safeUntrack(channel);
      void channel.unsubscribe();
      void supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [projectId]);

  // Focus transitions after the channel is mounted — inexpensive re-track.
  useEffect(() => {
    const ch = channelRef.current;
    if (!ch) return;
    const me = loadIdentity();
    if (!me) return;
    void ch.track(buildPresencePayload(me, focusedSessionId)).catch((err) => {
      console.warn("[presence] project refocus-track failed", err);
    });
  }, [focusedSessionId]);

  return users;
}
