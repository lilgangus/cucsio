"use client";

import {
  ActivityIcon,
  BrainCircuitIcon,
  CheckIcon,
  EyeIcon,
  SparklesIcon,
  XIcon,
  ZapIcon,
} from "lucide-react";
import { useMemo } from "react";

import {
  useAgentActivity,
  type AgentNode,
  type AgentNodeStatus,
  type AgentPhase,
} from "@/lib/agent/agent-activity-context";
import { cn } from "@/lib/utils";

/**
 * The visual "agent" surface. Renders the synthetic thinking tree plus
 * the cursor, status strip, and ambient glow that signal the agent is
 * working.
 *
 * Everything in here reads from `useAgentActivity()` — there's no own
 * timing, no DB coupling. The provider drives phase transitions.
 */

const NODE_W = 168;
const NODE_H = 56;
const COL_GAP = 28;
const ROW_GAP = 50;
const PAD_X = 36;
const PAD_Y = 32;

type Pos = { x: number; y: number };

/**
 * Lay out the agent's synthetic nodes inside the available width. We
 * use the depth as the row, and group siblings horizontally beneath
 * their parent. This is intentionally O(n) — the agent tree caps out
 * around 8 nodes, so anything fancier would be wasted code.
 */
function layoutAgentNodes(
  nodes: AgentNode[],
  width: number
): { positions: Record<string, Pos>; height: number; width: number } {
  if (nodes.length === 0) {
    return { positions: {}, height: PAD_Y * 2, width };
  }

  const childrenByParent = new Map<string | null, AgentNode[]>();
  for (const n of nodes) {
    const arr = childrenByParent.get(n.parentId) ?? [];
    arr.push(n);
    childrenByParent.set(n.parentId, arr);
  }
  // Stable left-to-right ordering by `col`.
  for (const arr of childrenByParent.values()) {
    arr.sort((a, b) => a.col - b.col);
  }

  const positions: Record<string, Pos> = {};
  let maxDepth = 0;

  // Bucket nodes by depth so we can horizontally distribute each row.
  const byDepth = new Map<number, AgentNode[]>();
  for (const n of nodes) {
    if (n.depth > maxDepth) maxDepth = n.depth;
    const arr = byDepth.get(n.depth) ?? [];
    arr.push(n);
    byDepth.set(n.depth, arr);
  }
  for (const arr of byDepth.values()) {
    arr.sort((a, b) => a.col - b.col);
  }

  let widestRow = NODE_W;
  for (const row of byDepth.values()) {
    const rowWidth = row.length * NODE_W + (row.length - 1) * COL_GAP;
    widestRow = Math.max(widestRow, rowWidth);
  }
  const canvasWidth = Math.max(width, widestRow + PAD_X * 2);
  const innerWidth = Math.max(canvasWidth - PAD_X * 2, NODE_W);

  for (let d = 0; d <= maxDepth; d++) {
    const row = byDepth.get(d) ?? [];
    if (row.length === 0) continue;
    const totalWidth = row.length * NODE_W + (row.length - 1) * COL_GAP;
    const startX = PAD_X + Math.max(0, (innerWidth - totalWidth) / 2);
    for (let i = 0; i < row.length; i++) {
      positions[row[i].id] = {
        x: startX + i * (NODE_W + COL_GAP) + NODE_W / 2,
        y: PAD_Y + d * (NODE_H + ROW_GAP) + NODE_H / 2,
      };
    }
  }

  const height =
    PAD_Y * 2 + (maxDepth + 1) * NODE_H + maxDepth * ROW_GAP + 8;
  return { positions, height, width: canvasWidth };
}

const STATUS_STYLES: Record<
  AgentNodeStatus,
  { ring: string; bg: string; text: string; chip: string; chipText: string }
> = {
  considering: {
    ring: "ring-violet-300/50 dark:ring-violet-400/40",
    bg: "bg-violet-50/70 dark:bg-violet-950/40",
    text: "text-violet-900 dark:text-violet-100",
    chip: "bg-violet-200/80 dark:bg-violet-900/60",
    chipText: "text-violet-800 dark:text-violet-100",
  },
  evaluating: {
    ring: "ring-amber-400/70 dark:ring-amber-300/60",
    bg: "bg-amber-50 dark:bg-amber-950/40",
    text: "text-amber-950 dark:text-amber-100",
    chip: "bg-amber-200/90 dark:bg-amber-900/70",
    chipText: "text-amber-900 dark:text-amber-50",
  },
  confirmed: {
    ring: "ring-emerald-400/70 dark:ring-emerald-300/60",
    bg: "bg-emerald-50 dark:bg-emerald-950/40",
    text: "text-emerald-950 dark:text-emerald-100",
    chip: "bg-emerald-200/90 dark:bg-emerald-900/70",
    chipText: "text-emerald-900 dark:text-emerald-50",
  },
  dismissed: {
    ring: "ring-zinc-300/40 dark:ring-zinc-500/30",
    bg: "bg-muted/40",
    text: "text-muted-foreground line-through decoration-zinc-400/60",
    chip: "bg-muted",
    chipText: "text-muted-foreground",
  },
};

