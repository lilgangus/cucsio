"use client";

import type { RealtimeChannel } from "@supabase/supabase-js";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { loadIdentity } from "@/lib/identity";
import { sessionChannel, type PresenceState } from "@/lib/realtime/channels";
import { peersFromRealtimePresence } from "@/lib/realtime/presence-peers";
import { getSupabaseBrowser } from "@/lib/supabase/browser";
import type {
  MessageRow,
  SessionParentRow,
  SessionParticipantRow,
  SessionRow,
  UserRow,
} from "@/types/db";

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
  /** Supabase requires unique channel names per subscriber; multiple trees call this hook with the same `projectId`. */
  const realtimeScope = useId().replace(/:/g, "");

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
      .channel(`project-sessions:${projectId}:${realtimeScope}`)
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
  }, [projectId, realtimeScope]);

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
 * Per-session `session:{id}` realtime presence — the source of truth for “who has
 * this chat popped open”. One forest hook owns every session channel so we never
 * double-subscribe after `subscribe()` (see duplicate-channel footgun in hooks header).
 *
 * Tracks only **one** topic at a time (the popped overlay session, or parent while
 * a fork is pending). Every other subscribed topic stays `untracked`, but listeners
 * still receive everyone else&apos;s payloads for card dots across the tree.
 */
