"use client";

import type { RealtimeChannel } from "@supabase/supabase-js";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { loadIdentity, type Identity } from "@/lib/identity";
import { projectChannel, type PresenceState } from "@/lib/realtime/channels";
import { peersFromRealtimePresence } from "@/lib/realtime/presence-peers";
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
    // Race during teardown — swallow.
  }
}

/**
 * Subscribe to a project's Realtime channel and surface live presence.
 *
 * Reliability:
 * - Subscribes only after browser mount so `localStorage` identity matches RoomGuard.
 * - Re-track on focus changes (`useLayoutEffect`) so overlays beat passive effect ordering races.
 */
export function useProjectPresence(
  projectId: string | null,
  focusedSessionId: string | null
): PresenceState[] {
  const [users, setUsers] = useState<PresenceState[]>([]);
  const [mounted, setMounted] = useState(false);

  /** Post-hydration — first client tick where `localStorage` is trustworthy. */
  useEffect(() => {
    setMounted(true);
  }, []);

  const channelRef = useRef<RealtimeChannel | null>(null);
  const subscribedRef = useRef(false);
  const focusedRef = useRef(focusedSessionId);

  useLayoutEffect(() => {
    focusedRef.current = focusedSessionId;
  }, [focusedSessionId]);

  /** When anon storage hydrates shortly after paint, recreate the Presence slot with the real UUID key. */
  const viewerClientId = mounted ? loadIdentity()?.clientId ?? null : null;

  useEffect(() => {
    if (!projectId || !mounted) return;

    const supabase = getSupabaseBrowser();
    /** Stable-ish key ties one Presence slot before identity hydrate (fallback only). */
    const presenceFallbackKey =
      typeof crypto !== "undefined"
        ? `anon-session:${crypto.randomUUID()}`
        : "anon-unknown";

    const channel = supabase.channel(projectChannel(projectId), {
      config: {
        presence: {
          key: viewerClientId ?? presenceFallbackKey,
        },
      },
    });
    channelRef.current = channel;
    subscribedRef.current = false;

    const flushPeers = () => {
      try {
        setUsers(peersFromRealtimePresence(channel));
      } catch (e) {
        console.warn("[presence] flush peers failed", e);
      }
    };

    const pushTrack = async () => {
      const me = loadIdentity();
      if (!me || !subscribedRef.current) return;
      try {
        await channel.track(
          buildPresencePayload(me, focusedRef.current ?? null)
        );
      } catch (err) {
        console.warn("[presence] project track failed", err);
      }
    };

    channel
      .on("presence", { event: "sync" }, flushPeers)
      .on("presence", { event: "join" }, flushPeers)
      .on("presence", { event: "leave" }, flushPeers)
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          subscribedRef.current = true;
          await pushTrack();
          flushPeers();
        } else if (status === "CLOSED" || status === "CHANNEL_ERROR") {
          subscribedRef.current = false;
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
      subscribedRef.current = false;
      void safeUntrack(channel);
      void channel.unsubscribe();
      void supabase.removeChannel(channel);
      if (channelRef.current === channel) {
        channelRef.current = null;
      }
      setUsers([]);
    };
  }, [projectId, mounted, viewerClientId]);

  /** Same-tick focus changes (open/close overlay) must win over random passive ordering. */
  useLayoutEffect(() => {
    if (!mounted || !channelRef.current) return;
    const ch = channelRef.current;
    const me = loadIdentity();
    if (!me) return;
    void ch
      .track(buildPresencePayload(me, focusedSessionId))
      .then(() =>
        queueMicrotask(() => {
          try {
            setUsers(peersFromRealtimePresence(ch));
          } catch {
            /* ignore */
          }
        })
      )
      .catch((err) => {
        console.warn("[presence] refocus-track failed", err);
      });
  }, [focusedSessionId, mounted]);

  return users;
}
