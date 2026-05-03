"use client";

import { BrainCircuitIcon, PinIcon, SearchIcon, XIcon } from "lucide-react";
import {
  useCallback,
  useRef,
  useState,
  type PointerEvent,
} from "react";

import { AgenticTimeline } from "@/components/chat/AgenticTimeline";
import { ApiError, searchProject } from "@/lib/api";
import { useAgentActivity } from "@/lib/agent/agent-activity-context";
import { useAgentTimeline } from "@/lib/llm/agent-timeline-state";
import { useSessionFocus } from "@/lib/realtime/session-focus-context";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { AgentHighlightsPanel } from "../agent/AgentHighlightsPanel";
import { HighlightsPanel } from "../highlights/HighlightsPanel";

/**
 * Unified right-side panel:
 * - Search bar pinned at the top.
 * - Search runs the same multi-agent pipeline as chat: intent planning,
 *   tool evidence, then grounded synthesis in `<AgenticTimeline />`.
 *
 * - Below: a stacked board — the team's pinned highlights up top,
 *   followed by a divider and the agent's autonomous findings feed.
 *   When a search is in flight, the agent timeline takes over the
 *   space normally occupied by the user highlights.
 */
type Props = {
  projectId: string;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function RightPanel({ projectId }: Props) {
  const [queryDraft, setQueryDraft] = useState("");
  const [activeQuery, setActiveQuery] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [teamPct, setTeamPct] = useState(56);
  const {
    state: agentState,
    apply: applyAgentEvent,
    reset: resetAgentTimeline,
    start: startAgentTimeline,
  } = useAgentTimeline();
  const { openSessionChat } = useSessionFocus();
  const { trigger: triggerAgent } = useAgentActivity();
  const abortRef = useRef<AbortController | null>(null);
  const panesRef = useRef<HTMLDivElement | null>(null);

  const submit = useCallback(async () => {
    const trimmed = queryDraft.trim();
    if (!trimmed) return;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    setActiveQuery(trimmed);
    setSearching(true);
    setError(null);
    resetAgentTimeline();
    startAgentTimeline();
    triggerAgent({
      reason: `search query: "${trimmed.slice(0, 80)}"`,
      source: "search",
      targetPrompt: trimmed,
      context: `Project-wide search\nTarget prompt: ${trimmed}`,
    });

    try {
      await searchProject(
        { projectId, query: trimmed },
        { onAgentEvent: applyAgentEvent, signal: ac.signal }
      );
    } catch (err) {
      if (
        (err instanceof DOMException && err.name === "AbortError") ||
        (err instanceof Error && err.name === "AbortError")
      ) {
        return;
      }
      const message =
        err instanceof ApiError ? err.message : "Search failed. Try again.";
      setError(message);
    } finally {
      if (abortRef.current === ac) abortRef.current = null;
      setSearching(false);
    }
  }, [
    queryDraft,
    projectId,
    applyAgentEvent,
    resetAgentTimeline,
    startAgentTimeline,
    triggerAgent,
  ]);

  const clearSearch = () => {
    abortRef.current?.abort();
    setActiveQuery(null);
    setError(null);
    resetAgentTimeline();
  };

  const dragFindingsSplit = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const root = panesRef.current;
    if (!root) return;
    event.preventDefault();
    const rect = root.getBoundingClientRect();

    const onMove = (e: globalThis.PointerEvent) => {
      const pct = ((e.clientY - rect.top) / rect.height) * 100;
      setTeamPct(clamp(pct, 30, 78));
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
  }, []);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-border p-3">
        <div className="flex items-center gap-2">
          <Input
            placeholder="Ask anything across this project…"
            value={queryDraft}
            onChange={(e) => setQueryDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void submit();
            }}
            className="h-9"
            disabled={searching}
          />
          <Button
            onClick={() => void submit()}
            disabled={queryDraft.trim().length === 0 || searching}
          >
            <SearchIcon />
            {searching ? "Working…" : "Search"}
          </Button>
        </div>
      </div>

      <div
        ref={panesRef}
        className="flex min-h-0 flex-1 flex-col overflow-hidden"
      >
        {/* Top half: search results when active, otherwise the team's
            pinned highlights board. */}
        <div
          className="relative min-h-[130px] overflow-y-auto"
          style={{ flexBasis: `${teamPct}%` }}
        >
          <div className="flex items-center gap-1.5 border-b border-border/60 bg-muted/30 px-3 py-1.5">
            <PinIcon className="size-3 text-muted-foreground" />
            <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              team highlights
            </span>
          </div>
          {activeQuery ? (
            <div className="p-4">
              <Card>
                <CardHeader className="border-b">
                  <CardTitle className="flex items-center justify-between gap-2">
                    <span>Cross-session investigation</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={clearSearch}
                      className="gap-1.5"
                    >
                      <XIcon />
                      Back to highlights
                    </Button>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 pt-4">
                  <p className="text-xs text-muted-foreground">
                    Question:{" "}
                    <code className="font-mono text-foreground">
                      {activeQuery}
                    </code>
                  </p>

                  {error ? (
                    <p className="text-sm text-destructive">{error}</p>
                  ) : null}

                  <AgenticTimeline
                    state={agentState}
                    onOpenSession={(sid) => openSessionChat(sid)}
                  />
                </CardContent>
              </Card>
            </div>
          ) : (
            <HighlightsPanel projectId={projectId} />
          )}
        </div>

        {/* Hard divider — mirrors the user/agent split on the left. */}
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize agent findings"
          onPointerDown={dragFindingsSplit}
          className="group relative z-20 flex h-4 shrink-0 cursor-row-resize touch-none items-center"
        >
          <div className="h-[2px] w-full bg-gradient-to-r from-violet-500/20 via-violet-500/70 to-fuchsia-500/20" />
          <div className="pointer-events-none absolute left-1/2 -translate-x-1/2 select-none">
            <span className="inline-flex items-center gap-1 rounded-full border border-violet-400/60 bg-card px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.22em] text-violet-700 shadow-sm dark:border-violet-300/40 dark:text-violet-200">
              <BrainCircuitIcon className="size-2.5" />
              agent
            </span>
          </div>
        </div>

        {/* Bottom half: the agent's autonomous highlight feed. */}
        <div
          className="relative min-h-[130px] flex-1 overflow-y-auto"
          style={{ flexBasis: `${100 - teamPct}%` }}
        >
          <div className="flex items-center gap-1.5 border-b border-border/60 bg-violet-500/5 px-3 py-1.5">
            <BrainCircuitIcon className="size-3 text-violet-600 dark:text-violet-300" />
            <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-violet-700 dark:text-violet-200">
              agent findings
            </span>
            <span className="ml-auto text-[10px] text-muted-foreground">
              auto-pinned
            </span>
          </div>
          <AgentHighlightsPanel />
        </div>
      </div>
    </div>
  );
}
