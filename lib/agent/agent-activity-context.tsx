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
  AgentChatFindingsPayload,
  AgentChatFindingsResponse,
  VisualAgentPlan,
  VisualAgentPlanResponse,
} from "@/lib/agent/visual-plan";

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
  summary: string;
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
  pinChatFindings: (payload: AgentChatFindingsPayload) => Promise<void>;
  pinHighlight: (h: Omit<AgentHighlight, "id" | "createdAt">) => void;
  unpinHighlight: (id: string) => void;
};

const AgentActivityContext = createContext<AgentActivityValue | undefined>(
  undefined
);

const STEP_MS = 700;
const SPINUP_MS = 450;
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

const PROCESS_FINDING_RE =
  /\b(active context|branch|checking|citation|completes|displayed|grounded synthesis|session|status|target|tool|travers|verification|visual|workflow)\b/i;

function isUsefulHighlight(summary: string): boolean {
  const text = clean(summary);
  if (!text || PROCESS_FINDING_RE.test(text)) return false;
  return text.split(/\s+/).length >= 4;
}

function makeNode(args: {
  id?: string;
  parentId: string | null;
  depth: number;
  col: number;
  label: string;
  detail?: string;
}): AgentNode {
  return {
    id: args.id ?? uid("a"),
    parentId: args.parentId,
    col: args.col,
    depth: args.depth,
    label: shorten(args.label, 72),
    detail: args.detail ? shorten(args.detail, 140) : undefined,
    status: "considering",
    visiting: false,
  };
}

function buildTreeFromPlan(plan: VisualAgentPlan): AgentNode[] {
  const idByKey = new Map(plan.tree.map((n) => [n.key, uid("a")] as const));
  const byKey = new Map(plan.tree.map((n) => [n.key, n] as const));
  const depthMemo = new Map<string, number>();

  const depthFor = (key: string, seen = new Set<string>()): number => {
    const memo = depthMemo.get(key);
    if (memo != null) return memo;
    if (seen.has(key)) return 0;
    const node = byKey.get(key);
    if (!node?.parentKey) {
      depthMemo.set(key, 0);
      return 0;
    }
    seen.add(key);
    const depth = Math.min(2, depthFor(node.parentKey, seen) + 1);
    depthMemo.set(key, depth);
    return depth;
  };

  const withDepth = plan.tree.map((node, index) => ({
    node,
    depth: index === 0 ? 0 : depthFor(node.key),
  }));
  const byDepth = new Map<number, typeof withDepth>();
  for (const item of withDepth) {
    const bucket = byDepth.get(item.depth) ?? [];
    bucket.push(item);
    byDepth.set(item.depth, bucket);
  }

  const colByKey = new Map<string, number>();
  for (const [depth, bucket] of byDepth.entries()) {
    if (depth === 0) {
      for (const item of bucket) colByKey.set(item.node.key, 0);
      continue;
    }
    bucket.forEach((item, i) => {
      colByKey.set(item.node.key, i - (bucket.length - 1) / 2);
    });
  }

  return withDepth.map(({ node, depth }, index) => {
    const id = idByKey.get(node.key) ?? uid("a");
    const parentId =
      index === 0 || !node.parentKey ? null : idByKey.get(node.parentKey) ?? null;
    return makeNode({
      id,
      parentId,
      depth,
      col: colByKey.get(node.key) ?? 0,
      label: node.summary,
      detail: node.detail,
    });
  });
}

function findingsFromPlan(
  plan: VisualAgentPlan,
  nodes: AgentNode[]
): AgentHighlight[] {
  const sourceNodes = nodes.filter((n) => n.depth > 0);
  return plan.findings.slice(0, 4).map((finding, i) => ({
    id: uid("h"),
    summary: finding.summary,
    sourceNodeId: sourceNodes[i % Math.max(1, sourceNodes.length)]?.id ?? null,
    createdAt: Date.now() + i,
  }));
}

async function requestLlmPlan(
  trigger: AgentTrigger,
  signal: AbortSignal
): Promise<VisualAgentPlan | null> {
  const res = await fetch("/api/agent/visual-plan", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ trigger }),
    signal,
  });
  if (!res.ok) return null;
  const payload = (await res.json()) as Partial<VisualAgentPlanResponse>;
  return payload.plan ?? null;
}

