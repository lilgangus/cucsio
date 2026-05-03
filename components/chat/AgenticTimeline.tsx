"use client";

import {
  ActivityIcon,
  AlertTriangleIcon,
  BrainCircuitIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  DatabaseIcon,
  Loader2Icon,
  SparklesIcon,
  TerminalIcon,
} from "lucide-react";
import {
  useMemo,
  useState,
  type ComponentType,
  type SVGProps,
} from "react";

import { MarkdownContent } from "@/components/chat/MarkdownContent";
import type { AgentPhaseId } from "@/lib/llm/agent-events";
import {
  timelineHasContent,
  type AgentPhaseState,
  type AgentTimelineState,
  type AgentToolStep,
} from "@/lib/llm/agent-timeline-state";
import { cn } from "@/lib/utils";

/**
 * Agentic timeline rendered while the model is running and (when
 * `compact`) collapsed into a "▾ Reasoning trace" disclosure once the
 * synthesis finishes. Used inline in the chat overlay (in place of the
 * old streaming bubble) and in the search results card.
 */

type Props = {
  state: AgentTimelineState;
  /** When true, hide the synthesis body — the parent renders the final answer separately. */
  hideSynthesisBody?: boolean;
  /** Optional click handler for `[[<id>]]` chips inside the synthesis text. */
  onOpenSession?: (sessionId: string) => void;
  className?: string;
};

const PHASE_ORDER: AgentPhaseId[] = [
  "differential",
  "evidence",
  "synthesis",
];

const PHASE_ICON: Record<
  AgentPhaseId,
  ComponentType<SVGProps<SVGSVGElement>>
> = {
  differential: ActivityIcon,
  evidence: DatabaseIcon,
  synthesis: SparklesIcon,
};

const PHASE_TINT: Record<AgentPhaseId, string> = {
  differential:
    "from-sky-500/12 via-sky-500/6 to-transparent border-sky-500/40 text-sky-700 dark:text-sky-200",
  evidence:
    "from-emerald-500/12 via-emerald-500/6 to-transparent border-emerald-500/40 text-emerald-700 dark:text-emerald-200",
  synthesis:
    "from-violet-500/12 via-violet-500/6 to-transparent border-violet-500/40 text-violet-700 dark:text-violet-200",
};

const PHASE_DOT: Record<AgentPhaseId, string> = {
  differential: "bg-sky-500",
  evidence: "bg-emerald-500",
  synthesis: "bg-violet-500",
};

const PHASE_BLURB: Record<AgentPhaseId, string> = {
  differential: "Interpreting the target prompt and choosing what to inspect.",
  evidence: "Pulling sibling sessions, transcripts, and pinned highlights.",
  synthesis: "Composing the answer with cited evidence.",
};

export function AgenticTimeline({
  state,
  hideSynthesisBody = false,
  onOpenSession,
  className,
}: Props) {
  // Render in protocol order even if the server sent something unexpected.
  const orderedPhases = useMemo(() => {
    const seen = new Set<AgentPhaseId>();
    const ordered: AgentPhaseState[] = [];
    for (const id of PHASE_ORDER) {
      const p = state.byId[id];
      if (p) {
        ordered.push(p);
        seen.add(id);
      }
    }
    for (const p of state.phases) {
      if (!seen.has(p.id)) ordered.push(p);
    }
    return ordered;
  }, [state.byId, state.phases]);

  if (!timelineHasContent(state)) return null;

  return (
    <div
      className={cn(
        "w-full rounded-2xl border border-border/80 bg-card/85 shadow-sm",
        "ring-1 ring-inset ring-border/40 backdrop-blur-sm",
        className
      )}
      role="status"
      aria-live="polite"
    >
      <header className="flex items-center gap-2 border-b border-border/60 px-3 py-2">
        <span
          className={cn(
            "inline-flex size-6 items-center justify-center rounded-full",
            "bg-gradient-to-br from-violet-500/20 via-sky-500/15 to-emerald-500/15",
            "text-foreground"
          )}
        >
          <BrainCircuitIcon className="size-3.5" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="text-xs font-medium tracking-wide text-foreground">
            Agentic reasoning
          </p>
          <p className="text-[11px] text-muted-foreground">
            Intent planning / Tool evidence / Grounded synthesis
          </p>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          {state.running ? (
            <>
              <span className="size-1.5 animate-pulse rounded-full bg-emerald-500" />
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Running
              </span>
            </>
          ) : state.errorMessage ? (
            <>
              <AlertTriangleIcon className="size-3.5 text-destructive" />
              <span className="text-[10px] uppercase tracking-wider text-destructive">
                Failed
              </span>
            </>
          ) : (
            <>
              <CheckCircle2Icon className="size-3.5 text-emerald-500" />
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Done
              </span>
            </>
          )}
        </div>
      </header>

      <ol className="flex flex-col gap-px">
        {orderedPhases.map((phase, idx) => (
          <PhaseRow
            key={phase.id}
            phase={phase}
            isLast={idx === orderedPhases.length - 1}
            hideBody={phase.id === "synthesis" && hideSynthesisBody}
            onOpenSession={onOpenSession}
          />
        ))}
      </ol>

      {state.errorMessage ? (
        <div className="border-t border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {state.errorMessage}
        </div>
      ) : null}
    </div>
  );
}

