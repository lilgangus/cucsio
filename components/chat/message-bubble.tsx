"use client";

import dynamic from "next/dynamic";
import { PinIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  getMessageSelection,
  showSingleMessageSelectionToast,
  type MessageSelection,
} from "@/lib/chat/selection";
import { displayLabel, type Identity } from "@/lib/identity";
import { cn } from "@/lib/utils";
import type { MessageRow, UserRow } from "@/types/db";

const MarkdownMessage = dynamic(
  async () => {
    const [{ default: ReactMarkdown }, { default: remarkGfm }] = await Promise.all([
      import("react-markdown"),
      import("remark-gfm"),
    ]);

    function MarkdownRenderer({ content }: { content: string }) {
      return (
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            p: ({ children }) => <p className="mb-3 last:mb-0">{children}</p>,
            ul: ({ children }) => <ul className="mb-3 list-disc pl-5 last:mb-0">{children}</ul>,
            ol: ({ children }) => <ol className="mb-3 list-decimal pl-5 last:mb-0">{children}</ol>,
            code: ({ children }) => (
              <code className="rounded bg-black/5 px-1 py-0.5 text-[0.85em] dark:bg-white/10">
                {children}
              </code>
            ),
            pre: ({ children }) => (
              <pre className="overflow-x-auto rounded-md bg-black/5 p-3 text-xs dark:bg-white/10">
                {children}
              </pre>
            ),
            a: ({ children, href }) => (
              <a
                className="text-primary underline underline-offset-2"
                href={href}
                target="_blank"
                rel="noreferrer"
              >
                {children}
              </a>
            ),
          }}
        >
          {content}
        </ReactMarkdown>
      );
    }

    return MarkdownRenderer;
  },
  {
    ssr: false,
    loading: () => <p className="whitespace-pre-wrap text-sm leading-6 text-foreground/80">...</p>,
  }
);

type MessageBubbleProps = {
  message: MessageRow;
  user: UserRow | null;
  identity: Identity;
  showGroupMeta: boolean;
  pending?: boolean;
  relativeTimestamp?: string;
  onPin?: (selection: MessageSelection) => void;
};

function hashHue(input: string): number {
  let hash = 0;

  for (let index = 0; index < input.length; index += 1) {
    hash = (hash * 31 + input.charCodeAt(index)) % 360;
  }

  return hash;
}

function avatarStyle(authorId: string | null) {
  if (!authorId) {
    return { backgroundColor: "hsl(220 10% 44%)" };
  }

  return { backgroundColor: `hsl(${hashHue(authorId)} 56% 48%)` };
}

function getDisplayName(message: MessageRow, user: UserRow | null, identity: Identity): string {
  if (message.role === "assistant") {
    return "Assistant";
  }

  if (message.author_id === identity.clientId) {
    return identity.displayName;
  }

  return user?.display_name ?? "Unknown user";
}

function getInitials(displayName: string): string {
  const words = displayName
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (words.length === 0 || displayName === "Unknown user") {
    return "??";
  }

  return words
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("")
    .padEnd(2, "?");
}