async function requestChatFindings(
  payload: AgentChatFindingsPayload,
  signal?: AbortSignal
): Promise<AgentHighlight[]> {
  const res = await fetch("/api/agent/findings", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ payload }),
    signal,
  });
  if (!res.ok) return [];
  const json = (await res.json()) as Partial<AgentChatFindingsResponse>;
  return (json.findings ?? [])
    .filter((f) => isUsefulHighlight(f.summary))
    .map((finding, i) => ({
      id: uid("h"),
      summary: finding.summary,
      sourceNodeId: null,
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
  const llmCycleRef = useRef(0);
  const llmAbortRef = useRef<AbortController | null>(null);
  const llmFindingsRef = useRef<AgentHighlight[]>([]);
  const lastTriggerRef = useRef<{ key: string; at: number } | null>(null);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const startLlmPlan = useCallback((triggerForPlan: AgentTrigger, cycle: number) => {
    llmAbortRef.current?.abort();
    const ac = new AbortController();
    llmAbortRef.current = ac;

    void (async () => {
      try {
        const plan = await requestLlmPlan(triggerForPlan, ac.signal);
        if (!plan || ac.signal.aborted || llmCycleRef.current !== cycle) {
          if (!ac.signal.aborted && llmCycleRef.current === cycle) {
            setStatusText(
              traversalNodesRef.current.length > 0
                ? "Model did not return a new tree - keeping the last run visible."
                : "Model did not return a content tree."
            );
            timerRef.current = setTimeout(() => {
              setPhase("idle");
              setStatusText(
                traversalNodesRef.current.length > 0
                  ? "Last agent tree remains visible."
                  : "Agent idle - waiting for a target prompt."
              );
            }, SETTLE_MS);
          }
          return;
        }

        const modelNodes = buildTreeFromPlan(plan);
        const findings =
          triggerForPlan.source === "chat" ? [] : findingsFromPlan(plan, modelNodes);
        traversalNodesRef.current = modelNodes;
        visitQueueRef.current = modelNodes.map((n) => n.id);
        llmFindingsRef.current = findings;
        setNodes(modelNodes);
        setCursorNodeId(null);
        setPhase("spinning_up");
        setStatusText(shorten(plan.planSummary, 110));
        timerRef.current = setTimeout(() => {
          dispatchRef.current({ kind: "advance" });
        }, SPINUP_MS);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        if (llmCycleRef.current !== cycle) return;
        setStatusText(
          traversalNodesRef.current.length > 0
            ? "Model tree failed - keeping the last completed tree."
            : "Model content tree failed before traversal."
        );
        timerRef.current = setTimeout(() => {
          setPhase("idle");
          setStatusText(
            traversalNodesRef.current.length > 0
              ? "Last agent tree remains visible."
              : "Agent idle - waiting for a target prompt."
          );
        }, SETTLE_MS);
      }
    })();
  }, []);

  const dispatch = useCallback(
    (action: Action) => {
      clearTimer();
      const recurse = (next: Action) => dispatchRef.current(next);

      if (action.kind === "spinup") {
        const cycle = llmCycleRef.current + 1;
        llmCycleRef.current = cycle;
        llmFindingsRef.current = [];
        visitQueueRef.current = [];
        setCursorNodeId(null);
        setPhase("spinning_up");
        setStatusText(
          traversalNodesRef.current.length > 0
            ? "Nemotron is generating a new tree - previous run stays pinned."
            : "Nemotron is generating a content tree..."
        );
        setCycleCount((c) => c + 1);
        startLlmPlan(action.trigger, cycle);
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
            Math.random() < 0.76 ? "confirmed" : "dismissed";
          traversalNodesRef.current = traversalNodesRef.current.map((n) =>
            n.id === nextId
              ? { ...n, status: decision, visiting: false }
              : n
          );
          setNodes(traversalNodesRef.current);
          recurse({ kind: "advance" });
        }, STEP_MS);
        return;
      }

      if (action.kind === "highlight") {
        setPhase("highlighting");
        setStatusText("Pinning generated findings...");
        const nextBatch = llmFindingsRef.current;
        llmFindingsRef.current = [];
        setHighlights((prev) => {
          const seen = new Set(prev.map((h) => clean(h.summary).toLowerCase()));
          const fresh = nextBatch.filter((h) => {
            const key = clean(h.summary).toLowerCase();
            if (!key || seen.has(key)) return false;
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
        setStatusText("Generated content tree complete.");
        timerRef.current = setTimeout(() => {
          const queued = triggerQueueRef.current.shift();
          if (queued) {
            recurse({ kind: "spinup", trigger: queued });
          } else {
            setPhase("idle");
            setStatusText("Run complete - agent tree remains visible.");
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

  const pinChatFindings = useCallback(
    async (payload: AgentChatFindingsPayload) => {
      const ac = new AbortController();
      try {
        const nextBatch = await requestChatFindings(payload, ac.signal);
        if (nextBatch.length === 0) return;
        setHighlights((prev) => {
          const seen = new Set(prev.map((h) => clean(h.summary).toLowerCase()));
          const fresh = nextBatch.filter((h) => {
            const key = clean(h.summary).toLowerCase();
            if (!key || seen.has(key) || !isUsefulHighlight(h.summary)) {
              return false;
            }
            seen.add(key);
            return true;
          });
          return [...fresh, ...prev].slice(0, 6);
        });
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        console.warn("[agent] answer-grounded findings failed", err);
      }
    },
    []
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
      pinChatFindings,
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
      pinChatFindings,
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
