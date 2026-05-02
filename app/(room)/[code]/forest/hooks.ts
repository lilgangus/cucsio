"use client";

import type { RealtimeChannel } from "@supabase/supabase-js";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { loadIdentity } from "@/lib/identity";
import { sessionChannel, type PresenceState } from "@/lib/realtime/channels";
import { getSupabaseBrowser } from "@/lib/supabase/browser";
import type { MessageRow, SessionRow, UserRow } from "@/types/db";

/** Snapshot from `users` for message attribution (presence is ephemeral). */
export type MessageAuthorSnippet = Pick<UserRow, "id" | "display_name" | "color">;

function collectAuthorIds(messages: Iterable<MessageRow>): string[] {
  const out = new Set<string>();
  for (const m of messages) {
    if (m.author_id) out.add(m.author_id);
  }
  return [...out];
}

async function fetchAuthorSnippets(
  supabase: ReturnType<typeof getSupabaseBrowser>,
  ids: string[]
): Promise<MessageAuthorSnippet[]> {
  const uniq = [...new Set(ids)];
  if (uniq.length === 0) return [];
  const { data, error } = await supabase
    .from("users")
    .select("id, display_name, color")
    .in("id", uniq);
  if (error || !data) return [];
  return data as MessageAuthorSnippet[];
}

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
 * Live list of messages for one session. No realtime subscription while
 * `sessionId` is null, but prefetch rows still drive `users`-row hydration
 * (pending fork overlay). Attribution maps `messages.author_id` → `users`
 * so bubbles don&apos;t rely on ephemeral presence alone.
 */
