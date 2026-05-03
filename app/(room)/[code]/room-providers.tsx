"use client";

import type { ReactNode } from "react";

import { ProjectPresenceProvider } from "@/lib/realtime/project-presence-context";
import { SessionFocusProvider } from "@/lib/realtime/session-focus-context";

type Props = {
  projectId: string;
  children: ReactNode;
};

/**
 * Client providers for room UI: focused session overlay context, then a single
 * project realtime presence subscriber shared by TopBar + forest.
 */
export function RoomProviders({ projectId, children }: Props) {
  return (
    <SessionFocusProvider>
      <ProjectPresenceProvider projectId={projectId}>
        {children}
      </ProjectPresenceProvider>
    </SessionFocusProvider>
  );
}
