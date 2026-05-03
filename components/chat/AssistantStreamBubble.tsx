import { MarkdownContent } from "@/components/chat/MarkdownContent";
import { cn } from "@/lib/utils";

/**
 * In-progress assistant reply: bouncing dots before first token, then streamed text.
 */
export function AssistantStreamBubble({ text }: { text: string }) {
  const hasText = text.trim().length > 0;
  return (
    <div className="flex w-full flex-col items-start gap-1">
      <div
        className={cn(
          "max-w-[80%] min-h-[2.75rem] rounded-2xl border border-border bg-muted px-4 py-2.5 text-sm leading-relaxed text-foreground",
          !hasText && "animate-pulse"
        )}
      >
        {hasText ? (
          <MarkdownContent content={text} />
        ) : (
          <span className="inline-flex items-center gap-1 py-0.5" aria-hidden>
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="size-2 animate-bounce rounded-full bg-muted-foreground/55"
                style={{ animationDelay: `${i * 120}ms` }}
              />
            ))}
          </span>
        )}
      </div>
    </div>
  );
}
