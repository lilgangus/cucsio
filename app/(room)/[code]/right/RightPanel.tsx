"use client";

import { SearchIcon, XIcon } from "lucide-react";
import { useCallback, useRef, useState } from "react";

import { AgenticTimeline } from "@/components/chat/AgenticTimeline";
import { ApiError, searchProject } from "@/lib/api";
import { useAgentTimeline } from "@/lib/llm/agent-timeline-state";
import { useSessionFocus } from "@/lib/realtime/session-focus-context";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { HighlightsPanel } from "../highlights/HighlightsPanel";

/**
 * Unified right-side panel:
 * - Search bar pinned at the top.
 * - Search runs the same multi-agent pipeline as chat ("clinical team":
 *   Differential brainstorming → Evidence retrieval → Attending
 *   synthesis) and renders progress in `<AgenticTimeline />`.
 * - Default mode = highlights; once a search is active the highlights
 *   are replaced by the agent timeline + final synthesis.
 */
type Props = {
  projectId: string;
};

export function RightPanel({ projectId }: Props) {
  const [queryDraft, setQueryDraft] = useState("");
  const [activeQuery, setActiveQuery] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const {
    state: agentState,
    apply: applyAgentEvent,
    reset: resetAgentTimeline,
    start: startAgentTimeline,
  } = useAgentTimeline();
  const { openSessionChat } = useSessionFocus();
  const abortRef = useRef<AbortController | null>(null);

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
  ]);

  const clearSearch = () => {
    abortRef.current?.abort();
    setActiveQuery(null);
    setError(null);
    resetAgentTimeline();
  };

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

      <div className="min-h-0 flex-1 overflow-y-auto">
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
    </div>
  );
}