const PHASE_COPY: Record<AgentPhase, { label: string; tone: string }> = {
  idle: {
    label: "Standing by",
    tone: "text-muted-foreground",
  },
  spinning_up: {
    label: "Spinning up",
    tone: "text-violet-600 dark:text-violet-300",
  },
  traversing: {
    label: "Traversing",
    tone: "text-amber-600 dark:text-amber-300",
  },
  highlighting: {
    label: "Pinning a finding",
    tone: "text-emerald-600 dark:text-emerald-300",
  },
  settling: {
    label: "Settling synthesis",
    tone: "text-blue-600 dark:text-blue-300",
  },
};

function StatusChip({ status }: { status: AgentNodeStatus }) {
  const Icon =
    status === "considering"
      ? SparklesIcon
      : status === "evaluating"
        ? EyeIcon
        : status === "confirmed"
          ? CheckIcon
          : XIcon;
  const styles = STATUS_STYLES[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide",
        styles.chip,
        styles.chipText
      )}
    >
      <Icon className="size-2.5" strokeWidth={3} />
      {status}
    </span>
  );
}

function AgentNodeCard({
  node,
  position,
  isCursor,
}: {
  node: AgentNode;
  position: Pos;
  isCursor: boolean;
}) {
  const styles = STATUS_STYLES[node.status];
  return (
    <div
      style={{
        position: "absolute",
        left: position.x - NODE_W / 2,
        top: position.y - NODE_H / 2,
        width: NODE_W,
        height: NODE_H,
        transition:
          "left 600ms cubic-bezier(0.22, 1, 0.36, 1), top 600ms cubic-bezier(0.22, 1, 0.36, 1)",
      }}
    >
      <div
        className={cn(
          "relative h-full w-full rounded-xl border border-border/70 px-2.5 py-1.5",
          "shadow-sm transition-all duration-300",
          styles.bg,
          isCursor
            ? "scale-[1.04] ring-2 ring-offset-2 ring-offset-background"
            : "ring-1",
          styles.ring
        )}
      >
        {/* Ambient pulse while the cursor is parked here */}
        {isCursor ? (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 rounded-xl bg-amber-300/20 motion-safe:animate-pulse dark:bg-amber-400/20"
          />
        ) : null}
        <div className="flex items-center justify-between gap-1.5">
          <span
            className={cn(
              "truncate text-[10px] font-semibold uppercase tracking-wide",
              node.depth === 0
                ? "text-violet-700 dark:text-violet-200"
                : "text-muted-foreground"
            )}
          >
            {node.depth === 0 ? "Plan" : node.depth === 1 ? "Probe" : "Leaf"}
          </span>
          <StatusChip status={node.status} />
        </div>
        <p
          className={cn(
            "mt-0.5 line-clamp-2 text-[11px] leading-tight",
            styles.text
          )}
          title={node.detail ?? ""}
        >
          {node.label}
        </p>
      </div>
    </div>
  );
}

function AgentEdges({
  nodes,
  positions,
}: {
  nodes: AgentNode[];
  positions: Record<string, Pos>;
}) {
  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full"
      aria-hidden
    >
      <defs>
        <linearGradient
          id="agent-edge"
          x1="0%"
          y1="0%"
          x2="0%"
          y2="100%"
        >
          <stop offset="0%" stopColor="rgb(167 139 250 / 0.85)" />
          <stop offset="100%" stopColor="rgb(244 114 182 / 0.6)" />
        </linearGradient>
      </defs>
      {nodes.map((n) => {
        if (!n.parentId) return null;
        const parent = positions[n.parentId];
        const child = positions[n.id];
        if (!parent || !child) return null;
        const startY = parent.y + NODE_H / 2;
        const endY = child.y - NODE_H / 2;
        const midY = (startY + endY) / 2;
        const d = `M ${parent.x},${startY} C ${parent.x},${midY} ${child.x},${midY} ${child.x},${endY}`;
        return (
          <path
            key={`${n.parentId}-${n.id}`}
            d={d}
            stroke="url(#agent-edge)"
            strokeWidth={1.5}
            fill="none"
            strokeDasharray="4 3"
            opacity={0.85}
          />
        );
      })}
    </svg>
  );
}

