"use client";

import { useEffect, useRef, useState } from "react";
import type { Identity } from "@/lib/identity";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type ChatInputProps = {
  onSend: (text: string) => Promise<void>;
  disabled?: boolean;
  identity: Identity;
  placeholder?: string;
};

function resizeTextarea(node: HTMLTextAreaElement | null) {
  if (!node) return;

  node.style.height = "0px";

  const lineHeight = Number.parseFloat(window.getComputedStyle(node).lineHeight || "24");
  const maxHeight = lineHeight * 6 + 16;
  node.style.height = `${Math.min(node.scrollHeight, maxHeight)}px`;
}

/**
 * `Cmd/Ctrl+Enter` sends the current draft. Plain `Enter` inserts a newline.
 */
export function ChatInput({
  onSend,
  disabled = false,
  identity,
  placeholder = "Type a message",
}: ChatInputProps) {
  const [value, setValue] = useState("");
  const [isSending, setIsSending] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    resizeTextarea(textareaRef.current);
  }, [value]);

  async function submit() {
    const text = value.trim();
    if (!text || disabled || isSending) return;

    try {
      setIsSending(true);
      await onSend(text);
      setValue("");
    } finally {
      setIsSending(false);
    }
  }

  return (
    <div className={cn("border-t border-border bg-background/80 px-4 py-3", disabled && "opacity-80")}>
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
        <div className="text-xs text-muted-foreground">{identity.displayName}</div>
        <Textarea
          ref={textareaRef}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
              event.preventDefault();
              void submit();
            }
          }}
          placeholder={disabled ? "Assistant is thinking…" : placeholder}
          disabled={disabled || isSending}
          rows={1}
          className={cn(disabled && "cursor-not-allowed")}
          style={{ maxHeight: "calc(1.5rem * 6 + 1rem)" }}
        />
        <div className="flex justify-end">
          <Button
            onClick={() => void submit()}
            disabled={disabled || isSending || value.trim().length === 0}
          >
            Send
          </Button>
        </div>
      </div>
    </div>
  );
}
