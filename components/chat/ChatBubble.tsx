import { MarkdownContent } from "@/components/chat/MarkdownContent";
import { cn } from "@/lib/utils";

export type ChatBubbleSenderChip = { label: string; color: string };

export function ChatBubble({
  role,
  content,
  senderChip,
}: {
  role: "user" | "assistant";
  content: string;
  senderChip: ChatBubbleSenderChip | null;
}) {
  const isUser = role === "user";
  return (
    <div
      className={cn(
        "flex w-full flex-col gap-1",
        isUser ? "items-end" : "items-start"
      )}
    >
      {isUser && senderChip ? (
        <span className="flex items-center gap-1 px-1 text-[10px] text-muted-foreground">
          <span
            className="inline-block size-2 rounded-full"
            style={{ background: senderChip.color }}
            aria-hidden
          />
          <span>{senderChip.label}</span>
        </span>
      ) : null}
      <div
        className={cn(
          "max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
          isUser
            ? "whitespace-pre-wrap bg-primary text-primary-foreground"
            : "border border-border bg-muted text-foreground"
        )}
      >
        {isUser ? (
          content
        ) : (
          <MarkdownContent content={content} />
        )}
      </div>
    </div>
  );
}
