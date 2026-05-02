"use client";

import { SearchIcon, XIcon } from "lucide-react";
import { useState } from "react";

import { ApiError, searchProject } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { HighlightsPanel } from "../highlights/HighlightsPanel";

/**
 * Unified right-side panel:
 * - Search bar pinned at the top
 * - Shared content area below
 * - Default mode = highlights
 * - After submit = search-results mode occupying the same area
 *
 * This matches the requested UX of "search above highlights and replace
 * the highlights area when searching".
 */
type Props = {
  projectId: string;
};

export function RightPanel({ projectId }: Props) {
  const [queryDraft, setQueryDraft] = useState("");
  const [activeQuery, setActiveQuery] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [result, setResult] = useState<{
    answer: string;
    searchPlan: string;
    selectedSessionIds: string[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const trimmed = queryDraft.trim();
    if (!trimmed) return;
    setActiveQuery(trimmed);
    setSearching(true);
    setError(null);
    try {
      const response = await searchProject({ projectId, query: trimmed });
      setResult(response);
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : "Search failed. Try again.";
      setError(message);
      setResult(null);
    } finally {
      setSearching(false);
    }
  };

  const clearSearch = () => {
    setActiveQuery(null);
    setResult(null);
    setError(null);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-border p-3">
        <div className="flex items-center gap-2">
          <Input
            placeholder="Search across the project..."
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
            {searching ? "Searching..." : "Search"}
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {activeQuery ? (
          <div className="p-4">
            <Card>
              <CardHeader className="border-b">
                <CardTitle className="flex items-center justify-between gap-2">
                  <span>Search results</span>
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
                  Query: <code className="font-mono">{activeQuery}</code>
                </p>
                {error ? (
                  <p className="text-sm text-destructive">{error}</p>
                ) : null}
                {result ? (
                  <>
                    <p className="text-sm whitespace-pre-wrap">{result.answer}</p>
                    <p className="text-xs text-muted-foreground">
                      Sessions used:{" "}
                      {result.selectedSessionIds.length > 0
                        ? result.selectedSessionIds.map((id) => `[[${id}]]`).join(", ")
                        : "none"}
                    </p>
                  </>
                ) : searching ? (
                  <p className="text-sm text-muted-foreground">Thinking...</p>
                ) : null}
              </CardContent>
            </Card>
          </div>
        ) : (
          <HighlightsPanel />
        )}
      </div>
    </div>
  );
}
