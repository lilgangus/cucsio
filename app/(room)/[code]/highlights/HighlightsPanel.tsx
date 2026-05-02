"use client";

import { Backboard } from "@/components/highlights";
import { useRoomProject } from "@/lib/chat/use-room-project";

type HighlightsPanelProps = {
  projectId?: string;
  roomCode?: string;
};

export function HighlightsPanel({
  projectId,
  roomCode,
}: HighlightsPanelProps) {
  const shouldResolveProject = !projectId && Boolean(roomCode);
  const { data: project, error, isLoading } = useRoomProject(
    shouldResolveProject ? (roomCode ?? null) : null
  );

  const resolvedProjectId = projectId ?? project?.id ?? null;

  if (projectId) {
    return <Backboard projectId={projectId} />;
  }

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
        Loading highlights...
      </div>
    );
  }

  if (error || !project) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
        Highlights appear once a project is loaded.
      </div>
    );
  }

  if (!resolvedProjectId) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
        Highlights appear once a project is loaded.
      </div>
    );
  }

  return <Backboard projectId={resolvedProjectId} />;
}
