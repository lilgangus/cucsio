"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import type {
  VisualAgentPlan,
  VisualAgentPlanResponse,
} from "@/lib/agent/visual-plan";

/**
 * Local visual agent state for the right-side agent tree. It is intentionally
 * synthetic, but it is driven by real user intent: the latest chat message,
 * search query, edited session target, and nearby branch goals.
 */

export type AgentNodeStatus =
  | "considering"
  | "evaluating"
  | "confirmed"
  | "dismissed";

export type AgentNode = {
  id: string;
  parentId: string | null;
  col: number;
  depth: number;
  label: string;
  detail?: string;
  status: AgentNodeStatus;
  visiting: boolean;
};

export type AgentHighlight = {
  id: string;
  label: string;
  reason: string;
  sourceNodeId: string | null;
  createdAt: number;
};

export type AgentPhase =
  | "idle"
  | "spinning_up"
  | "traversing"
  | "highlighting"
  | "settling";

export type AgentTriggerSource = "chat" | "search" | "tree" | "prompt";

export type AgentTrigger = {
  reason: string;
  targetPrompt?: string;
  context?: string;
  source?: AgentTriggerSource;
};

type AgentActivityValue = {
  phase: AgentPhase;
  nodes: AgentNode[];
  highlights: AgentHighlight[];
  cursorNodeId: string | null;
  statusText: string;
  cycleCount: number;
  trigger: (t: AgentTrigger) => void;
  pinHighlight: (h: Omit<AgentHighlight, "id" | "createdAt">) => void;
  unpinHighlight: (id: string) => void;
};

const AgentActivityContext = createContext<AgentActivityValue | undefined>(
  undefined
);

const TOOL_STEPS = [
  {
    label: "Tool: fetch_session_digests",
    detail: "Survey session targets, summaries, and recent activity.",
  },
  {
    label: "Tool: read_recent_messages",
    detail: "Open the most relevant branches for fresh evidence.",
  },
  {
    label: "Tool: pull_pinned_highlights",
    detail: "Check what the team already marked as important.",
  },
];

const REASONING_STEPS = [
  {
    label: "Clarify success criteria",
    detail: "Turn the prompt into a concrete answer target.",
  },
  {
    label: "Compare sibling goals",
    detail: "Look for nearby branches that may answer the same need.",
  },
  {
    label: "Separate facts from guesses",
    detail: "Flag any assumption that needs evidence before synthesis.",
  },
  {
    label: "Choose next action",
    detail: "Decide whether to answer, ask, fork, or fetch more context.",
  },
  {
    label: "Prepare cited synthesis",
    detail: "Shape the final response around session-backed evidence.",
  },
];

const STEP_MS = 700;
const SPINUP_MS = 500;
const SETTLE_MS = 600;

type Action =
  | { kind: "spinup"; trigger: AgentTrigger }
  | { kind: "advance" }
  | { kind: "highlight" }
  | { kind: "settle" };

