"use client";

import { SearchIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

/**
 * Placeholder for the stateless cross-session search.
 *
 * Owner: search feature PR. Replace with:
 *   - POST /api/search { projectId, query }
 *   - render answer; parse [[<sessionId>]] citations and turn them into
 *     links that open the cited session in the room
 * See AGENTS.md "LLM prompt rules" → Search.
 */
export function SearchPanel() {
  const [query, setQuery] = useState("");

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <Textarea
        placeholder="Ask anything across every session in this project..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        rows={3}
        className="resize-none"
      />
      <Button disabled>
        <SearchIcon />
        Search (not implemented)
      </Button>
      <p className="text-xs text-muted-foreground">
        Results will cite sessions like <code className="font-mono">[[id]]</code>.
      </p>
    </div>
  );
}
