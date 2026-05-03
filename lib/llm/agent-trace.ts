/**
 * Agent timeline reducer + persisted-trace shape.
 *
 * This module is pure data: no React imports, no `"use client"`. The
 * client wraps the reducer in a hook (`useAgentTimeline`) for live
 * streaming; the server uses the same reducer to fold the events it
 * just emitted into a snapshot before storing it on `messages.agent_trace`.
 *
 * Persisting the snapshot lets a refreshed page show "▾ Show reasoning"
 * under every saved assistant message — the trace is no longer
 * ephemeral.
 */

import {
  AGENT_PHASE_LABELS,
  type AgentEvent,
  type AgentPhaseId,
} from "@/lib/llm/agent-events";

export type AgentToolStep = {
  name: string;
  label: string;
  args?: string;
  log?: string;
  status: "pending" | "done" | "error";
  sessionIds?: string[];
};

export type AgentPhaseState = {
  id: AgentPhaseId;
  label: string;
  status: "pending" | "active" | "done";
  text: string;
  /** Only meaningful for the `evidence` phase. */
  toolSteps: AgentToolStep[];
  /** Order in which the phase first showed up. */
  order: number;
};

export type AgentTimelineState = {
  phases: AgentPhaseState[];
  byId: Partial<Record<AgentPhaseId, AgentPhaseState>>;
  finalAssistantMessageId: string | null;
  errorMessage: string | null;
  /** True until we receive `done`. */
  running: boolean;
};

/** Compact, JSON-serializable form stored on `messages.agent_trace`. */
export type PersistedAgentTrace = {
  /** Bumped if we change the on-disk shape. */
  version: 1;
  phases: AgentPhaseState[];
  errorMessage: string | null;
  finishedAt: string;
};

export const EMPTY_TIMELINE: AgentTimelineState = {
  phases: [],
  byId: {},
  finalAssistantMessageId: null,
  errorMessage: null,
  running: false,
};

export type TimelineAction =
  | { kind: "reset" }
  | { kind: "start" }
  | { kind: "event"; event: AgentEvent };

function nextPhase(
  state: AgentTimelineState,
  id: AgentPhaseId,
  label?: string
): AgentTimelineState {
  const existing = state.byId[id];
  if (existing) {
    if (existing.status === "active") return state;
    return upsertPhase(state, { ...existing, status: "active" });
  }
  const phase: AgentPhaseState = {
    id,
    label: label ?? AGENT_PHASE_LABELS[id],
    status: "active",
    text: "",
    toolSteps: [],
    order: state.phases.length,
  };
  // Mark previously-active phases as done.
  const prev = state.phases.map((p) =>
    p.status === "active" ? { ...p, status: "done" as const } : p
  );
  return reindex({ ...state, phases: [...prev, phase] });
}

function upsertPhase(
  state: AgentTimelineState,
  phase: AgentPhaseState
): AgentTimelineState {
  const phases = state.phases.map((p) => (p.id === phase.id ? phase : p));
  return reindex({ ...state, phases });
}

function reindex(state: AgentTimelineState): AgentTimelineState {
  const byId: AgentTimelineState["byId"] = {};
  for (const p of state.phases) byId[p.id] = p;
  return { ...state, byId };
}

