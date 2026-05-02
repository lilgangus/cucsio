"use client";

import { useUsers } from "@/lib/chat/use-users";
import { HighlightCard } from "./highlight-card";
import { useHighlights } from "./use-highlights";

export function Backboard({ projectId }: { projectId: string }) {
  const { highlights, isLoading } = useHighlights(projectId);
  const users = useUsers(highlights.map((highlight) => highlight.created_by));

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
        Loading highlights...
      </div>
    );
  }

  if (highlights.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
        No highlights yet. Pin a message snippet to start the backboard.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto p-3">
      <div className="flex flex-col gap-3">
        {highlights.map((highlight) => (
          <HighlightCard
            key={highlight.id}
            highlight={highlight}
            user={highlight.created_by ? users[highlight.created_by] ?? null : null}
          />
        ))}
      </div>
    </div>
  );
}
