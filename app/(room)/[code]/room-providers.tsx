"use client";

import type { ReactNode } from "react";

import { AgentActivityProvider } from "@/lib/agent/agent-activity-context";
import { ProjectPresenceProvider } from "@/lib/realtime/project-presence-context";
import { SessionFocusProvider } from "@/lib/realtime/session-focus-context";

type Props = {
  projectId: string;
  children: ReactNode;
};

/**
 * Client providers for room UI: focused session overlay context, project
 * realtime presence (shared by TopBar + forest), and the agent activity
 * store that drives the side-by-side thinking tree plus agent findings.
 */
export function RoomProviders({ projectId, children }: Props) {
  return (
    <SessionFocusProvider>
      <ProjectPresenceProvider projectId={projectId}>
        <AgentActivityProvider>{children}</AgentActivityProvider>
      </ProjectPresenceProvider>
    </SessionFocusProvider>
  );
}
