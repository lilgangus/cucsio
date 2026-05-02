"use client";

import { Backboard } from "@/components/highlights";
import { useRoomProject } from "@/lib/chat/use-room-project";

export function HighlightsPanel({ roomCode }: { roomCode: string }) {
  const { data: project, error, isLoading } = useRoomProject(roomCode);

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

  return <Backboard projectId={project.id} />;
}
