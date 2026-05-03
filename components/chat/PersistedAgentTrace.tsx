"use client";

import { BrainCircuitIcon, ChevronDownIcon } from "lucide-react";
import { useMemo, useState, type SyntheticEvent } from "react";

import { AgenticTimeline } from "@/components/chat/AgenticTimeline";
import { AGENT_PHASE_LABELS } from "@/lib/llm/agent-events";
import {
  safeParseTrace,
  timelineFromTrace,
  type AgentPhaseState,
} from "@/lib/llm/agent-timeline-state";
import { cn } from "@/lib/utils";

type Props = {
  /** Raw value out of `messages.agent_trace` (jsonb). */
  trace: unknown;
  /**
   * Saved assistant body (`messages.content`). Used only when the trace row
   * has no synthesis text so the grounded synthesis phase still shows the reply.
   */
  assistantReply?: string;
  /** Forward to `<AgenticTimeline />` so [[<id>]] chips stay clickable. */
  onOpenSession?: (sessionId: string) => void;
  className?: string;
  /**
   * When true (default), the trace is expanded so agentic steps stay
   * visible after the turn finishes; users can collapse via the summary.
   */
  defaultOpen?: boolean;
};

/**
 * Renders the saved agent trace under an assistant bubble.
 * **Expanded by default** so differential / evidence / synthesis steps do
 * not look like they vanished after streaming ends — tap the header to
 * collapse for a denser transcript.
 *
 * No-op when `trace` is missing / malformed — old assistant rows simply
 * render without this block.
 */
export function PersistedAgentTrace({
  trace,
  assistantReply,
  onOpenSession,
  className,
  defaultOpen = true,
}: Props) {
  const parsed = useMemo(() => safeParseTrace(trace), [trace]);
  const baseState = useMemo(
    () => (parsed ? timelineFromTrace(parsed) : null),
    [parsed]
  );

  const state = useMemo(() => {
    if (!baseState) return null;
    const reply = assistantReply?.trim() ?? "";
    let next = baseState;

    const synExisting = next.byId.synthesis;
    if (reply && synExisting && !synExisting.text.trim()) {
      const filled = { ...synExisting, text: reply };
      next = {
        ...next,
        phases: next.phases.map((p) =>
          p.id === "synthesis" ? filled : p
        ),
        byId: { ...next.byId, synthesis: filled },
      };
    }

    if (reply && !next.byId.synthesis) {
      const synthetic: AgentPhaseState = {
        id: "synthesis",
        label: AGENT_PHASE_LABELS.synthesis,
        status: "done",
        text: reply,
        toolSteps: [],
        order: next.phases.length,
      };
      next = {
        ...next,
        phases: [...next.phases, synthetic],
        byId: { ...next.byId, synthesis: synthetic },
      };
    }

    return next;
  }, [baseState, assistantReply]);

  /** Expanded by default so steps stay visible after the turn completes. */
  const [traceOpen, setTraceOpen] = useState(defaultOpen);

  const onDetailsToggle = (e: SyntheticEvent<HTMLDetailsElement>) => {
    setTraceOpen(e.currentTarget.open);
  };

  if (!parsed || !state) return null;

  const phaseCount = state.phases.length;
  const evidencePhase = state.phases.find((p) => p.id === "evidence");
  const toolCount = evidencePhase?.toolSteps.length ?? 0;

  return (
    <details
      open={traceOpen}
      onToggle={onDetailsToggle}
      className={cn(
        "group mt-1 max-w-[80%] rounded-xl border border-border/60 bg-card/60 text-foreground",
        "open:bg-card/85 open:shadow-sm",
        className
      )}
    >
      <summary
        className={cn(
          "flex cursor-pointer list-none items-center gap-2 rounded-xl px-3 py-1.5 text-[11px]",
          "marker:content-none [&::-webkit-details-marker]:hidden",
          "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
          "outline-none focus-visible:ring-2 focus-visible:ring-ring"
        )}
      >
        <BrainCircuitIcon className="size-3.5 shrink-0 opacity-80" aria-hidden />
        <span className="flex-1 text-left">
          Reasoning trace
          <span className="ml-1.5 font-mono text-[10px] opacity-70">
            ({phaseCount} phase{phaseCount === 1 ? "" : "s"}
            {toolCount > 0
              ? ` / ${toolCount} tool call${toolCount === 1 ? "" : "s"}`
              : ""}
            )
          </span>
          <span className="mt-0.5 block text-[10px] font-normal opacity-70">
            Tap header to expand or collapse
          </span>
        </span>
        <ChevronDownIcon
          className="size-3.5 shrink-0 transition-transform group-open:rotate-180"
          aria-hidden
        />
      </summary>
      <div className="border-t border-border/50 p-2">
        <AgenticTimeline state={state} onOpenSession={onOpenSession} />
      </div>
    </details>
  );
}
