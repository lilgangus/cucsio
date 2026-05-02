"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { MessageRole, MessageRow, UserRow } from "@/types/db";
import {
  ChatSessionContext,
  type StreamingDraft,
  type UseChatSession,
} from "./use-chat-session";

const MOCK_SESSION_ID = "mock";
const MOCK_CHAT_EVENT = "cucsio:chat-mock";

type MockChatEvent =
  | {
      type: "user_msg";
      authorId: string;
      content: string;
    }
  | {
      type: "assistant_start";
      tmpId: string;
    }
  | {
      type: "assistant_chunk";
      text: string;
    }
  | {
      type: "assistant_done";
    }
  | {
      type: "stream_error";
      reason: string;
    };

declare global {
  interface Window {
    __chatMock?: {
      userMsg: (authorId: string, content: string) => void;
      assistantStart: (tmpId?: string) => void;
      chunk: (text: string) => void;
      assistantDone: () => void;
      streamError: (reason: string) => void;
    };
  }
}

function createMessage(args: {
  role: MessageRole;
  authorId: string | null;
  content: string;
  createdAt: string;
  model?: string | null;
}): MessageRow {
  return {
    id: crypto.randomUUID(),
    session_id: MOCK_SESSION_ID,
    role: args.role,
    author_id: args.authorId,
    content: args.content,
    model: args.model ?? null,
    prompt_tokens: null,
    completion_tokens: null,
    created_at: args.createdAt,
    edited_at: null,
    is_deleted: false,
  };
}

const SEED_MESSAGES: MessageRow[] = [
  createMessage({
    role: "user",
    authorId: "user-1",
    content: "What are the biggest constraints on growing food on Mars?",
    createdAt: "2026-05-02T10:00:00.000Z",
  }),
  createMessage({
    role: "user",
    authorId: "user-2",
    content: "Assume resupply is only every 26 months.",
    createdAt: "2026-05-02T10:00:05.000Z",
  }),
  createMessage({
    role: "assistant",
    authorId: null,
    content:
      "The hard parts are radiation, thin atmosphere, water recovery, and soil chemistry. Long resupply gaps push the design toward sealed habitats, recycled nutrients, and crops that are reliable instead of fancy.",
    createdAt: "2026-05-02T10:00:08.000Z",
    model: "gpt-4o-mini",
  }),
];

function dispatchMockEvent(event: MockChatEvent) {
  window.dispatchEvent(new CustomEvent<MockChatEvent>(MOCK_CHAT_EVENT, { detail: event }));
}

export function MockChatDriver({ children }: { children: ReactNode }) {
  const [messages, setMessages] = useState<MessageRow[]>(SEED_MESSAGES);
  const [draft, setDraft] = useState<StreamingDraft | null>(null);
  const [error, setError] = useState<Error | null>(null);

  const sendMessage = useCallback(async (text: string) => {
    dispatchMockEvent({
      type: "user_msg",
      authorId: "dev-user",
      content: text,
    });
  }, []);

  const refresh = useCallback(async () => {
    setMessages(SEED_MESSAGES);
    setDraft(null);
    setError(null);
  }, []);

  useEffect(() => {
    const handleMockEvent = (rawEvent: Event) => {
      const event = rawEvent as CustomEvent<MockChatEvent>;
      const detail = event.detail;

      switch (detail.type) {
        case "user_msg":
          setMessages((current) => [
            ...current,
            createMessage({
              role: "user",
              authorId: detail.authorId,
              content: detail.content,
              createdAt: new Date().toISOString(),
            }),
          ]);
          return;

        case "assistant_start":
          setDraft({
            tmpId: detail.tmpId,
            content: "",
            startedAt: new Date().toISOString(),
          });
          setError(null);
          return;

        case "assistant_chunk":
          setDraft((current) =>
            current ? { ...current, content: `${current.content}${detail.text}` } : current
          );
          return;

        case "assistant_done":
          setDraft((current) => {
            if (!current) return null;
            setMessages((messagesNow) => [
              ...messagesNow,
              createMessage({
                role: "assistant",
                authorId: null,
                content: current.content,
                createdAt: new Date().toISOString(),
                model: "gpt-4o-mini",
              }),
            ]);
            return null;
          });
          return;

        case "stream_error":
          setDraft(null);
          setError(new Error(detail.reason));
          return;
      }
    };

    window.addEventListener(MOCK_CHAT_EVENT, handleMockEvent);
    return () => window.removeEventListener(MOCK_CHAT_EVENT, handleMockEvent);
  }, []);

  useEffect(() => {
    window.__chatMock = {
      userMsg: (authorId, content) =>
        dispatchMockEvent({ type: "user_msg", authorId, content }),
      assistantStart: (tmpId) =>
        dispatchMockEvent({
          type: "assistant_start",
          tmpId: tmpId ?? crypto.randomUUID(),
        }),
      chunk: (text) => dispatchMockEvent({ type: "assistant_chunk", text }),
      assistantDone: () => dispatchMockEvent({ type: "assistant_done" }),
      streamError: (reason) => dispatchMockEvent({ type: "stream_error", reason }),
    };

    return () => {
      delete window.__chatMock;
    };
  }, []);

  const value = useMemo<UseChatSession>(
    () => ({
      messages,
      draft,
      isStreaming: draft !== null,
      error,
      sendMessage,
      refresh,
    }),
    [draft, error, messages, refresh, sendMessage]
  );

  return (
    <ChatSessionContext.Provider value={value}>{children}</ChatSessionContext.Provider>
  );
}

export const MOCK_USER_ROWS: UserRow[] = [
  {
    id: "user-1",
    display_name: "Maya Chen",
    color: "#14b8a6",
    created_at: "2026-05-02T09:59:00.000Z",
    last_seen_at: "2026-05-02T10:05:00.000Z",
  },
  {
    id: "user-2",
    display_name: "Noah Park",
    color: "#f59e0b",
    created_at: "2026-05-02T09:59:00.000Z",
    last_seen_at: "2026-05-02T10:05:00.000Z",
  },
  {
    id: "dev-user",
    display_name: "Dev User",
    color: "#3b82f6",
    created_at: "2026-05-02T09:59:00.000Z",
    last_seen_at: "2026-05-02T10:05:00.000Z",
  },
];
