"use client";

import { useEffect, useState } from "react";

import { loadIdentity, type Identity } from "@/lib/identity";
import { projectChannel, type PresenceState } from "@/lib/realtime/channels";
import { getSupabaseBrowser } from "@/lib/supabase/browser";

/**
 * Subscribe to a project's Realtime channel and surface live presence.
 *
 * Each tab tracks itself with its `clientId` as the presence key, so
 * multiple tabs from the same browser collapse into one entry. The
 * returned list is de-duplicated and sorted by `joinedAt` so the order
 * in the top bar is stable across renders.
 *
 * If no identity is loaded yet (e.g. user navigated directly to the
 * room URL without going through the landing page), the hook still
 * subscribes and observes other people, but doesn't track itself.
 */
export function useProjectPresence(projectId: string | null): PresenceState[] {
  const [users, setUsers] = useState<PresenceState[]>([]);

  useEffect(() => {
    if (!projectId) return;

    const identity: Identity | null = loadIdentity();
    const supabase = getSupabaseBrowser();
    const channel = supabase.channel(projectChannel(projectId), {
      config: {
        presence: { key: identity?.clientId ?? `anon-${crypto.randomUUID()}` },
      },
    });

    const sync = () => {
      const state = channel.presenceState<PresenceState>();
      const seen = new Map<string, PresenceState>();
      for (const refList of Object.values(state)) {
        for (const entry of refList) {
          if (!entry?.clientId) continue;
          // Same clientId in two tabs collapses to a single entry.
          if (!seen.has(entry.clientId)) seen.set(entry.clientId, entry);
        }
      }
      const next = [...seen.values()].sort((a, b) =>
        a.joinedAt.localeCompare(b.joinedAt)
      );
      setUsers(next);
    };

    channel
      .on("presence", { event: "sync" }, sync)
      .on("presence", { event: "join" }, sync)
      .on("presence", { event: "leave" }, sync)
      .subscribe(async (status) => {
        if (status !== "SUBSCRIBED" || !identity) return;
        await channel.track({
          clientId: identity.clientId,
          displayName: identity.displayName,
          color: identity.color,
          joinedAt: new Date().toISOString(),
        } satisfies PresenceState);
      });

    return () => {
      void channel.unsubscribe();
      void supabase.removeChannel(channel);
    };
  }, [projectId]);

  return users;
}