function uid(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}-${Date.now().toString(36)}`;
}

function clean(value: string | undefined | null): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function shorten(value: string, max: number): string {
  const t = clean(value);
  if (t.length <= max) return t;
  return `${t.slice(0, Math.max(0, max - 3)).trim()}...`;
}

function uniquePush(
  out: string[],
  value: string | undefined | null,
  max = 6
) {
  const t = clean(value)
    .replace(/^[-*]\s*/, "")
    .replace(/^(target|query|prompt|context|branch|session)\s*:\s*/i, "")
    .trim();
  if (t.length < 3) return;
  const key = t.toLowerCase();
  if (out.some((v) => v.toLowerCase() === key)) return;
  out.push(t);
  if (out.length > max) out.length = max;
}

function extractSignals(trigger: AgentTrigger): string[] {
  const out: string[] = [];

  uniquePush(out, trigger.targetPrompt);

  const quoted = trigger.reason.match(/"([^"]{3,160})"/)?.[1];
  uniquePush(out, quoted);

  const reasonTail = trigger.reason
    .replace(/^(search query|chat query|user message|session target updated)\s*:?\s*/i, "")
    .trim();
  uniquePush(out, reasonTail);

  for (const line of (trigger.context ?? "").split(/\n|;/g)) {
    uniquePush(out, line);
  }

  if (out.length === 0) {
    uniquePush(out, "current project target prompt");
  }
  return out;
}

function sourcePrefix(source: AgentTriggerSource | undefined): string {
  if (source === "search") return "Search target";
  if (source === "chat") return "Chat ask";
  if (source === "prompt") return "Prompt edit";
  return "Tree update";
}

function makeNode(args: {
  parentId: string | null;
  depth: number;
  col: number;
  label: string;
  detail?: string;
}): AgentNode {
  return {
    id: uid("a"),
    parentId: args.parentId,
    col: args.col,
    depth: args.depth,
    label: shorten(args.label, 72),
    detail: args.detail ? shorten(args.detail, 140) : undefined,
    status: "considering",
    visiting: false,
  };
}

function buildSyntheticTree(trigger: AgentTrigger): AgentNode[] {
  const signals = extractSignals(trigger);
  const primary = signals[0] ?? "current target prompt";
  const root = makeNode({
    parentId: null,
    depth: 0,
    col: 0,
    label: `${sourcePrefix(trigger.source)}: ${shorten(primary, 46)}`,
    detail: `Triggered by ${trigger.reason}`,
  });

  const branchSpecs = [
    {
      label: `Intent: ${shorten(primary, 52)}`,
      detail: "Keep the traversal centered on what the user is trying to do.",
    },
    ...TOOL_STEPS,
    {
      label: signals[1]
        ? `Related goal: ${shorten(signals[1], 48)}`
        : "Find the missing branch",
      detail: signals[1]
        ? "Compare a nearby branch target against the latest ask."
        : "Look for the branch that should be opened or created next.",
    },
  ];

  const branchCount = 3;
  const branches = branchSpecs.slice(0, branchCount).map((spec, i) =>
    makeNode({
      parentId: root.id,
      depth: 1,
      col: i - (branchCount - 1) / 2,
      label: spec.label,
      detail: spec.detail,
    })
  );

  const leaves: AgentNode[] = [];
  const leafSpecs = [
    {
      label: "Evidence to cite",
      detail: signals[2] ?? "Session IDs, branch summaries, and highlights.",
    },
    {
      label: "Open uncertainty",
      detail:
        signals[1] ??
        "What extra context would change the answer or next branch?",
    },
    {
      label: "Next response shape",
      detail: "Answer directly, then include what to inspect next.",
    },
  ];

  branches.slice(0, 3).forEach((branch, i) => {
    const spec = leafSpecs[i % leafSpecs.length];
    leaves.push(
      makeNode({
        parentId: branch.id,
        depth: 2,
        col: branch.col,
        label: spec.label,
        detail: spec.detail,
      })
    );
  });

  return [root, ...branches, ...leaves];
}

function buildLlmTree(trigger: AgentTrigger, plan: VisualAgentPlan): AgentNode[] {
  const signals = extractSignals(trigger);
  const primary = signals[0] ?? "current target prompt";
  const root = makeNode({
    parentId: null,
    depth: 0,
    col: 0,
    label: `LLM traversal: ${shorten(primary, 42)}`,
    detail: plan.planSummary,
  });

  const firstTier = plan.steps.slice(0, 3);
  const branches = firstTier.map((step, i) =>
    makeNode({
      parentId: root.id,
      depth: 1,
      col: i - (firstTier.length - 1) / 2,
      label: step.label,
      detail: step.detail,
    })
  );

  const leaves = plan.steps.slice(3).map((step, i) => {
    const parent = branches[i % Math.max(1, branches.length)] ?? root;
    return makeNode({
      parentId: parent.id,
      depth: parent === root ? 1 : 2,
      col: parent.col,
      label: step.label,
      detail: step.detail,
    });
  });

  return [root, ...branches, ...leaves];
}

function findingsFromPlan(
  plan: VisualAgentPlan,
  nodes: AgentNode[]
): AgentHighlight[] {
  const sourceNodes = nodes.filter((n) => n.depth > 0);
  return plan.findings.slice(0, 3).map((finding, i) => ({
    id: uid("h"),
    label: finding.label,
    reason: finding.reason,
    sourceNodeId: sourceNodes[i % Math.max(1, sourceNodes.length)]?.id ?? null,
    createdAt: Date.now() + i,
  }));
}

async function requestLlmPlan(
  trigger: AgentTrigger,
  treeSnapshot: AgentNode[],
  signal: AbortSignal
): Promise<VisualAgentPlan | null> {
  const res = await fetch("/api/agent/visual-plan", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      trigger,
      treeSnapshot: treeSnapshot.map((n) => ({
        label: n.label,
        detail: n.detail,
        depth: n.depth,
      })),
    }),
    signal,
  });
  if (!res.ok) return null;
  const payload = (await res.json()) as Partial<VisualAgentPlanResponse>;
  return payload.plan ?? null;
}

function buildExpansionNode(
  parent: AgentNode,
  signals: string[],
  existing: AgentNode[]
): AgentNode | null {
  if (parent.depth >= 2) return null;
  if (existing.some((n) => n.parentId === parent.id)) return null;

  const candidate = REASONING_STEPS[
    Math.floor(Math.random() * REASONING_STEPS.length)
  ];
  const signal = signals[(parent.depth + existing.length) % signals.length];
  return makeNode({
    parentId: parent.id,
    depth: parent.depth + 1,
    col: parent.col,
    label: candidate.label,
    detail: signal
      ? `${candidate.detail} Focus: ${shorten(signal, 96)}`
      : candidate.detail,
  });
}

function buildHighlightBatch(
  trigger: AgentTrigger,
  nodes: AgentNode[]
): AgentHighlight[] {
  const signals = extractSignals(trigger);
  const primary = signals[0] ?? "current target prompt";
  const secondary = signals[1] ?? signals[2] ?? primary;
  const confirmed = nodes.filter(
    (n) => n.status === "confirmed" && n.depth > 0
  );
  const dismissed = nodes.filter(
    (n) => n.status === "dismissed" && n.depth > 0
  );
  const source =
    confirmed[Math.floor(Math.random() * Math.max(1, confirmed.length))] ??
    nodes.find((n) => n.depth > 0) ??
    null;
  const secondSource =
    confirmed.find((n) => n.id !== source?.id) ??
    nodes.find((n) => n.depth > 0 && n.id !== source?.id) ??
    source;

  const candidates = [
    {
      label: "Plan: run digests -> messages -> highlights",
      reason:
        "The agent chose a visible three-tool loop before synthesizing an answer.",
    },
    {
      label: source
        ? `Finding: strongest path is "${shorten(source.label, 54)}"`
        : "Finding: traversal produced one promising path",
      reason: source?.detail
        ? `Carry this into synthesis: ${shorten(source.detail, 96)}`
        : "The agent found a branch worth carrying into synthesis.",
    },
    {
      label: `Gap: verify "${shorten(secondary, 58)}"`,
      reason:
        "This is the most useful uncertainty to check before committing to an answer.",
    },
    {
      label: `Next fork: test "${shorten(primary, 56)}"`,
      reason:
        "A focused branch would let the team isolate this ask from broader context.",
    },
    {
      label:
        dismissed.length > 0
          ? `Pruned: ${dismissed.length} weak path${
              dismissed.length === 1 ? "" : "s"
            }`
          : "Critique: no obvious dead end yet",
      reason:
        dismissed[0]?.label ??
        "The agent kept all current branches alive until more evidence appears.",
    },
    {
      label: secondSource
        ? `Synthesis anchor: ${shorten(secondSource.label, 56)}`
        : "Synthesis anchor: branch evidence first",
      reason: secondSource?.detail
        ? shorten(secondSource.detail, 110)
        : "The final answer should point back to concrete branch evidence.",
    },
    {
      label: "Decision: cite sessions before summarizing",
      reason:
        "The agent will prioritize grounded references over a broad generic answer.",
    },
    {
      label: "Loop: plan -> inspect -> critique -> pin",
      reason:
        "This run produced a visible work loop: traverse the tree, expand useful paths, prune weak ones, then pin findings.",
    },
  ];

  const shuffled = candidates
    .map((candidate) => ({ candidate, score: Math.random() }))
    .sort((a, b) => a.score - b.score)
    .map(({ candidate }) => candidate)
    .slice(0, 2);

  return shuffled.map((choice, i) => ({
    id: uid("h"),
    label: choice.label,
    reason: choice.reason,
    sourceNodeId: i === 0 ? source?.id ?? null : secondSource?.id ?? null,
    createdAt: Date.now() + i,
  }));
}

export function AgentActivityProvider({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<AgentPhase>("idle");
  const [nodes, setNodes] = useState<AgentNode[]>([]);
  const [highlights, setHighlights] = useState<AgentHighlight[]>([]);
  const [cursorNodeId, setCursorNodeId] = useState<string | null>(null);
  const [statusText, setStatusText] = useState<string>(
    "Agent idle - waiting for a target prompt."
  );
  const [cycleCount, setCycleCount] = useState(0);

  const visitQueueRef = useRef<string[]>([]);
  const traversalNodesRef = useRef<AgentNode[]>([]);
  const triggerQueueRef = useRef<AgentTrigger[]>([]);
  const phaseRef = useRef<AgentPhase>("idle");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dispatchRef = useRef<(action: Action) => void>(() => {});
  const activeTriggerRef = useRef<AgentTrigger>({
    reason: "initial idle",
    source: "tree",
  });
  const activeSignalsRef = useRef<string[]>(["current target prompt"]);
  const lastTriggerRef = useRef<{ key: string; at: number } | null>(null);
  const llmCycleRef = useRef(0);
  const llmAbortRef = useRef<AbortController | null>(null);
  const llmFindingsRef = useRef<AgentHighlight[]>([]);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const startLlmPlan = useCallback(
    (triggerForPlan: AgentTrigger, cycle: number, snapshot: AgentNode[]) => {
      llmAbortRef.current?.abort();
      const ac = new AbortController();
      llmAbortRef.current = ac;

      void (async () => {
        try {
          const plan = await requestLlmPlan(
            triggerForPlan,
            snapshot,
            ac.signal
          );
          if (!plan || ac.signal.aborted || llmCycleRef.current !== cycle) {
            return;
          }

          const modelNodes = buildLlmTree(triggerForPlan, plan);
          llmFindingsRef.current = findingsFromPlan(plan, modelNodes);
          traversalNodesRef.current = modelNodes;
          visitQueueRef.current = modelNodes.map((n) => n.id);
          setNodes(modelNodes);
          setCursorNodeId(null);
          setPhase("spinning_up");
          setStatusText(`LLM plan loaded - ${shorten(plan.planSummary, 80)}`);
        } catch (err) {
          if (err instanceof DOMException && err.name === "AbortError") return;
        }
      })();
    },
    []
  );

  const dispatch = useCallback(
    (action: Action) => {
      clearTimer();
      const recurse = (next: Action) => dispatchRef.current(next);

      if (action.kind === "spinup") {
        activeTriggerRef.current = action.trigger;
        activeSignalsRef.current = extractSignals(action.trigger);
        llmFindingsRef.current = [];
        const fresh = buildSyntheticTree(action.trigger);
        const cycle = llmCycleRef.current + 1;
        llmCycleRef.current = cycle;
        traversalNodesRef.current = fresh;
        visitQueueRef.current = fresh.map((n) => n.id);
        setNodes(fresh);
        setCursorNodeId(null);
        setPhase("spinning_up");
        setStatusText(`Agent planning - ${action.trigger.reason}`);
        setCycleCount((c) => c + 1);
        timerRef.current = setTimeout(() => {
          recurse({ kind: "advance" });
        }, SPINUP_MS);
        startLlmPlan(action.trigger, cycle, fresh);
        return;
      }

      if (action.kind === "advance") {
        const queue = visitQueueRef.current;
        if (queue.length === 0) {
          recurse({ kind: "highlight" });
          return;
        }
        const nextId = queue.shift()!;
        const node = traversalNodesRef.current.find((n) => n.id === nextId);
        if (!node) {
          recurse({ kind: "advance" });
          return;
        }

        setPhase("traversing");
        setCursorNodeId(nextId);
        setStatusText(`Examining: ${node.label}`);

        traversalNodesRef.current = traversalNodesRef.current.map((n) =>
          n.id === nextId
            ? { ...n, status: "evaluating", visiting: true }
            : n.visiting
              ? { ...n, visiting: false }
              : n
        );
        setNodes(traversalNodesRef.current);

        timerRef.current = setTimeout(() => {
          const decision: AgentNodeStatus =
            Math.random() < 0.68 ? "confirmed" : "dismissed";
          let nextNodes = traversalNodesRef.current.map((n) =>
            n.id === nextId
              ? { ...n, status: decision, visiting: false }
              : n
          );

          const resolved = nextNodes.find((n) => n.id === nextId);
          if (
            resolved &&
            decision === "confirmed" &&
            Math.random() < 0.42
          ) {
            const expansion = buildExpansionNode(
              resolved,
              activeSignalsRef.current,
              nextNodes
            );
            if (expansion) {
              nextNodes = [...nextNodes, expansion];
              visitQueueRef.current.push(expansion.id);
              setStatusText(`Expanded: ${resolved.label}`);
            }
          }

          if (resolved && decision === "dismissed" && Math.random() < 0.35) {
            const hasChildren = nextNodes.some((n) => n.parentId === nextId);
            if (resolved.depth > 0 && !hasChildren) {
              nextNodes = nextNodes.filter((n) => n.id !== nextId);
            }
          }

          traversalNodesRef.current = nextNodes;
          setNodes(nextNodes);
          recurse({ kind: "advance" });
        }, STEP_MS);
        return;
      }

      if (action.kind === "highlight") {
        setPhase("highlighting");
        setStatusText("Pinning plans, gaps, and findings...");
        const nextBatch =
          llmFindingsRef.current.length > 0
            ? llmFindingsRef.current
            : buildHighlightBatch(
                activeTriggerRef.current,
                traversalNodesRef.current
              );
        llmFindingsRef.current = [];
        setHighlights((prev) => {
          const seen = new Set(prev.map((h) => clean(h.label).toLowerCase()));
          const fresh = nextBatch.filter((h) => {
            const key = clean(h.label).toLowerCase();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          });
          return [...fresh, ...prev].slice(0, 6);
        });

        timerRef.current = setTimeout(() => {
          recurse({ kind: "settle" });
        }, SETTLE_MS);
        return;
      }

      if (action.kind === "settle") {
        setPhase("settling");
        setCursorNodeId(null);
        setStatusText("Synthesis path ready. Standing by.");
        timerRef.current = setTimeout(() => {
          const queued = triggerQueueRef.current.shift();
          if (queued) {
            recurse({ kind: "spinup", trigger: queued });
          } else {
            setPhase("idle");
            setStatusText("Agent idle - waiting for a target prompt.");
          }
        }, SETTLE_MS);
      }
    },
    [clearTimer, startLlmPlan]
  );

  useEffect(() => {
    dispatchRef.current = dispatch;
  }, [dispatch]);

  const trigger = useCallback(
    (t: AgentTrigger) => {
      const key = `${t.source ?? "tree"}:${clean(t.targetPrompt)}:${clean(
        t.reason
      )}`;
      const now = Date.now();
      const last = lastTriggerRef.current;
      if (last && last.key === key && now - last.at < 900) return;
      lastTriggerRef.current = { key, at: now };

      if (phaseRef.current !== "idle") {
        triggerQueueRef.current.push(t);
        if (triggerQueueRef.current.length > 2) {
          triggerQueueRef.current = triggerQueueRef.current.slice(-2);
        }
        return;
      }
      dispatch({ kind: "spinup", trigger: t });
    },
    [dispatch]
  );

  const pinHighlight = useCallback(
    (h: Omit<AgentHighlight, "id" | "createdAt">) => {
      setHighlights((prev) =>
        [
          {
            id: uid("h"),
            createdAt: Date.now(),
            ...h,
          },
          ...prev,
        ].slice(0, 6)
      );
    },
    []
  );

  const unpinHighlight = useCallback((id: string) => {
    setHighlights((prev) => prev.filter((h) => h.id !== id));
  }, []);

  useEffect(
    () => () => {
      llmAbortRef.current?.abort();
      clearTimer();
    },
    [clearTimer]
  );

  const value = useMemo<AgentActivityValue>(
    () => ({
      phase,
      nodes,
      highlights,
      cursorNodeId,
      statusText,
      cycleCount,
      trigger,
      pinHighlight,
      unpinHighlight,
    }),
    [
      phase,
      nodes,
      highlights,
      cursorNodeId,
      statusText,
      cycleCount,
      trigger,
      pinHighlight,
      unpinHighlight,
    ]
  );

  return (
    <AgentActivityContext.Provider value={value}>
      {children}
    </AgentActivityContext.Provider>
  );
}

export function useAgentActivity(): AgentActivityValue {
  const ctx = useContext(AgentActivityContext);
  if (!ctx) {
    throw new Error(
      "useAgentActivity must be used within an AgentActivityProvider"
    );
  }
  return ctx;
}
