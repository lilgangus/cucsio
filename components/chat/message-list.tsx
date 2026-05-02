"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Identity } from "@/lib/identity";
import { cn } from "@/lib/utils";
import type { MessageRow } from "@/types/db";
import { useUsers } from "@/lib/chat/use-users";
import type { StreamingDraft } from "./use-chat-session";
import { MessageBubble } from "./message-bubble";

type MessageListProps = {
  messages: MessageRow[];
  draft: StreamingDraft | null;
  identity: Identity;
  onPin?: (selection: { messageId: string; content: string }) => void;
};

const GROUP_WINDOW_MS = 2 * 60 * 1000;
const SCROLL_BOTTOM_THRESHOLD = 80;

type RenderItem = {
  message: MessageRow;
  showGroupMeta: boolean;
  relativeTimestamp: string;
};

function formatRelativeTimestamp(timestamp: string): string {
  const deltaMs = Math.max(0, Date.now() - new Date(timestamp).getTime());
  const minutes = Math.floor(deltaMs / 60000);

  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;

  return `${Math.floor(hours / 24)}d`;
}

function isSameGroup(previous: MessageRow | null, current: MessageRow): boolean {
  if (!previous) return false;

  const previousKey = `${previous.role}:${previous.author_id ?? "assistant"}`;
  const currentKey = `${current.role}:${current.author_id ?? "assistant"}`;
  const deltaMs =
    new Date(current.created_at).getTime() - new Date(previous.created_at).getTime();

  return previousKey === currentKey && deltaMs >= 0 && deltaMs <= GROUP_WINDOW_MS;
}

function toDraftMessage(draft: StreamingDraft): MessageRow {
  return {
    id: draft.tmpId,
    session_id: "draft",
    role: "assistant",
    author_id: null,
    content: draft.content,
    model: "gpt-4o-mini",
    prompt_tokens: null,
    completion_tokens: null,
    created_at: draft.startedAt,
    edited_at: null,
    is_deleted: false,
  };
}

export function MessageList({ messages, draft, identity, onPin }: MessageListProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const nearBottomRef = useRef(true);
  const previousMessageCountRef = useRef(messages.length);
  const [isNearBottom, setIsNearBottom] = useState(true);
  const [unseenCount, setUnseenCount] = useState(0);
  const users = useUsers(messages.map((message) => message.author_id));

  const items = useMemo<RenderItem[]>(() => {
    return messages.map((message, index) => ({
      message,
      showGroupMeta: !isSameGroup(messages[index - 1] ?? null, message),
      relativeTimestamp: formatRelativeTimestamp(message.created_at),
    }));
  }, [messages]);

  function measureNearBottom() {
    const node = scrollRef.current;
    if (!node) return true;

    const distance = node.scrollHeight - node.scrollTop - node.clientHeight;
    return distance <= SCROLL_BOTTOM_THRESHOLD;
  }

  function scrollToBottom() {
    const node = scrollRef.current;
    if (!node) return;

    node.scrollTo({ top: node.scrollHeight, behavior: "smooth" });
    nearBottomRef.current = true;
    setIsNearBottom(true);
    setUnseenCount(0);
  }

  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;

    const handleScroll = () => {
      const nextIsNearBottom = measureNearBottom();
      nearBottomRef.current = nextIsNearBottom;
      setIsNearBottom(nextIsNearBottom);

      if (nextIsNearBottom) {
        setUnseenCount(0);
      }
    };

    handleScroll();
    node.addEventListener("scroll", handleScroll, { passive: true });
    return () => node.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    const appended = messages.length - previousMessageCountRef.current;
    previousMessageCountRef.current = messages.length;

    if (appended <= 0) return;

    if (nearBottomRef.current) {
      requestAnimationFrame(scrollToBottom);
      return;
    }

    setUnseenCount((current) => current + appended);
  }, [messages]);

  useEffect(() => {
    if (draft && nearBottomRef.current) {
      requestAnimationFrame(scrollToBottom);
    }
  }, [draft]);

  const draftMessage = draft ? toDraftMessage(draft) : null;

  return (
    <div className="relative flex-1">
      <div ref={scrollRef} className="h-full overflow-y-auto px-4 py-5">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-0.5">
          {messages.length === 0 && !draft ? (
            <div className="flex min-h-48 items-center justify-center text-sm text-muted-foreground">
              Be the first to ask…
            </div>
          ) : null}

          {items.map(({ message, showGroupMeta, relativeTimestamp }) => (
            <div
              key={message.id}
              className={cn(showGroupMeta ? "pt-4 first:pt-0" : "pt-1")}
            >
              <MessageBubble
                message={message}
                user={message.author_id ? users[message.author_id] ?? null : null}
                identity={identity}
                showGroupMeta={showGroupMeta}
                relativeTimestamp={relativeTimestamp}
                onPin={onPin}
              />
            </div>
          ))}

          {draftMessage ? (
            <div className={cn(items.length > 0 ? "pt-4" : "pt-0")}>
              <MessageBubble
                message={draftMessage}
                user={null}
                identity={identity}
                showGroupMeta
                relativeTimestamp={formatRelativeTimestamp(draftMessage.created_at)}
                pending
              />
            </div>
          ) : null}
        </div>
      </div>

      {!isNearBottom && unseenCount > 0 ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center px-4">
          <button
            type="button"
            className="pointer-events-auto rounded-full border border-border bg-background px-3 py-1.5 text-sm shadow-sm"
            onClick={scrollToBottom}
          >
            {`↓ ${unseenCount} new messages`}
          </button>
        </div>
      ) : null}
    </div>
  );
}
