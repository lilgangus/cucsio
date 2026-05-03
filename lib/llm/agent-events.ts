/**
 * Wire format for the visible agent timeline shared by chat + search.
 *
 * We stream NDJSON (one JSON object per line) over a regular `text/plain`
 * response — no SSE framing, no `data: ` prefixes. The client splits on
 * newlines and feeds each chunk into `parseAgentEvent`. This keeps the
 * server fetch path identical to the previous plain-text streaming and
 * works through any proxy that doesn't understand SSE.
 *
 * Protocol — every event has a discriminating `type`:
 *   - `phase`          marks the start of a visual section (Differential
 *                      brainstorming, Evidence retrieval, Attending
 *                      synthesis). UI renders a header with status.
 *   - `phase_status`   marks a phase as `done` (collapse it / stop the
 *                      pulse animation). No body change.
 *   - `delta`          appends streamed text to the named phase's body.
 *   - `tool_call`      visible "tool" log line in evidence phase. Real
 *                      DB call underneath, fake-named so the trace reads
 *                      like a clinical workup (`fetch_session_digests`,
 *                      `read_recent_messages`, `pull_pinned_highlights`).
 *   - `tool_result`    one-line result the user sees ("Read session
 *                      [[abc]]: last 15 messages"). Pairs with a tool_call.
 *   - `error`          fatal error during the run; UI surfaces a toast.
 *   - `done`           pipeline finished. Carries the persisted assistant
 *                      message id (chat) or null (search).
 */

import type { Uuid } from "@/types/db";

export type AgentPhaseId = "differential" | "evidence" | "synthesis";

export const AGENT_PHASE_LABELS: Record<AgentPhaseId, string> = {
  differential: "Differential brainstorming",
  evidence: "Evidence retrieval",
  synthesis: "Attending-style synthesis",
};

export type AgentEvent =
  | {
      type: "phase";
      phase: AgentPhaseId;
      label: string;
    }
  | {
      type: "phase_status";
      phase: AgentPhaseId;
      status: "done";
    }
  | {
      type: "delta";
      phase: AgentPhaseId;
      text: string;
    }
  | {
      type: "tool_call";
      /** Programmatic name surfaced in the trace, e.g. `fetch_session_digests`. */
      name: string;
      /** Human label rendered next to the tool icon. */
      label: string;
      /** Optional one-line argument summary. */
      args?: string;
    }
  | {
      type: "tool_result";
      name: string;
      log: string;
      /** When set, UI may render `[[id]]` chips for these sessions. */
      sessionIds?: string[];
    }
  | {
      type: "error";
      message: string;
    }
  | {
      type: "done";
      assistantMessageId: Uuid | null;
    };

export function encodeAgentEvent(event: AgentEvent): string {
  return `${JSON.stringify(event)}\n`;
}

/**
 * Splits a streamed buffer into complete NDJSON lines + a leftover tail.
 * The caller threads the tail back in on the next `read()`.
 */
export function takeCompleteLines(buffer: string): {
  events: AgentEvent[];
  rest: string;
} {
  const events: AgentEvent[] = [];
  let rest = buffer;
  let nl = rest.indexOf("\n");
  while (nl !== -1) {
    const line = rest.slice(0, nl).trim();
    rest = rest.slice(nl + 1);
    if (line.length > 0) {
      const event = safeParse(line);
      if (event) events.push(event);
    }
    nl = rest.indexOf("\n");
  }
  return { events, rest };
}

function safeParse(line: string): AgentEvent | null {
  try {
    const parsed = JSON.parse(line) as Partial<AgentEvent> & {
      type?: string;
    };
    if (!parsed || typeof parsed !== "object" || !parsed.type) return null;
    return parsed as AgentEvent;
  } catch {
    return null;
  }
}