export function useSessionMessages(
  sessionId: string | null,
  /** Visible seed rows before fetch (fork overlay); also drives author hydration while sessionId is null. */
  prefetchMessages?: MessageRow[] | null
): {
  messages: MessageRow[];
  authorsByUserId: Record<string, MessageAuthorSnippet>;
  /** Load `users` rows for the given IDs (fire-and-forget; merge is idempotent). */
  ensureAuthorsKnown: (userIds: string[]) => void;
  loading: boolean;
  error: string | null;
} {
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [authorsByUserId, setAuthorsByUserId] = useState<
    Record<string, MessageAuthorSnippet>
  >({});
  const [loading, setLoading] = useState<boolean>(sessionId !== null);
  const [error, setError] = useState<string | null>(null);

  /** Avoid re-subscribing `session-messages:*` every time fork seed arrays are re-created. */
  const prefetchMessagesRef = useRef(prefetchMessages);
  useLayoutEffect(() => {
    prefetchMessagesRef.current = prefetchMessages;
  }, [prefetchMessages]);

  const mergeSnippetRows = useCallback((rows: MessageAuthorSnippet[]) => {
    if (rows.length === 0) return;
    setAuthorsByUserId((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const row of rows) {
        const existing = next[row.id];
        if (
          !existing ||
          existing.display_name !== row.display_name ||
          existing.color !== row.color
        ) {
          next[row.id] = row;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, []);

  const ensureAuthorsKnown = useCallback(
    (userIds: string[]) => {
      const uniq = [...new Set(userIds.filter(Boolean))];
      if (uniq.length === 0) return;
      void (async () => {
        const supabase = getSupabaseBrowser();
        const rows = await fetchAuthorSnippets(supabase, uniq);
        mergeSnippetRows(rows);
      })();
    },
    [mergeSnippetRows]
  );

  /** User rows for seed transcript (handles pending fork with sessionId == null). */
  useEffect(() => {
    const seed = prefetchMessages;
    if (!seed?.length) return;
    const supabase = getSupabaseBrowser();
    let stale = false;
    void (async () => {
      const rows = await fetchAuthorSnippets(supabase, collectAuthorIds(seed));
      if (stale) return;
      mergeSnippetRows(rows);
    })();
    return () => {
      stale = true;
    };
  }, [prefetchMessages, mergeSnippetRows]);

  useEffect(() => {
    if (!sessionId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMessages([]);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    const supabase = getSupabaseBrowser();

    const hydrateAuthors = async (ids: string[]) => {
      const uniq = [...new Set(ids.filter(Boolean))];
      if (uniq.length === 0 || cancelled) return;
      const rows = await fetchAuthorSnippets(supabase, uniq);
      if (cancelled) return;
      mergeSnippetRows(rows);
    };

    setLoading(true);
    void hydrateAuthors(
      collectAuthorIds(prefetchMessagesRef.current ?? [])
    );

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
      const rows = (data ?? []) as MessageRow[];
      await hydrateAuthors(collectAuthorIds(rows));
      if (cancelled) return;
      setMessages(rows);
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
          void hydrateAuthors(row.author_id ? [row.author_id] : []);
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      void channel.unsubscribe();
      void supabase.removeChannel(channel);
    };
  }, [sessionId, mergeSnippetRows]);

  return {
    messages,
    authorsByUserId,
    ensureAuthorsKnown,
    loading,
    error,
  };
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
 * Tracking: exactly one `session:<id>` channel gets `track()` at a time —
 * whichever session the overlay is occupying (including `"new-fork"`, which
 * stays on the parent until the fork row exists). All other channels stay
 * `untracked` so lingering presence entries don&apos;t linger.
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
  /** Always points at whichever session overlay is actively focused */
  const activeRef = useRef<string | null>(activeSessionId);

  // Stable comma-joined key so identical-content arrays don't refire.
  const sessionIdsKey = useMemo(
    () => sessionIds.slice().sort().join(","),
    [sessionIds]
  );

  useLayoutEffect(() => {
    activeRef.current = activeSessionId;
  }, [activeSessionId]);

  /** Keep our presence footprint on exactly one channel at a time. */
  async function reconcileAllTracks() {
    const identity = loadIdentity();
    if (!identity) return;
    const active = activeRef.current;
    for (const [id, ch] of channelsRef.current.entries()) {
      try {
        if (active === id) {
          await ch.track({
            clientId: identity.clientId,
            displayName: identity.displayName,
            color: identity.color,
            joinedAt: new Date().toISOString(),
            focusedSessionId: id,
          });
        } else {
          await ch.untrack();
        }
      } catch {
        // Race during subscribe/unsubscribe — ignore.
      }
    }
  }

  // 1. Maintain a channel per session id (add/remove on diff). One
  //    owner per topic, so no `.channel(name)` collision with anyone
  //    else in the app.
  useEffect(() => {
    const identity = loadIdentity();
    const supabase = getSupabaseBrowser();
    /** Without an identity ForestCanvas shouldn't render, but bail safely. */
    if (!identity) return;

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
      const ch = supabase.channel(sessionChannel(id), {
        config: {
          presence: {
            key: identity.clientId,
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
        .subscribe(async (status) => {
          if (status !== "SUBSCRIBED") return;
          /** First sync after handshake — reconcile which session we occupy */
          await reconcileAllTracks();
        });
      have.set(id, ch);
    }
    // Immediately reconcile in case subscriptions already OPEN.
    void reconcileAllTracks();

    // No cleanup here — diff-based add/remove above plus the unmount
    // effect below handle tear-down. Returning a no-op also keeps
    // Strict Mode from tearing down everything between the two
    // double-invoked mounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionIdsKey]);

  // 2. When the focused session changes — hop presence between channels.
  useEffect(() => {
    void reconcileAllTracks();

    /** Heartbeat: Supabase docs recommend periodic re-tracking in long-lived tabs */
    const hb = window.setInterval(() => {
      void reconcileAllTracks();
    }, 12000);

    /** Tab sleep / reconnect — push presence immediately on wake */
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        void reconcileAllTracks();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      window.clearInterval(hb);
      document.removeEventListener("visibilitychange", onVisibility);
      void reconcileAllTracks();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSessionId, sessionIdsKey]);

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
