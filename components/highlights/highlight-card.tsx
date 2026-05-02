"use client";

import { Badge } from "@/components/ui/badge";
import type { HighlightRow, UserRow } from "@/types/db";

type HighlightCardProps = {
  highlight: HighlightRow;
  user: UserRow | null;
};

function truncateSnippet(content: string): string {
  return content.length > 140 ? `${content.slice(0, 140)}…` : content;
}

function formatRelativeTimestamp(timestamp: string): string {
  const deltaMs = Math.max(0, Date.now() - new Date(timestamp).getTime());
  const minutes = Math.floor(deltaMs / 60000);

  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;

  return `${Math.floor(hours / 24)}d`;
}

export function HighlightCard({ highlight, user }: HighlightCardProps) {
  return (
    <button
      type="button"
      className="flex w-full flex-col gap-2 rounded-lg border border-border bg-background px-3 py-3 text-left shadow-sm transition-colors hover:bg-muted/40"
      onClick={() => {
        if (!highlight.message_id) return;

        window.dispatchEvent(
          new CustomEvent("cucsio:scroll-to-message", {
            detail: {
              sessionId: highlight.session_id,
              messageId: highlight.message_id,
              snippet: highlight.content,
            },
          })
        );
      }}
    >
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>{user?.display_name ?? "Unknown user"}</span>
        <span>{formatRelativeTimestamp(highlight.created_at)}</span>
        <Badge variant={highlight.source === "ai" ? "secondary" : "outline"}>
          {highlight.source === "ai" ? "AI" : "User"}
        </Badge>
      </div>
      <p className="text-sm leading-6 text-foreground">{truncateSnippet(highlight.content)}</p>
      {highlight.note ? (
        <p className="text-xs italic text-muted-foreground">{highlight.note}</p>
      ) : null}
    </button>
  );
}
