"use client";

import { AgentTree } from "./AgentTree";
import { AgentTriggerWatcher } from "./AgentTriggerWatcher";

/**
 * The bottom-of-the-left-column "agent" panel. Pairs the synthetic
 * agentic tree with a watcher that fires the agent whenever the user
 * tree changes upstream.
 */
export function AgentSection({ projectId }: { projectId: string }) {
  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <AgentTriggerWatcher projectId={projectId} />
      <AgentTree />
    </div>
  );
}