export function timelineReducer(
  state: AgentTimelineState,
  action: TimelineAction
): AgentTimelineState {
  switch (action.kind) {
    case "reset":
      return { ...EMPTY_TIMELINE };
    case "start":
      return { ...EMPTY_TIMELINE, running: true };
    case "event": {
      const event = action.event;
      switch (event.type) {
        case "phase":
          return {
            ...nextPhase(state, event.phase, event.label),
            running: true,
          };
        case "phase_status": {
          const existing = state.byId[event.phase];
          if (!existing) return state;
          if (existing.status === "done") return state;
          return upsertPhase(state, { ...existing, status: "done" });
        }
        case "delta": {
          const existing = state.byId[event.phase];
          const phase: AgentPhaseState = existing
            ? { ...existing, text: existing.text + event.text }
            : {
                id: event.phase,
                label: AGENT_PHASE_LABELS[event.phase],
                status: "active",
                text: event.text,
                toolSteps: [],
                order: state.phases.length,
              };
          if (!existing) {
            return reindex({ ...state, phases: [...state.phases, phase] });
          }
          return upsertPhase(state, phase);
        }
        case "tool_call": {
          let phase = state.byId.evidence;
          let working = state;
          if (!phase) {
            working = nextPhase(state, "evidence");
            phase = working.byId.evidence!;
          }
          const toolSteps: AgentToolStep[] = [
            ...phase.toolSteps,
            {
              name: event.name,
              label: event.label,
              args: event.args,
              status: "pending",
            },
          ];
          return upsertPhase(working, { ...phase, toolSteps });
        }
        case "tool_result": {
          const phase = state.byId.evidence;
          if (!phase) return state;
          const idx = (() => {
            for (let i = phase.toolSteps.length - 1; i >= 0; i--) {
              if (
                phase.toolSteps[i].name === event.name &&
                phase.toolSteps[i].status === "pending"
              ) {
                return i;
              }
            }
            return -1;
          })();
          if (idx < 0) return state;
          const errored = event.log.toLowerCase().startsWith("error:");
          const next = phase.toolSteps.slice();
          next[idx] = {
            ...next[idx],
            log: event.log,
            status: errored ? "error" : "done",
            sessionIds: event.sessionIds,
          };
          return upsertPhase(state, { ...phase, toolSteps: next });
        }
        case "error":
          return { ...state, errorMessage: event.message };
        case "done":
          return {
            ...state,
            running: false,
            finalAssistantMessageId: event.assistantMessageId,
            phases: state.phases.map((p) =>
              p.status === "active" ? { ...p, status: "done" as const } : p
            ),
          };
        default:
          return state;
      }
    }
    default:
      return state;
  }
}

/** Quick read for "is anything visible to render?". */
export function timelineHasContent(state: AgentTimelineState): boolean {
  return (
    state.phases.length > 0 || state.errorMessage !== null || state.running
  );
}

/** Replay an event log through the reducer (used by the server to persist). */
export function buildTimelineFromEvents(
  events: AgentEvent[]
): AgentTimelineState {
  let state: AgentTimelineState = { ...EMPTY_TIMELINE, running: true };
  for (const event of events) {
    state = timelineReducer(state, { kind: "event", event });
  }
  return state;
}

/** Convert a (live or rebuilt) timeline state into the on-disk shape. */
export function serializeTimeline(
  state: AgentTimelineState
): PersistedAgentTrace {
  return {
    version: 1,
    phases: state.phases.map((p) => ({ ...p, status: "done" as const })),
    errorMessage: state.errorMessage,
    finishedAt: new Date().toISOString(),
  };
}

/** Materialize a state object suitable for `<AgenticTimeline state={...} />`. */
export function timelineFromTrace(
  trace: PersistedAgentTrace
): AgentTimelineState {
  const phases: AgentPhaseState[] = trace.phases.map((p) => ({
    ...p,
    status: "done" as const,
  }));
  const byId: AgentTimelineState["byId"] = {};
  for (const p of phases) byId[p.id] = p;
  return {
    phases,
    byId,
    finalAssistantMessageId: null,
    errorMessage: trace.errorMessage,
    running: false,
  };
}

/**
 * Loose runtime guard for trace blobs read out of `jsonb`. We can't fully
 * trust DB content (older rows might be empty / missing fields), so we
 * fall back to `null` when the shape is unrecognizable.
 */
export function safeParseTrace(value: unknown): PersistedAgentTrace | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Partial<PersistedAgentTrace>;
  if (v.version !== 1 || !Array.isArray(v.phases)) return null;
  const phases = v.phases.filter(
    (p): p is AgentPhaseState =>
      !!p &&
      typeof p === "object" &&
      typeof (p as AgentPhaseState).id === "string" &&
      typeof (p as AgentPhaseState).text === "string" &&
      Array.isArray((p as AgentPhaseState).toolSteps)
  );
  if (phases.length === 0) return null;
  return {
    version: 1,
    phases,
    errorMessage: typeof v.errorMessage === "string" ? v.errorMessage : null,
    finishedAt: typeof v.finishedAt === "string" ? v.finishedAt : "",
  };
}
