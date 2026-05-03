"use client";

import { BrainCircuitIcon, SparklesIcon, Trash2Icon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useAgentActivity } from "@/lib/agent/agent-activity-context";
import { cn } from "@/lib/utils";

/**
 * Mirror of `HighlightsPanel`, but for the synthetic agent feed. The
 * agent autonomously pins items at the end of every traversal cycle.
 * Users can dismiss items manually.
 */
export function AgentHighlightsPanel() {
  const { highlights, unpinHighlight, phase } = useAgentActivity();

  if (highlights.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-muted-foreground">
        <div className="flex size-9 items-center justify-center rounded-2xl bg-violet-500/10 text-violet-600 dark:text-violet-300">
          <BrainCircuitIcon className="size-4" />
        </div>
        <p className="text-sm">
          The agent hasn&apos;t pinned anything yet.
        </p>
        <p className="text-[11px]">
          Findings the agent confirms while traversing its tree land here.
        </p>
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-2 p-3">
      {highlights.map((h, i) => (
        <li key={h.id}>
          <div
            className={cn(
              "group/agent-h relative overflow-hidden rounded-xl border border-violet-300/50 bg-violet-50/60 px-3 py-2.5 pr-9 text-left shadow-sm",
              "dark:border-violet-400/30 dark:bg-violet-500/10",
              i === 0 && phase !== "idle"
                ? "ring-1 ring-amber-300/60 dark:ring-amber-300/40"
                : null
            )}
          >
            <div
              aria-hidden
              className="pointer-events-none absolute inset-y-0 left-0 w-1 bg-gradient-to-b from-violet-400 via-fuchsia-500 to-amber-400"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="absolute top-1.5 right-1.5 z-10 text-muted-foreground hover:text-destructive"
              aria-label="Remove agent finding"
              onClick={() => unpinHighlight(h.id)}
            >
              <Trash2Icon className="size-3.5" />
            </Button>

            <SparklesIcon
              className="mb-1 size-3.5 text-violet-700 dark:text-violet-200"
              aria-label="Agent insight"
            />
            <p
              className="truncate text-sm font-semibold leading-snug text-foreground"
              title={h.summary}
            >
              {h.summary}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}
