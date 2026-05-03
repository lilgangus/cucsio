"use client";

import { PlusIcon } from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from "react";
import { toast } from "sonner";

import {
  ApiError,
  createSession,
  forkSession,
  sendMessage,
} from "@/lib/api";
import { loadIdentity, type Identity } from "@/lib/identity";
import { useSessionFocus } from "@/lib/realtime/session-focus-context";
import { cn } from "@/lib/utils";
import {
  buildForestFromSessions,
  layoutForest,
  NODE_H,
  NODE_W,
} from "./compute-layout";
import {
  useForestPresence,
  useProjectSessions,
} from "./hooks";
import { NodeCard } from "./NodeCard";
import { NodeOverlay } from "./NodeOverlay";
import type { NodePosition, OverlayTarget } from "./types";

/**
 * The main forest surface. Owns:
 *   - subscriptions for the project's sessions + lock state
 *   - Per-session `session:{id}` realtime presence (icons on each branch + overlay)
 *   - the layout pass (memoized on the live session list)
 *   - which session, if any, is "popped up" in the overlay
 *
 * Data flow:
 *
 *   Postgres  ──CDC──▶  useProjectSessions  ──▶  buildForestFromSessions
 *                                                       │
 *                                                       ▼
 *                                                 layoutForest
 *                                                       │
 *                                                       ▼
 *                                                NodeCard (×N) + edges
 *
 * Sending / branching go through the API routes which take the
 * session-wide lock so simultaneous senders can't trample each other.
 */

const FOREST_PADDING = 56;

type Props = {
  projectId: string;
};

type ForkContext = {
  ancestorTargets: string[];
  inheritedSummary: string | null;
};

export function ForestCanvas({ projectId }: Props) {
  const { sessions, loading, error } = useProjectSessions(projectId);
  const [target, setTarget] = useState<OverlayTarget | null>(null);
  const { setFocusedSessionId } = useSessionFocus();

  /** Session channel we occupy for presence (`new-fork` stays on parent until fork exists). */
  const activePresenceSessionId =
    target?.kind === "session"
      ? target.sessionId
      : target?.kind === "new-fork"
        ? target.parentSessionId
        : null;

  const forest = useMemo(() => buildForestFromSessions(sessions), [sessions]);
  const layout = useMemo(() => layoutForest(forest), [forest]);

  const sessionIds = useMemo(() => sessions.map((s) => s.id), [sessions]);
  const presenceBySession = useForestPresence({
    sessionIds,
    activeSessionId: activePresenceSessionId,
  });

  useLayoutEffect(() => {
    setFocusedSessionId(activePresenceSessionId);
  }, [activePresenceSessionId, setFocusedSessionId]);

  useLayoutEffect(() => {
    return () => setFocusedSessionId(null);
  }, [setFocusedSessionId]);

  // Filter out self for the card-level "others present" indicator —
  // seeing your own dot on every card you've ever opened is noisy.
  const [identity, setIdentity] = useState<Identity | null>(null);
  useEffect(() => {
    // localStorage is only reachable post-hydration. Canonical
    // sync-with-external-system read; matches the pattern used in
    // top-bar.tsx + room-guard.tsx.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIdentity(loadIdentity());
  }, []);
  const othersBySession = useMemo(() => {
    const me = identity?.clientId;
    const out: typeof presenceBySession = {};
    for (const [id, list] of Object.entries(presenceBySession)) {
      out[id] = me ? list.filter((p) => p.clientId !== me) : list;
    }
    return out;
  }, [presenceBySession, identity]);

  // Actions ----------------------------------------------------------

  const startNewTree = () => setTarget({ kind: "new-tree" });

  const closeOverlay = () => {
    setTarget(null);
  };

  const branchOff = useCallback(
    async (parentSessionId: string) => {
      setTarget({ kind: "new-fork", parentSessionId });
    },
    []
  );

  /**
   * Used by the overlay when the user types the first message of a
   * pending tree / fork: lazily creates the session, then sends.
   * Returns the new session id so the overlay can switch over.
   */
  const handleFirstSend = useCallback(
    async (
      content: string,
      sessionTarget?: string
    ): Promise<{ sessionId: string } | null> => {
      if (!target) return null;
      try {
        if (target.kind === "new-tree") {
          const { session } = await createSession({
            projectId,
            sessionTarget,
          });
          await sendMessage(session.id, { content });
          setTarget({ kind: "session", sessionId: session.id });
          return { sessionId: session.id };
        }
        if (target.kind === "new-fork") {
          const { session } = await forkSession(target.parentSessionId, {
            sessionTarget,
          });
          await sendMessage(session.id, { content });
          setTarget({ kind: "session", sessionId: session.id });
          return { sessionId: session.id };
        }
      } catch (err) {
        const msg =
          err instanceof ApiError ? err.message : "Could not start chat";
        toast.error(msg);
        return null;
      }
      return null;
    },
    [target, projectId]
  );

  // Resolve the overlay's session row from the live sessions list, so
  // the lock chip etc. update in real time.
  const targetSession = useMemo(() => {
    if (target?.kind !== "session") return null;
    return sessions.find((s) => s.id === target.sessionId) ?? null;
  }, [target, sessions]);

  const sessionsById = useMemo(
    () => new Map(sessions.map((s) => [s.id, s] as const)),
    [sessions]
  );

  const buildForkContext = useCallback(
    (startParentId: string | null): ForkContext | null => {
      if (!startParentId) return null;
      const targets: string[] = [];
      let inheritedSummary: string | null = null;
      let cursorId: string | null = startParentId;
      let guard = 0;
      while (cursorId && guard < 8) {
        const row = sessionsById.get(cursorId);
        if (!row) break;
        const t =
          row.session_target?.trim() ||
          row.label?.trim() ||
          `Session ${row.id.slice(0, 6)}`;
        targets.push(t);
        if (!inheritedSummary && row.summary.trim().length > 0) {
          inheritedSummary = row.summary;
        }
        cursorId = row.parent_session_id;
        guard += 1;
      }
      if (targets.length === 0) return null;
      return { ancestorTargets: targets, inheritedSummary };
    },
    [sessionsById]
  );

  const forkContext = useMemo(() => {
    if (target?.kind === "new-fork") {
      return buildForkContext(target.parentSessionId);
    }
    if (target?.kind === "session" && targetSession?.parent_session_id) {
      return buildForkContext(targetSession.parent_session_id);
    }
    return null;
  }, [target, targetSession, buildForkContext]);

  // Render -----------------------------------------------------------

  const inner = {
    width: Math.max(layout.width + FOREST_PADDING * 2, NODE_W * 2),
    height: Math.max(layout.height + FOREST_PADDING * 2, NODE_H * 2),
  };

  return (
    <section className="relative z-10 flex h-full min-h-0 flex-1 flex-col bg-background/80 backdrop-blur-sm">
      <div className="flex shrink-0 items-center gap-3 border-b border-border/60 bg-card/50 px-4 py-3">
        <NewTreeButton onClick={startNewTree} />
        <div className="text-xs text-muted-foreground">
          Click <span className="font-medium text-foreground">+</span> to plant
          a new tree, or click any node to open its chat.
        </div>
        {error ? (
          <div className="ml-auto text-xs text-destructive">
            Error: {error}
          </div>
        ) : null}
      </div>

      <div className="relative min-h-0 flex-1 overflow-auto">
        <div
          className="relative mx-auto"
          style={{ width: inner.width, height: inner.height }}
        >
          <ForestEdges layout={layout} />
          {Object.values(forest.nodes).map((node) => {
            const pos = layout.positions[node.id];
            if (!pos) return null;
            const focused =
              target?.kind === "session" && target.sessionId === node.id;
            return (
              <NodeCard
                key={node.id}
                position={offset(pos)}
                label={node.label}
                summary={node.summary}
                isRoot={node.parentId == null}
                isLocked={node.pendingUserId != null}
                presence={othersBySession[node.id] ?? []}
                focused={focused}
                onClick={() =>
                  setTarget({ kind: "session", sessionId: node.id })
                }
              />
            );
          })}
          {!loading && forest.trees.length === 0 ? <EmptyForestHint /> : null}
        </div>
      </div>

      {target ? (
        <NodeOverlay
          key={
            target.kind === "session"
              ? target.sessionId
              : target.kind === "new-fork"
                ? `fork:${target.parentSessionId}`
                : "new-tree"
          }
          session={targetSession}
          presence={
            target.kind === "session"
              ? (presenceBySession[target.sessionId] ?? [])
              : target.kind === "new-fork"
                ? (presenceBySession[target.parentSessionId] ?? [])
                : []
          }
          isPending={target.kind !== "session"}
          pendingMode={
            target.kind === "new-tree"
              ? "new-tree"
              : target.kind === "new-fork"
                ? "new-fork"
                : undefined
          }
          onSendNew={handleFirstSend}
          forkContext={forkContext}
          onBranchOff={() => {
            if (target.kind === "session") void branchOff(target.sessionId);
          }}
          onClose={closeOverlay}
        />
      ) : null}
    </section>
  );
}

