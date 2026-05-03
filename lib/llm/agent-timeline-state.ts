"use client";

import { useCallback, useMemo, useReducer } from "react";

import type { AgentEvent } from "@/lib/llm/agent-events";
import {
  EMPTY_TIMELINE,
  timelineReducer,
  type AgentTimelineState,
} from "@/lib/llm/agent-trace";

// Re-export so existing imports (`@/lib/llm/agent-timeline-state`) keep
// working without callers having to learn about the new pure module.
export {
  EMPTY_TIMELINE,
  timelineHasContent,
  timelineFromTrace,
  serializeTimeline,
  buildTimelineFromEvents,
  safeParseTrace,
  type AgentPhaseState,
  type AgentToolStep,
  type AgentTimelineState,
  type PersistedAgentTrace,
} from "@/lib/llm/agent-trace";

/**
 * Hook that tracks an agent timeline as `AgentEvent`s arrive. The
 * returned `apply` callback can be passed straight into `sendMessage`
 * (or any other endpoint that emits the same NDJSON protocol).
 */
export function useAgentTimeline(): {
  state: AgentTimelineState;
  apply: (event: AgentEvent) => void;
  reset: () => void;
  start: () => void;
} {
  const [state, dispatch] = useReducer(timelineReducer, EMPTY_TIMELINE);

  // `useReducer`'s `dispatch` is stable across renders (React guarantees
  // it), so we can wrap it directly without `useRef` synchronization.
  const apply = useCallback(
    (event: AgentEvent) => {
      dispatch({ kind: "event", event });
    },
    [dispatch]
  );
  const reset = useCallback(() => dispatch({ kind: "reset" }), [dispatch]);
  const start = useCallback(() => dispatch({ kind: "start" }), [dispatch]);

  return useMemo(
    () => ({ state, apply, reset, start }),
    [state, apply, reset, start]
  );
}