function AgentCursor({
  position,
  visible,
}: {
  position: Pos | null;
  visible: boolean;
}) {
  if (!position || !visible) return null;
  return (
    <div
      aria-hidden
      style={{
        position: "absolute",
        left: position.x,
        top: position.y,
        transform: "translate(-50%, -50%)",
        transition:
          "left 600ms cubic-bezier(0.22, 1, 0.36, 1), top 600ms cubic-bezier(0.22, 1, 0.36, 1)",
        pointerEvents: "none",
      }}
      className="z-20"
    >
      <span className="relative flex size-9 items-center justify-center">
        <span className="absolute inset-0 rounded-full bg-amber-400/40 motion-safe:animate-ping" />
        <span className="absolute inset-1 rounded-full bg-amber-300/50 blur-sm" />
        <span className="relative inline-flex size-6 items-center justify-center rounded-full bg-gradient-to-br from-amber-300 via-amber-400 to-fuchsia-500 text-[9px] font-bold text-white shadow-lg ring-2 ring-amber-100/80 dark:ring-amber-200/40">
          <ZapIcon className="size-3.5" strokeWidth={3} />
        </span>
      </span>
    </div>
  );
}

function PhaseDot({ phase }: { phase: AgentPhase }) {
  if (phase === "idle") {
    return (
      <span className="inline-block size-2 rounded-full bg-muted-foreground/40" />
    );
  }
  return (
    <span className="relative inline-flex size-2.5 items-center justify-center">
      <span className="absolute inset-0 rounded-full bg-amber-400/70 motion-safe:animate-ping" />
      <span className="relative inline-block size-2 rounded-full bg-amber-500" />
    </span>
  );
}

export function AgentTree({ widthHint = 720 }: { widthHint?: number }) {
  const { phase, nodes, cursorNodeId, statusText, cycleCount } =
    useAgentActivity();

  const layout = useMemo(
    () => layoutAgentNodes(nodes, widthHint),
    [nodes, widthHint]
  );

  const cursorPos = cursorNodeId ? layout.positions[cursorNodeId] : null;
  const phaseCopy = PHASE_COPY[phase];

  return (
    <div className="relative flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      {/* Subtle "agent thinking" backdrop — fades in while not idle. */}
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-0 transition-opacity duration-700",
          phase === "idle" ? "opacity-0" : "opacity-100"
        )}
      >
        <div className="absolute inset-0 bg-gradient-to-br from-violet-200/25 via-transparent to-fuchsia-200/20 dark:from-violet-500/10 dark:to-fuchsia-500/10" />
        <div className="absolute -inset-32 bg-[radial-gradient(circle_at_30%_25%,rgba(168,85,247,0.18),transparent_60%)] motion-safe:animate-pulse" />
      </div>

      <div className="relative z-10 flex shrink-0 items-center gap-3 border-b border-border/60 bg-card/60 px-4 py-2.5 backdrop-blur">
        <div className="flex size-7 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500 via-fuchsia-500 to-amber-500 text-white shadow">
          <BrainCircuitIcon className="size-4" strokeWidth={2.4} />
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            agent
            <span className="rounded-full bg-violet-500/15 px-1.5 py-0.5 text-[9px] font-bold tracking-wider text-violet-700 dark:text-violet-200">
              nemotron
            </span>
          </span>
          <span className="truncate text-sm text-foreground">
            {statusText}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2 text-[11px] text-muted-foreground">
          <PhaseDot phase={phase} />
          <span className={cn("font-medium", phaseCopy.tone)}>
            {phaseCopy.label}
          </span>
          <span className="hidden text-muted-foreground/70 sm:inline">
            / cycle #{cycleCount}
          </span>
        </div>
      </div>

      <div className="relative z-10 min-h-0 flex-1 overflow-auto">
        <div
          className="relative mx-auto"
          style={{
            width: "100%",
            minWidth: layout.width,
            minHeight: layout.height,
          }}
        >
          <AgentEdges nodes={nodes} positions={layout.positions} />
          {nodes.map((n) => {
            const pos = layout.positions[n.id];
            if (!pos) return null;
            return (
              <AgentNodeCard
                key={n.id}
                node={n}
                position={pos}
                isCursor={cursorNodeId === n.id}
              />
            );
          })}
          <AgentCursor
            position={cursorPos ?? null}
            visible={
              phase === "traversing" ||
              phase === "highlighting" ||
              phase === "spinning_up"
            }
          />

          {nodes.length === 0 ? <AgentIdleHint /> : null}
        </div>
      </div>
    </div>
  );
}

function AgentIdleHint() {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center text-muted-foreground">
      <div className="flex size-10 items-center justify-center rounded-2xl bg-violet-500/10 text-violet-600 dark:text-violet-300">
        <ActivityIcon className="size-5" />
      </div>
      <p className="text-sm font-medium text-foreground/80">
        Agent is asleep.
      </p>
      <p className="max-w-xs text-xs">
        Send a message, edit a session target, fork a branch, or run a search.
        The agent will build a thinking tree around that prompt.
      </p>
    </div>
  );
}