function offset(pos: NodePosition): NodePosition {
  return { x: pos.x + FOREST_PADDING, y: pos.y + FOREST_PADDING };
}

function ForestEdges({ layout }: { layout: ReturnType<typeof layoutForest> }) {
  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full text-border"
      aria-hidden
    >
      {layout.edges.map((edge) => {
        const from = layout.positions[edge.from];
        const to = layout.positions[edge.to];
        if (!from || !to) return null;
        const f = offset(from);
        const t = offset(to);
        const path = edgePath(f, t);
        return (
          <path
            key={`${edge.from}-${edge.to}`}
            d={path}
            stroke="currentColor"
            strokeWidth={1.5}
            fill="none"
            opacity={0.55}
          />
        );
      })}
    </svg>
  );
}

/** Smooth S-curve from parent's bottom edge to child's top edge. */
function edgePath(from: NodePosition, to: NodePosition): string {
  const startY = from.y + NODE_H / 2;
  const endY = to.y - NODE_H / 2;
  const midY = (startY + endY) / 2;
  return `M ${from.x},${startY} C ${from.x},${midY} ${to.x},${midY} ${to.x},${endY}`;
}

function NewTreeButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group/new-tree inline-flex items-center gap-2 rounded-2xl border-2 border-dashed border-blue-400/70 bg-blue-500/15 px-3 py-1.5",
        "text-sm font-medium text-blue-700 shadow-sm transition-all",
        "hover:scale-[1.02] hover:bg-blue-500/25 hover:shadow-md",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400",
        "dark:border-blue-300/50 dark:bg-blue-400/10 dark:text-blue-200"
      )}
      aria-label="Start a new tree"
    >
      <PlusIcon className="size-5" strokeWidth={2.5} />
      <span>New chat</span>
    </button>
  );
}

function EmptyForestHint() {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-center text-muted-foreground">
      <p className="text-sm">No trees yet.</p>
      <p className="text-xs">Hit “New chat” at the top to plant one.</p>
    </div>
  );
}