export function useForestPresence({
  sessionIds,
  activeSessionId,
}: {
  sessionIds: string[];
  activeSessionId: string | null;
}): Record<string, PresenceState[]> {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  const [byId, setById] = useState<Record<string, PresenceState[]>>({});
  const channelsRef = useRef(new Map<string, RealtimeChannel>());
  const activeRef = useRef<string | null>(activeSessionId);
  const activeTrackedRef = useRef<string | null>(null);

  useLayoutEffect(() => {
    activeRef.current = activeSessionId;
  }, [activeSessionId]);

  const sessionIdsKey = useMemo(
    () => sessionIds.slice().sort().join(","),
    [sessionIds]
  );

  const viewerClientId = mounted ? loadIdentity()?.clientId ?? null : null;

  useEffect(() => {
    if (!mounted || !viewerClientId) {
      setById({});
      return undefined;
    }

    const supabase = getSupabaseBrowser();
    const have = channelsRef.current;

    /** Full rebuild avoids stale sockets when identities / session lists shift. */
    for (const ch of have.values()) {
      void ch.unsubscribe();
      void supabase.removeChannel(ch);
    }
    have.clear();
    activeTrackedRef.current = null;

    const seeded: Record<string, PresenceState[]> = {};
    for (const id of sessionIds) {
      seeded[id] = [];
    }
    setById(seeded);

    for (const id of sessionIds) {
      const ch = supabase.channel(sessionChannel(id), {
        config: {
          presence: {
            key: viewerClientId,
          },
        },
      });
      const flush = () =>
        setById((prev) => ({
          ...prev,
          [id]: peersFromRealtimePresence(ch),
        }));
      ch.on("presence", { event: "sync" }, flush)
        .on("presence", { event: "join" }, flush)
        .on("presence", { event: "leave" }, flush)
        .subscribe(async (status) => {
          if (status === "SUBSCRIBED") {
            // If this session is currently focused, immediately claim presence here.
            const identity = loadIdentity();
            if (identity && activeRef.current === id) {
              try {
                await ch.track({
                  clientId: identity.clientId,
                  displayName: identity.displayName,
                  color: identity.color,
                  joinedAt: new Date().toISOString(),
                });
                activeTrackedRef.current = id;
              } catch {
                /* track can race on reconnect */
              }
            }
            flush();
          }
        });
      have.set(id, ch);
    }

    return () => {
      for (const ch of have.values()) {
        void ch.unsubscribe();
        void supabase.removeChannel(ch);
      }
      have.clear();
      activeTrackedRef.current = null;
      setById({});
    };
  }, [sessionIdsKey, mounted, viewerClientId]); // eslint-disable-line react-hooks/exhaustive-deps -- sessionIdsKey gates list

  /** Hop presence immediately on focus changes (untrack previous + track next). */
  useEffect(() => {
    if (!mounted || !viewerClientId) {
      return undefined;
    }

    const hop = async () => {
      const identity = loadIdentity();
      if (!identity) return;
      const active = activeSessionId;
      const prev = activeTrackedRef.current;
      const have = channelsRef.current;

      if (prev && prev !== active) {
        const prevCh = have.get(prev);
        try {
          await prevCh?.untrack();
        } catch {
          /* noop */
        }
      }

      if (active) {
        const nextCh = have.get(active);
        if (nextCh) {
          try {
            await nextCh.track({
              clientId: identity.clientId,
              displayName: identity.displayName,
              color: identity.color,
              joinedAt: new Date().toISOString(),
            });
            activeTrackedRef.current = active;
          } catch {
            /* noop */
          }
        }
      } else {
        activeTrackedRef.current = null;
      }
    };

    void hop();

    const heartbeat = window.setInterval(() => {
      const identity = loadIdentity();
      const active = activeSessionId;
      const ch = active ? channelsRef.current.get(active) : null;
      if (!identity || !ch) return;
      void ch.track({
        clientId: identity.clientId,
        displayName: identity.displayName,
        color: identity.color,
        joinedAt: new Date().toISOString(),
      });
    }, 10000);

    const onVis = () => {
      if (document.visibilityState === "visible") {
        void hop();
      }
    };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      window.clearInterval(heartbeat);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [activeSessionId, mounted, viewerClientId]);

  return byId;
}

type SessionParticipantRowLike = Pick<
  SessionParticipantRow,
  "session_id" | "user_id" | "joined_at" | "last_active_at"
>;
type UserSnippet = Pick<UserRow, "id" | "display_name" | "color">;

/**
 * Polling fallback for session occupancy:
 * - heartbeat writes `session_participants.last_active_at` while a session is focused
 * - periodic reads pull recently-active users per session id
 *
 * This keeps tree icons / overlay participant chips responsive even when
 * websocket presence has transient lag.
 */
export function useSessionOccupancyPolling({
  sessionIds,
  activeSessionId,
  pollMs = 6000,
  activeWindowMs = 25000,
}: {
  sessionIds: string[];
  activeSessionId: string | null;
  pollMs?: number;
  activeWindowMs?: number;
}): Record<string, PresenceState[]> {
  const [byId, setById] = useState<Record<string, PresenceState[]>>({});
  const sessionIdsKey = useMemo(
    () => sessionIds.slice().sort().join(","),
    [sessionIds]
  );

  // Heartbeat the currently-focused session participant row.
  useEffect(() => {
    if (!activeSessionId) return;
    const supabase = getSupabaseBrowser();

    const beat = async () => {
      const me = loadIdentity();
      if (!me) return;
      const now = new Date().toISOString();
      await supabase.from("session_participants").upsert(
        {
          session_id: activeSessionId,
          user_id: me.clientId,
          joined_at: now,
          last_active_at: now,
        },
        { onConflict: "session_id,user_id" }
      );
    };

    void beat();
    const hb = window.setInterval(() => {
      void beat();
    }, 10000);
    const onVis = () => {
      if (document.visibilityState === "visible") {
        void beat();
      }
    };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      window.clearInterval(hb);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [activeSessionId]);

  // Pull recently-active participants for all visible session ids.
  useEffect(() => {
    if (sessionIds.length === 0) {
      setById({});
      return;
    }

    const supabase = getSupabaseBrowser();
    let stale = false;

    const seed: Record<string, PresenceState[]> = {};
    for (const id of sessionIds) seed[id] = [];
    setById(seed);

    const refresh = async () => {
      const cutoff = new Date(Date.now() - activeWindowMs).toISOString();

      const { data: participantsRaw, error } = await supabase
        .from("session_participants")
        .select("session_id, user_id, joined_at, last_active_at")
        .in("session_id", sessionIds)
        .gt("last_active_at", cutoff);
      if (stale || error || !participantsRaw) return;

      const participants = participantsRaw as SessionParticipantRowLike[];
      const userIds = [...new Set(participants.map((p) => p.user_id))];

      let usersById = new Map<string, UserSnippet>();
      if (userIds.length > 0) {
        const { data: usersRaw } = await supabase
          .from("users")
          .select("id, display_name, color")
          .in("id", userIds);
        if (stale) return;
        usersById = new Map(
          ((usersRaw ?? []) as UserSnippet[]).map((u) => [u.id, u])
        );
      }

      const out: Record<string, PresenceState[]> = {};
      for (const id of sessionIds) out[id] = [];
      for (const p of participants) {
        const u = usersById.get(p.user_id);
        out[p.session_id]?.push({
          clientId: p.user_id,
          displayName: u?.display_name ?? "Someone",
          color: u?.color ?? "#94a3b8",
          joinedAt: p.last_active_at || p.joined_at,
          focusedSessionId: p.session_id,
        });
      }
      for (const id of sessionIds) {
        out[id]?.sort((a, b) => a.joinedAt.localeCompare(b.joinedAt));
      }
      setById(out);
    };

    void refresh();
    const t = window.setInterval(() => {
      void refresh();
    }, pollMs);
    const onVis = () => {
      if (document.visibilityState === "visible") {
        void refresh();
      }
    };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      stale = true;
      window.clearInterval(t);
      document.removeEventListener("visibilitychange", onVis);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sessionIdsKey gates identity of session list
  }, [sessionIdsKey, pollMs, activeWindowMs]);

  return byId;
}

/**
 * Live map of session_id → parent_id[] for an entire project.
 *
 * Fetches all rows from `session_parents` where the child session
 * belongs to the project, then listens for INSERTs so newly created
 * forks / combined-context nodes appear in real time.
 *
 * Returns a stable `Record<string, string[]>` where each key is a
 * child session id and the value is the ordered list of its parents
 * (order is insertion order from the DB, which matches the order the
 * caller passed to the combine API).
 */
export function useProjectParents(
  projectId: string | null
): Record<string, string[]> {
  const [byId, setById] = useState<Record<string, string[]>>({});

  useEffect(() => {
    if (!projectId) return;
    const supabase = getSupabaseBrowser();
    let cancelled = false;
    let channel: RealtimeChannel | null = null;

    (async () => {
      const { data, error: err } = await supabase
        .from("session_parents")
        .select(
          "session_id, parent_id, sessions!session_parents_session_id_fkey(project_id)"
        )
        .eq("sessions.project_id", projectId);

      if (cancelled) return;
      if (err) {
        const code = (err as { code?: string }).code;
        const missing =
          code === "PGRST205" ||
          /session_parents/i.test(err.message ?? "");
        if (missing) {
          console.warn(
            "[useProjectParents] `session_parents` is not available yet. " +
              "Run `db/migrations/0004_session_parents.sql` in the Supabase SQL editor " +
              "(it ends with `notify pgrst, 'reload schema';`). Until then, the forest " +
              "uses only `sessions.parent_session_id` for parent links."
          );
        } else {
          console.error("[useProjectParents] initial load", err);
        }
        return;
      }

      type ParentRow = {
        session_id: string;
        parent_id: string;
        sessions: { project_id: string }[] | null;
      };
      const next: Record<string, string[]> = {};
      for (const row of (data ?? []) as unknown as ParentRow[]) {
        const proj = Array.isArray(row.sessions)
          ? row.sessions[0]?.project_id
          : (row.sessions as { project_id: string } | null)?.project_id;
        if (proj !== projectId) continue;
        if (!next[row.session_id]) next[row.session_id] = [];
        next[row.session_id].push(row.parent_id);
      }
      setById(next);

      if (cancelled) return;
      channel = supabase
        .channel(`project-parents:${projectId}`)
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "session_parents" },
          (payload) => {
            const row = payload.new as SessionParentRow;
            setById((prev) => {
              const existing = prev[row.session_id] ?? [];
              if (existing.includes(row.parent_id)) return prev;
              return { ...prev, [row.session_id]: [...existing, row.parent_id] };
            });
          }
        )
        .on(
          "postgres_changes",
          { event: "DELETE", schema: "public", table: "session_parents" },
          (payload) => {
            const row = payload.old as Partial<SessionParentRow>;
            if (!row.session_id || !row.parent_id) return;
            setById((prev) => {
              const existing = prev[row.session_id!] ?? [];
              const next = existing.filter((id) => id !== row.parent_id);
              if (next.length === existing.length) return prev;
              const out = { ...prev };
              if (next.length === 0) delete out[row.session_id!];
              else out[row.session_id!] = next;
              return out;
            });
          }
        )
        .subscribe();
    })();

    return () => {
      cancelled = true;
      if (channel) {
        void channel.unsubscribe();
        void supabase.removeChannel(channel);
      }
    };
  }, [projectId]);

  return byId;
}
