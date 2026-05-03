"use client";

import type { RealtimeChannel } from "@supabase/supabase-js";
import { useEffect, useMemo, useRef, useState } from "react";

import { loadIdentity } from "@/lib/identity";
import { sessionChannel, type PresenceState } from "@/lib/realtime/channels";
import { getSupabaseBrowser } from "@/lib/supabase/browser";
import type { MessageRow, SessionRow } from "@/types/db";

/**
 * Live data hooks for the forest UI.
 *
 * These wrap Supabase Realtime CDC ("postgres_changes") so the client
 * sees inserts/updates as soon as they hit Postgres — no broadcast
 * machinery, no polling. Per AGENTS.md the DB is the source of truth;
 * realtime fan-out is a hint, and a cold reload always re-syncs from
 * the table.
 *
 * Migration 0002 enables the realtime publication on `sessions` and
 * `messages` so these `postgres_changes` subscriptions actually fire.
 */

/**
 * Live list of every session in a project. Initial load via REST,
 * subsequent inserts/updates via Postgres CDC. Returns the rows in
 * `created_at` order.
 */
export function useProjectSessions(projectId: string | null): {
  sessions: SessionRow[];
  loading: boolean;
  error: string | null;
} {
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) return;
    const supabase = getSupabaseBrowser();
    let cancelled = false;

    (async () => {
      const { data, error: err } = await supabase
        .from("sessions")
        .select("*")
        .eq("project_id", projectId)
        .order("created_at", { ascending: true });
      if (cancelled) return;
      if (err) {
        setError(err.message);
        setLoading(false);
        return;
      }
      setSessions((data ?? []) as SessionRow[]);
      setLoading(false);
    })();

    const channel = supabase
      .channel(`project-sessions:${projectId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "sessions",
          filter: `project_id=eq.${projectId}`,
        },
        (payload) => {
          const row = payload.new as SessionRow;
          setSessions((prev) =>
            prev.some((s) => s.id === row.id) ? prev : [...prev, row]
          );
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "sessions",
          filter: `project_id=eq.${projectId}`,
        },
        (payload) => {
          const row = payload.new as SessionRow;
          setSessions((prev) =>
            prev.map((s) => (s.id === row.id ? row : s))
          );
        }
      )
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "sessions",
          filter: `project_id=eq.${projectId}`,
        },
        (payload) => {
          const row = payload.old as Partial<SessionRow>;
          if (!row.id) return;
          setSessions((prev) => prev.filter((s) => s.id !== row.id));
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      void channel.unsubscribe();
      void supabase.removeChannel(channel);
    };
  }, [projectId]);

  // Stable order: oldest first. Memoize so consumers can reference-compare.
  const ordered = useMemo(
    () =>
      [...sessions].sort((a, b) =>
        a.created_at.localeCompare(b.created_at)
      ),
    [sessions]
  );

  return { sessions: ordered, loading, error };
}

/**
 * Live list of messages in one session. Skips the subscription
 * entirely when `sessionId` is null (e.g. overlay closed) so we don't
 * burn a websocket on nothing.
 */
export function useSessionMessages(sessionId: string | null): {
  messages: MessageRow[];
  loading: boolean;
  error: string | null;
} {
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [loading, setLoading] = useState<boolean>(sessionId !== null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId) {
      // Resetting state when the input "external param" goes null is
      // the canonical sync-with-external-system effect; the lint rule
      // is a heuristic so we suppress here.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMessages([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const supabase = getSupabaseBrowser();
    let cancelled = false;

    (async () => {
      const { data, error: err } = await supabase
        .from("messages")
        .select("*")
        .eq("session_id", sessionId)
        .eq("is_deleted", false)
        .order("created_at", { ascending: true });
      if (cancelled) return;
      if (err) {
        setError(err.message);
        setLoading(false);
        return;
      }
      setMessages((data ?? []) as MessageRow[]);
      setLoading(false);
    })();

    const channel = supabase
      .channel(`session-messages:${sessionId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `session_id=eq.${sessionId}`,
        },
        (payload) => {
          const row = payload.new as MessageRow;
          setMessages((prev) =>
            prev.some((m) => m.id === row.id) ? prev : [...prev, row]
          );
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      void channel.unsubscribe();
      void supabase.removeChannel(channel);
    };
  }, [sessionId]);

  return { messages, loading, error };
}

