"use client";

import { useCallback, useEffect } from "react";
import { useSWRConfig } from "swr";
import { toast } from "sonner";
import { findAndFlashMessage } from "@/lib/chat/scroll";
import { authHeaders, type Identity } from "@/lib/identity";
import type { HighlightRow } from "@/types/db";
import { ChatInput } from "./chat-input";
import { MessageList } from "./message-list";
import { useChatSession, useChatSessionCtx } from "./use-chat-session";

type ScrollToMessageDetail = {
  sessionId: string;
  messageId: string;
  snippet?: string;
};

export type ChatSessionProps = {
  sessionId: string;
  projectId: string;
  identity: Identity;
};

export function ChatSession({ sessionId, projectId, identity }: ChatSessionProps) {
  if (sessionId === "mock") {
    return (
      <MockChatSessionInner
        identity={identity}
        projectId={projectId}
        sessionId={sessionId}
      />
    );
  }

  return (
    <RealChatSessionInner
      identity={identity}
      projectId={projectId}
      sessionId={sessionId}
    />
  );
}

function MockChatSessionInner({
  identity,
  projectId,
  sessionId,
}: {
  identity: Identity;
  projectId: string;
  sessionId: string;
}) {
  const session = useChatSessionCtx();

  return (
    <ChatSessionLayout
      messages={session.messages}
      draft={session.draft}
      sendMessage={session.sendMessage}
      isStreaming={session.isStreaming}
      identity={identity}
      projectId={projectId}
      sessionId={sessionId}
    />
  );
}

function RealChatSessionInner({
  identity,
  projectId,
  sessionId,
}: {
  identity: Identity;
  projectId: string;
  sessionId: string;
}) {
  const session = useChatSession(sessionId, identity);

  return (
    <ChatSessionLayout
      messages={session.messages}
      draft={session.draft}
      sendMessage={session.sendMessage}
      isStreaming={session.isStreaming}
      identity={identity}
      projectId={projectId}
      sessionId={sessionId}
    />
  );
}

function ChatSessionLayout({
  messages,
  draft,
  sendMessage,
  isStreaming,
  identity,
  projectId,
  sessionId,
}: {
  messages: ReturnType<typeof useChatSessionCtx>["messages"];
  draft: ReturnType<typeof useChatSessionCtx>["draft"];
  sendMessage: ReturnType<typeof useChatSessionCtx>["sendMessage"];
  isStreaming: boolean;
  identity: Identity;
  projectId: string;
  sessionId: string;
}) {
  const { mutate } = useSWRConfig();

  useEffect(() => {
    const handleScrollToMessage = (event: Event) => {
      const detail = (event as CustomEvent<ScrollToMessageDetail>).detail;
      if (!detail || detail.sessionId !== sessionId) return;

      findAndFlashMessage(detail.messageId, detail.snippet);
    };

    window.addEventListener("cucsio:scroll-to-message", handleScrollToMessage);
    return () =>
      window.removeEventListener("cucsio:scroll-to-message", handleScrollToMessage);
  }, [sessionId]);

  const handlePin = useCallback(
    async ({ messageId, content }: { messageId: string; content: string }) => {
      try {
        const response = await fetch("/api/highlights", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...authHeaders(identity),
          },
          body: JSON.stringify({ sessionId, messageId, content }),
        });

        if (!response.ok) {
          throw new Error(`Pin failed: ${response.status}`);
        }

        const data = (await response.json()) as { highlight: HighlightRow };

        if (projectId === "mock") {
          void mutate<HighlightRow[]>(
            ["highlights", projectId],
            (current = []) => [data.highlight, ...current],
            { revalidate: false }
          );
        }

        toast.success("Pinned to backboard.");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Pin failed");
      }
    },
    [identity, mutate, projectId, sessionId]
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <MessageList
        messages={messages}
        draft={draft}
        identity={identity}
        onPin={handlePin}
      />
      <ChatInput onSend={sendMessage} disabled={isStreaming} identity={identity} />
    </div>
  );
}
