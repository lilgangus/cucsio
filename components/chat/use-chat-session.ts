"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import {
  authHeaders,
  type Identity,
} from "@/lib/identity";
import { SESSION_BROADCAST_EVENT, sessionChannel, type SessionEvent } from "@/lib/realtime/channels";
import { getSupabaseBrowser } from "@/lib/supabase/browser";
import type { MessageRow } from "@/types/db";

export type StreamingDraft = {
  tmpId: string;
  content: string;
  startedAt: string;
};

export type UseChatSession = {
  messages: MessageRow[];
  draft: StreamingDraft | null;
  isStreaming: boolean;
  error: Error | null;
  sendMessage: (text: string) => Promise<void>;
  refresh: () => Promise<void>;
};

export const ChatSessionContext = createContext<UseChatSession | null>(null);

function upsertMessage(rows: MessageRow[], incoming: MessageRow): MessageRow[] {
  const nextRows = rows.some((row) => row.id === incoming.id)
    ? rows.map((row) => (row.id === incoming.id ? incoming : row))
    : [...rows, incoming];

  return nextRows.sort(
    (left, right) =>
      new Date(left.created_at).getTime() - new Date(right.created_at).getTime()
  );
}

export function useChatSessionCtx(): UseChatSession {
  const ctx = useContext(ChatSessionContext);
  if (!ctx) {
    throw new Error(
      "useChatSessionCtx: no provider found — wrap with <MockChatDriver> or a real ChatSessionContext.Provider"
    );
  }
  return ctx;
}

export function useChatSession(sessionId: string, identity: Identity): UseChatSession {
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [draft, setDraft] = useState<StreamingDraft | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const reconcileTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearDraftReconcileTimer = useCallback(() => {
    if (reconcileTimerRef.current) {
      clearTimeout(reconcileTimerRef.current);
      reconcileTimerRef.current = null;
    }
  }, []);

  const refresh = useCallback(async () => {
    const { data, error: fetchError } = await getSupabaseBrowser()
      .from("messages")
      .select("*")
      .eq("session_id", sessionId)
      .eq("is_deleted", false)
      .order("created_at", { ascending: true })
      .limit(200);

    if (fetchError) {
      setError(fetchError);
      throw fetchError;
    }

    setMessages(data ?? []);
    setError(null);
  }, [sessionId]);

  const sendMessage = useCallback(
    async (text: string) => {
      if (draft) return;

      const res = await fetch("/api/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders(identity),
        },
        body: JSON.stringify({ sessionId, content: text }),
      });

      if (!res.ok) {
        throw new Error(`Send failed: ${res.status}`);
      }
    },
    [draft, identity, sessionId]
  );

  useEffect(() => {
    const supabase = getSupabaseBrowser();
    const channel = supabase
      .channel(sessionChannel(sessionId))
      .on("broadcast", { event: SESSION_BROADCAST_EVENT }, ({ payload }) => {
        const event = payload as SessionEvent;

        switch (event.type) {
          case "user_msg":
            setMessages((current) => upsertMessage(current, event.message));
            return;

          case "assistant_chunk":
            clearDraftReconcileTimer();
            setError(null);
            setDraft((current) => {
              if (current && current.tmpId === event.tmpId) {
                return { ...current, content: current.content + event.delta };
              }

              return {
                tmpId: event.tmpId,
                content: event.delta,
                startedAt: new Date().toISOString(),
              };
            });
            return;

          case "assistant_done":
            clearDraftReconcileTimer();
            setMessages((current) => upsertMessage(current, event.message));
            reconcileTimerRef.current = setTimeout(() => {
              setDraft(null);
              reconcileTimerRef.current = null;
            }, 250);
            return;

          case "stream_error":
            clearDraftReconcileTimer();
            setDraft(null);
            setError(new Error(event.error));
            return;
        }
      })
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `session_id=eq.${sessionId}`,
        },
        ({ new: row }) => {
          const message = row as MessageRow;
          setMessages((current) => upsertMessage(current, message));

          if (message.role === "assistant") {
            clearDraftReconcileTimer();
            setDraft(null);
          }
        }
      );

    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        void refresh();
      }
    });

    return () => {
      clearDraftReconcileTimer();
      void supabase.removeChannel(channel);
    };
  }, [clearDraftReconcileTimer, refresh, sessionId]);

  return {
    messages,
    draft,
    isStreaming: draft !== null,
    error,
    sendMessage,
    refresh,
  };
}