export function MessageBubble({
  message,
  user,
  identity,
  showGroupMeta,
  pending = false,
  relativeTimestamp = "now",
  onPin,
}: MessageBubbleProps) {
  const isAssistant = message.role === "assistant";
  const displayName = getDisplayName(message, user, identity);
  const initials = isAssistant ? "AI" : getInitials(displayName);
  const tooltip = message.author_id === identity.clientId ? displayLabel(identity) : displayName;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [pinSelection, setPinSelection] = useState<
    (MessageSelection & { top: number; left: number }) | null
  >(null);

  const updatePinSelection = useCallback(() => {
    if (!onPin || pending) return;

    const container = containerRef.current;
    const selection = window.getSelection();
    if (!container || !selection || selection.rangeCount === 0) {
      setPinSelection(null);
      return;
    }

    const anchorInside =
      selection.anchorNode ? container.contains(selection.anchorNode) : false;
    const focusInside =
      selection.focusNode ? container.contains(selection.focusNode) : false;

    if (!anchorInside && !focusInside) {
      setPinSelection(null);
      return;
    }

    const messageSelection = getMessageSelection();
    if (!messageSelection) {
      if (selection.toString().trim().length > 0) {
        showSingleMessageSelectionToast();
      }
      setPinSelection(null);
      return;
    }

    if (messageSelection.messageId !== message.id) {
      setPinSelection(null);
      return;
    }

    const range = selection.getRangeAt(0);
    const selectionRect = range.getBoundingClientRect();

    setPinSelection({
      ...messageSelection,
      top: Math.max(12, selectionRect.top - 36),
      left: Math.max(
        12,
        Math.min(
          selectionRect.right + 8,
          window.innerWidth - 72
        )
      ),
    });
  }, [message.id, onPin, pending]);

  useEffect(() => {
    if (!onPin || pending) return;

    const handleSelectionChange = () => {
      const selection = window.getSelection();
      if (!selection || selection.toString().trim().length === 0) {
        setPinSelection(null);
      }
    };

    document.addEventListener("selectionchange", handleSelectionChange);

    return () => {
      document.removeEventListener("selectionchange", handleSelectionChange);
    };
  }, [onPin, pending]);

  useEffect(() => {
    if (!onPin || pending) return;

    const container = containerRef.current;
    if (!container) return;

    const handleMouseUp = () => window.setTimeout(updatePinSelection, 0);
    const handleKeyUp = () => window.setTimeout(updatePinSelection, 0);

    container.addEventListener("mouseup", handleMouseUp);
    container.addEventListener("keyup", handleKeyUp);

    return () => {
      container.removeEventListener("mouseup", handleMouseUp);
      container.removeEventListener("keyup", handleKeyUp);
    };
  }, [onPin, pending, updatePinSelection]);

  return (
    <div
      data-message-id={pending ? "draft" : message.id}
      className="grid grid-cols-[32px_minmax(0,1fr)] gap-3"
    >
      <div className="pt-1">
        {showGroupMeta ? (
          <div
            className="flex size-8 items-center justify-center rounded-full text-[11px] font-semibold text-white"
            style={avatarStyle(message.author_id)}
            title={tooltip}
          >
            {initials}
          </div>
        ) : null}
      </div>

      <div
        ref={containerRef}
        className={cn("relative min-w-0", !showGroupMeta && "pt-0.5")}
      >
        {showGroupMeta ? (
          <div className="mb-1 flex items-center gap-2 text-sm leading-5">
            <span className="font-medium text-foreground">{displayName}</span>
            {isAssistant ? (
              <Badge variant="secondary">{message.model ?? "gpt-4o-mini"}</Badge>
            ) : null}
            <span className="text-xs text-muted-foreground">{relativeTimestamp}</span>
          </div>
        ) : null}

        <article
          className={cn(
            "rounded-lg px-3 py-2 text-sm leading-6 text-foreground",
            isAssistant ? "bg-muted/40" : "bg-background",
            pending && "border border-dashed border-border"
          )}
        >
          <div className="break-words">
            <MarkdownMessage content={message.content} />
          </div>

          {pending ? (
            <div className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="size-2 animate-pulse rounded-full bg-muted-foreground/70 [animation-delay:0ms]" />
              <span className="size-2 animate-pulse rounded-full bg-muted-foreground/70 [animation-delay:150ms]" />
              <span className="size-2 animate-pulse rounded-full bg-muted-foreground/70 [animation-delay:300ms]" />
            </div>
          ) : null}
        </article>

        {pinSelection && onPin ? (
          <div
            className="fixed z-40"
            style={{
              top: pinSelection.top,
              left: pinSelection.left,
            }}
          >
            <Button
              size="xs"
              variant="outline"
              className="rounded-full shadow-sm"
              onClick={() => {
                onPin({
                  messageId: pinSelection.messageId,
                  content: pinSelection.content,
                });
                setPinSelection(null);
                window.getSelection()?.removeAllRanges();
              }}
              aria-label="Pin selection"
            >
              <PinIcon className="size-3.5" />
              Pin
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
