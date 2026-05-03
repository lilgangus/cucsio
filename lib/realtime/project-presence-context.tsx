"use client";

import { createContext, useContext, type ReactNode } from "react";

import type { PresenceState } from "@/lib/realtime/channels";
import { useSessionFocus } from "@/lib/realtime/session-focus-context";
import { useProjectPresence } from "@/lib/realtime/use-presence";

const ProjectPeersContext = createContext<PresenceState[] | undefined>(
  undefined
);

/**
 * One canonical `project:{id}` realtime presence subscription per room layout.
 * Consumers read `focusedSessionId` on each peer to know which branch they popped
 * open (see AGENTS session protocol). Keeps ForestCanvas off a second `.channel()`
 * reuse path that silently breaks Presence.
 */
export function ProjectPresenceProvider({
  projectId,
  children,
}: {
  projectId: string;
  children: ReactNode;
}) {
  const { focusedSessionId } = useSessionFocus();
  const peers = useProjectPresence(projectId, focusedSessionId);
  return (
    <ProjectPeersContext.Provider value={peers}>
      {children}
    </ProjectPeersContext.Provider>
  );
}

/** Live peers from `project:${projectId}` (must be inside `ProjectPresenceProvider`). */
export function useProjectPeers(): PresenceState[] {
  const v = useContext(ProjectPeersContext);
  if (v === undefined) {
    throw new Error(
      "useProjectPeers must be used within ProjectPresenceProvider"
    );
  }
  return v;
}