function PhaseRow({
  phase,
  isLast,
  hideBody,
  onOpenSession,
}: {
  phase: AgentPhaseState;
  isLast: boolean;
  hideBody: boolean;
  onOpenSession?: (id: string) => void;
}) {
  const Icon = PHASE_ICON[phase.id];
  const isActive = phase.status === "active";
  const isDone = phase.status === "done";

  // The earlier scratchpad/evidence phases auto-collapse once they're
  // "done", but the user can override that by toggling. We track only
  // the override and derive the final open value.
  const [override, setOverride] = useState<boolean | null>(null);
  const autoOpen =
    phase.id === "synthesis" || isActive || !isDone;
  const open = override ?? autoOpen;

  const showBody =
    !hideBody &&
    open &&
    (phase.text.trim().length > 0 ||
      phase.toolSteps.length > 0 ||
      /** Keep the synthesis section from looking empty once the phase ends. */
      (phase.id === "synthesis" && isDone));

  return (
    <li
      className={cn(
        "relative flex flex-col gap-2 px-3 py-2.5",
        !isLast && "border-b border-border/50",
        "bg-gradient-to-r",
        PHASE_TINT[phase.id]
      )}
    >
      <button
        type="button"
        onClick={() => setOverride(!open)}
        className={cn(
          "flex w-full items-center gap-2 text-left",
          "outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-md"
        )}
        aria-expanded={open}
      >
        <span
          className={cn(
            "inline-flex size-6 shrink-0 items-center justify-center rounded-full",
            isActive
              ? cn(PHASE_DOT[phase.id], "text-white shadow")
              : isDone
                ? "bg-foreground/10 text-foreground"
                : "bg-foreground/5 text-muted-foreground"
          )}
        >
          {isActive ? (
            <Loader2Icon className="size-3.5 animate-spin" aria-hidden />
          ) : (
            <Icon className="size-3.5" aria-hidden />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p
            className={cn(
              "text-xs font-semibold tracking-tight",
              isActive ? "" : "text-foreground"
            )}
          >
            {phase.label}
          </p>
          <p className="text-[11px] text-muted-foreground">
            {PHASE_BLURB[phase.id] ?? ""}
          </p>
        </div>
        <ChevronDownIcon
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground transition-transform",
            !open && "-rotate-90"
          )}
          aria-hidden
        />
      </button>

      {showBody ? (
        <div className="flex flex-col gap-2 pl-8">
          {phase.id === "evidence" ? (
            <ToolTrace
              steps={phase.toolSteps}
              onOpenSession={onOpenSession}
            />
          ) : null}
          {phase.text.trim().length > 0 ? (
            phase.id === "differential" ? (
              <ScratchpadText text={phase.text} />
            ) : (
              <SynthesisText text={phase.text} onOpenSession={onOpenSession} />
            )
          ) : phase.id === "synthesis" && isDone ? (
            <p className="rounded-md bg-background/70 px-2 py-1.5 text-[11px] italic text-muted-foreground">
              Final reply is shown in the assistant message bubble above this
              timeline.
            </p>
          ) : null}
          {phase.id !== "evidence" && isActive && phase.text.length === 0 ? (
            <PulseDots />
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

function ToolTrace({
  steps,
  onOpenSession,
}: {
  steps: AgentToolStep[];
  onOpenSession?: (id: string) => void;
}) {
  if (steps.length === 0) {
    return (
      <p className="text-[11px] text-muted-foreground italic">
        Awaiting first tool call...
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-1.5">
      {steps.map((step, idx) => {
        const isPending = step.status === "pending";
        const isError = step.status === "error";
        return (
          <li
            key={`${step.name}-${idx}`}
            className={cn(
              "flex items-start gap-2 rounded-md border px-2 py-1.5 text-[11px]",
              "border-border/60 bg-background/70 font-mono",
              isError && "border-destructive/40 bg-destructive/10"
            )}
          >
            <span
              className={cn(
                "mt-0.5 inline-flex size-3.5 shrink-0 items-center justify-center"
              )}
            >
              {isPending ? (
                <Loader2Icon className="size-3 animate-spin text-emerald-500" />
              ) : isError ? (
                <AlertTriangleIcon className="size-3 text-destructive" />
              ) : (
                <TerminalIcon className="size-3 text-emerald-600 dark:text-emerald-400" />
              )}
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
                <span className="font-semibold text-foreground">
                  {step.name}
                </span>
                {step.args ? (
                  <span className="truncate text-muted-foreground">
                    ({step.args})
                  </span>
                ) : (
                  <span className="text-muted-foreground">()</span>
                )}
              </span>
              {step.log ? (
                <CitationLine
                  text={`-> ${step.log}`}
                  onOpenSession={onOpenSession}
                  className={cn(
                    isError ? "text-destructive" : "text-muted-foreground"
                  )}
                />
              ) : (
                <span className="text-muted-foreground/80 italic">
                  {"-> working..."}
                </span>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function PulseDots() {
  return (
    <span
      className="inline-flex items-center gap-1 py-0.5"
      aria-label="Working"
    >
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="size-1.5 animate-bounce rounded-full bg-muted-foreground/55"
          style={{ animationDelay: `${i * 120}ms` }}
        />
      ))}
    </span>
  );
}

/**
 * Scratchpad text uses a quieter typographic treatment than the final
 * answer: italic, slightly muted, to read as ephemeral thinking.
 */
function ScratchpadText({ text }: { text: string }) {
  return (
    <div className="rounded-md bg-background/60 px-2 py-1.5 text-[12px] leading-relaxed text-foreground/90">
      <MarkdownContent
        content={text}
        className="text-[12px] [&_p]:mb-1 [&_ul]:my-1 [&_ol]:my-1"
      />
    </div>
  );
}

function SynthesisText({
  text,
  onOpenSession,
}: {
  text: string;
  onOpenSession?: (id: string) => void;
}) {
  const annotated = useMemo(
    () => annotateCitationsInMarkdown(text, onOpenSession ? "[[$1]]" : "[[$1]]"),
    [text, onOpenSession]
  );

  /**
   * Visually distinct from the chat bubble: narrower inset panel, violet
   * accent, and smaller muted type so it reads as the live synthesis stream.
   */
  return (
    <div
      className={cn(
        "rounded-r-lg border-y border-r border-violet-300/55 bg-violet-500/[0.06]",
        "py-2 pr-2 pl-3 shadow-[inset_4px_0_0_0] shadow-violet-500/55",
        "dark:border-violet-700/50 dark:bg-violet-950/35 dark:shadow-violet-400/45"
      )}
    >
      <p className="mb-1 font-mono text-[10px] font-semibold uppercase tracking-wide text-violet-800 dark:text-violet-200">
        Grounded synthesis
      </p>
      <p className="mb-2 border-b border-violet-400/25 pb-2 text-[11px] leading-snug text-muted-foreground dark:border-violet-600/25">
        Live synthesis stream from this run. Citations are preserved.
      </p>
      <MarkdownContent
        content={annotated}
        className={cn(
          "text-[12px] leading-snug text-muted-foreground",
          "[&_strong]:font-semibold [&_strong]:text-foreground/90",
          "[&_p]:mb-2 [&_ul]:my-1.5 [&_ol]:my-1.5",
          "[&_code]:rounded [&_code]:bg-background/80 [&_code]:px-1",
          "[&_.markdown-chat]:text-[12px]"
        )}
      />
    </div>
  );
}

/**
 * Renders a single tool-result line, turning `[[<uuid>]]` references into
 * clickable chips when an `onOpenSession` handler is provided.
 */
function CitationLine({
  text,
  onOpenSession,
  className,
}: {
  text: string;
  onOpenSession?: (id: string) => void;
  className?: string;
}) {
  const parts = useMemo(() => splitOnCitations(text), [text]);
  return (
    <span className={cn("break-words", className)}>
      {parts.map((p, i) =>
        p.kind === "text" ? (
          <span key={i}>{p.value}</span>
        ) : onOpenSession ? (
          <button
            key={i}
            type="button"
            onClick={() => onOpenSession(p.value)}
            className="mx-0.5 rounded bg-violet-500/15 px-1 font-mono text-[10px] text-violet-700 hover:bg-violet-500/25 dark:text-violet-300"
            title="Open this session"
          >
            [[{p.value.slice(0, 8)}]]
          </button>
        ) : (
          <span
            key={i}
            className="mx-0.5 rounded bg-muted px-1 font-mono text-[10px] text-muted-foreground"
          >
            [[{p.value.slice(0, 8)}]]
          </span>
        )
      )}
    </span>
  );
}

const CITATION_RE = /\[\[([0-9a-f-]{8,36})\]\]/gi;

function splitOnCitations(
  text: string
): Array<{ kind: "text"; value: string } | { kind: "cite"; value: string }> {
  const out: Array<
    { kind: "text"; value: string } | { kind: "cite"; value: string }
  > = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  CITATION_RE.lastIndex = 0;
  while ((match = CITATION_RE.exec(text)) !== null) {
    if (match.index > lastIndex) {
      out.push({ kind: "text", value: text.slice(lastIndex, match.index) });
    }
    out.push({ kind: "cite", value: match[1] });
    lastIndex = CITATION_RE.lastIndex;
  }
  if (lastIndex < text.length) {
    out.push({ kind: "text", value: text.slice(lastIndex) });
  }
  return out;
}

function annotateCitationsInMarkdown(
  markdown: string,
  template: string
): string {
  // No-op for now: we keep `[[<id>]]` literal in markdown so the synthesis
  // bubble can render them too. Reserved for future enrichment.
  return markdown.replace(CITATION_RE, template);
}