/**
 * Per-session presence for the whole forest, in one place.
 *
 * Why a single hook instead of one per call site:
 *
 *   `supabase.channel(topic)` *reuses* an existing channel if one with
 *   the same topic already exists (RealtimeClient.channel: "If a
 *   channel with the same topic already exists it will be returned
 *   instead of creating a duplicate connection."). If two hooks both
 *   ask for the `session:<id>` channel and each calls `.on('presence',
 *   …)` after the first one has already triggered `subscribe()`, the
 *   second `.on()` throws:
 *     "cannot add `presence` callbacks for realtime:session:<id>
 *      after `subscribe()`."
 *
 *   So we have one owner of the per-session channels — this hook,
 *   mounted by the canvas — and we share its results with the overlay
 *   via props.
 *
 * Tracking: we only call `track()` on the channel for `activeSessionId`.
 * That way opening a node makes you "present" in it; closing the
 * overlay (or switching nodes) untracks. Just being in the room
 * doesn't make you appear in every node.
 *
 * Strict-mode-friendly: channels are owned in a ref and torn down on
 * unmount. The per-id diff in the sessionIds effect adds new channels
 * and removes stale ones rather than re-creating the whole set.
 */
export function useForestPresence({
  sessionIds,
  activeSessionId,
}: {
  sessionIds: string[];
  activeSessionId: string | null;
}): Record<string, PresenceState[]> {
  const [byId, setById] = useState<Record<string, PresenceState[]>>({});
  const channelsRef = useRef<Map<string, RealtimeChannel>>(new Map());

  // Stable comma-joined key so identical-content arrays don't refire.
  const sessionIdsKey = useMemo(
    () => sessionIds.slice().sort().join(","),
    [sessionIds]
  );

  // 1. Maintain a channel per session id (add/remove on diff). One
  //    owner per topic, so no `.channel(name)` collision with anyone
  //    else in the app.
  useEffect(() => {
    const supabase = getSupabaseBrowser();
    const identity = loadIdentity();
    const want = new Set(sessionIds);
    const have = channelsRef.current;

    // Tear down channels for sessions that no longer exist.
    for (const [id, ch] of [...have.entries()]) {
      if (want.has(id)) continue;
      void ch.unsubscribe();
      void supabase.removeChannel(ch);
      have.delete(id);
      setById((prev) => {
        if (!(id in prev)) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      });
    }

    // Add channels for newly-discovered sessions.
    for (const id of sessionIds) {
      if (have.has(id)) continue;
      // Use a dedicated topic so this channel never collides with the
      // session broadcast+postgres_changes channel in useChatSession.
      // supabase.channel() reuses an existing channel by topic; calling
      // .on("postgres_changes") on an already-subscribed channel throws.
      const ch = supabase.channel(`presence:${id}`, {
        config: {
          presence: {
            key: identity?.clientId ?? `anon-${crypto.randomUUID()}`,
          },
        },
      });
      const sync = () => {
        const state = ch.presenceState<PresenceState>();
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
        setById((prev) => ({ ...prev, [id]: next }));
      };
      ch.on("presence", { event: "sync" }, sync)
        .on("presence", { event: "join" }, sync)
        .on("presence", { event: "leave" }, sync)
        .subscribe();
      have.set(id, ch);
    }
    // No cleanup here — diff-based add/remove above plus the unmount
    // effect below handle tear-down. Returning a no-op also keeps
    // Strict Mode from tearing down everything between the two
    // double-invoked mounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionIdsKey]);

  // 2. Track ourselves on the active session only. `.track()` is
  //    queued until the channel reports SUBSCRIBED, so we don't need
  //    a join-state listener.
  useEffect(() => {
    if (!activeSessionId) return;
    const identity = loadIdentity();
    if (!identity) return;
    const ch = channelsRef.current.get(activeSessionId);
    if (!ch) return;

    let cancelled = false;
    void (async () => {
      try {
        await ch.track({
          clientId: identity.clientId,
          displayName: identity.displayName,
          color: identity.color,
          joinedAt: new Date().toISOString(),
        } satisfies PresenceState);
      } catch (err) {
        if (!cancelled) {
          console.warn("[forest presence] track failed", err);
        }
      }
    })();

    return () => {
      cancelled = true;
      // Best-effort untrack; if the channel is already gone (e.g.
      // session deleted), Supabase quietly no-ops.
      void ch.untrack().catch(() => undefined);
    };
  }, [activeSessionId]);

  // 3. Tear everything down on unmount. (Strict Mode will run this
  //    between its double mounts; the sessionIds effect re-creates
  //    the channels on the second mount.)
  useEffect(() => {
    const channels = channelsRef.current;
    return () => {
      const supabase = getSupabaseBrowser();
      for (const ch of channels.values()) {
        void ch.unsubscribe();
        void supabase.removeChannel(ch);
      }
      channels.clear();
    };
  }, []);

  return byId;
}
