"use client";

import { GitMergeIcon, PlusIcon, XIcon } from "lucide-react";
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
  combineContexts,
  createSession,
  forkSession,
  sendMessage,
} from "@/lib/api";
import { loadIdentity, type Identity } from "@/lib/identity";
import { useSessionFocus } from "@/lib/realtime/session-focus-context";
import { cn } from "@/lib/utils";
import type { SessionRow } from "@/types/db";
import {
  buildForestFromSessions,
  layoutForest,
  NODE_H,
  NODE_W,
} from "./compute-layout";
import {
  useForestPresence,
  useProjectParents,
  useProjectSessions,
} from "./hooks";
import { NodeCard } from "./NodeCard";
import { NodeOverlay } from "./NodeOverlay";
import type { LaidOutEdge, NodePosition, OverlayTarget } from "./types";

/**
 * The main forest surface. Owns:
 *   - subscriptions for the project's sessions + lock state
 *   - Per-session `session:{id}` realtime presence (icons on each branch + overlay)
 *   - the layout pass (memoized on the live session list)
 *   - which session, if any, is "popped up" in the overlay
 *   - multi-node selection for "New chat with context" (DAG combine)
 */

const FOREST_PADDING = 56;

/** Card + overlay labels: prefer authored purpose over auto labels ("Main fork fork"). */
function sessionDisplayName(row: SessionRow): string {
  const target = row.session_target?.trim();
  if (target) return target.length > 56 ? `${target.slice(0, 56)}…` : target;
  const label = row.label?.trim();
  if (label) return label.length > 56 ? `${label.slice(0, 56)}…` : label;
  return `Session ${row.id.slice(0, 8)}`;
}

type Props = {
  projectId: string;
};

type ForkContext = {
  ancestorTargets: string[];
  inheritedSummary: string | null;
};

export function ForestCanvas({ projectId }: Props) {
  const { sessions, loading, error } = useProjectSessions(projectId);
  const parentsBySession = useProjectParents(projectId);
  const [target, setTarget] = useState<OverlayTarget | null>(null);
  /**
   * After first send on a new tree / fork, the new row is not in
   * `useProjectSessions` until the Realtime INSERT lands. Without this
   * the overlay briefly got `session === null` → `sessionId` dropped,
   * empty target field, and messages cleared.
   */
  const [sessionBootstrap, setSessionBootstrap] = useState<SessionRow | null>(
    null
  );
  const { setFocusedSessionId, setOpenSessionChatImpl } = useSessionFocus();
  const [highlightJumpMessageId, setHighlightJumpMessageId] = useState<
    string | null
  >(null);

  useLayoutEffect(() => {
    setOpenSessionChatImpl((sessionId, scrollToMessageId) => {
      setTarget({ kind: "session", sessionId });
      setHighlightJumpMessageId(scrollToMessageId ?? null);
    });
    return () => setOpenSessionChatImpl(null);
  }, [setOpenSessionChatImpl]);

  /** Session channel we occupy for presence (`new-fork` stays on parent until fork exists). */
  const activePresenceSessionId =
    target?.kind === "session"
      ? target.sessionId
      : target?.kind === "new-fork"
        ? target.parentSessionId
        : null;

  // Multi-select state. Set of session ids currently selected.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const forest = useMemo(
    () => buildForestFromSessions(sessions, parentsBySession),
    [sessions, parentsBySession]
  );
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

  // Filter out self for the card-level "others present" indicator.
  const [identity, setIdentity] = useState<Identity | null>(null);
  useEffect(() => {
    // localStorage is only reachable post-hydration.
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

  // Selection helpers
  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  // Actions ----------------------------------------------------------

  const startNewTree = () => setTarget({ kind: "new-tree" });

  const closeOverlay = () => {
    setTarget(null);
    setSessionBootstrap(null);
  };

  const branchOff = useCallback((parentSessionId: string) => {
    setTarget({ kind: "new-fork", parentSessionId });
  }, []);

  /** Toolbar "New chat with context" — selected node(s) seed the next chat. */
  const newChatWithContext = useCallback(() => {
    const ids = [...selectedIds];
    if (ids.length < 1) return;
    setTarget({ kind: "new-combine", parentSessionIds: ids });
    clearSelection();
  }, [selectedIds, clearSelection]);

  const handleFirstSend = useCallback(
    async (
      content: string,
      sessionTarget: string | undefined,
      stream: {
        onAssistantDelta: (accumulated: string) => void;
        signal?: AbortSignal;
      }
    ): Promise<{ sessionId: string } | null> => {
      if (!target) return null;
      try {
        if (target.kind === "new-tree") {
          const { session } = await createSession({
            projectId,
            sessionTarget,
          });
          await sendMessage(session.id, { content }, {
            onAssistantDelta: stream.onAssistantDelta,
            signal: stream.signal,
          });
          setSessionBootstrap(session);
          setTarget({ kind: "session", sessionId: session.id });
          return { sessionId: session.id };
        }
        if (target.kind === "new-fork") {
          const { session } = await forkSession(target.parentSessionId, {
            sessionTarget,
          });
          await sendMessage(session.id, { content }, {
            onAssistantDelta: stream.onAssistantDelta,
            signal: stream.signal,
          });
          setSessionBootstrap(session);
          setTarget({ kind: "session", sessionId: session.id });
          return { sessionId: session.id };
        }
        if (target.kind === "new-combine") {
          const { session } = await combineContexts({
            parentIds: target.parentSessionIds,
          });
          await sendMessage(session.id, { content }, {
            onAssistantDelta: stream.onAssistantDelta,
            signal: stream.signal,
          });
          setSessionBootstrap(session);
          setTarget({ kind: "session", sessionId: session.id });
          return { sessionId: session.id };
        }
      } catch (err) {
        const aborted =
          (err instanceof DOMException && err.name === "AbortError") ||
          (err instanceof Error && err.name === "AbortError");
        if (aborted) return null;
        const msg = err instanceof ApiError ? err.message : "Could not start chat";
        toast.error(msg);
        return null;
      }
      return null;
    },
    [target, projectId]
  );

  // Resolve the overlay's session row from the live sessions list.
  const targetSession = useMemo(() => {
    if (target?.kind !== "session") return null;
    const fromList = sessions.find((s) => s.id === target.sessionId);
    if (fromList) return fromList;
    if (sessionBootstrap?.id === target.sessionId) return sessionBootstrap;
    return null;
  }, [target, sessions, sessionBootstrap]);

  useEffect(() => {
    if (!sessionBootstrap) return;
    if (!target || target.kind !== "session") {
      setSessionBootstrap(null);
      return;
    }
    if (target.sessionId !== sessionBootstrap.id) {
      setSessionBootstrap(null);
      return;
    }
    if (sessions.some((s) => s.id === target.sessionId)) {
      setSessionBootstrap(null);
    }
  }, [target, sessions, sessionBootstrap]);

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
        targets.push(sessionDisplayName(row));
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

  const buildCombineContext = useCallback(
    (parentIds: string[]): ForkContext | null => {
      if (parentIds.length === 0) return null;
      const names: string[] = [];
      let inheritedSummary: string | null = null;
      for (const id of parentIds) {
        const row = sessionsById.get(id);
        if (!row) continue;
        names.push(sessionDisplayName(row));
        if (!inheritedSummary && row.summary?.trim()) {
          inheritedSummary = row.summary.trim();
        }
      }
      if (names.length === 0) return null;
      return { ancestorTargets: names, inheritedSummary };
    },
    [sessionsById]
  );

  const forkContext = useMemo(() => {
    if (target?.kind === "new-fork") {
      return buildForkContext(target.parentSessionId);
    }
    if (target?.kind === "new-combine") {
      return buildCombineContext(target.parentSessionIds);
    }
    if (target?.kind === "session" && targetSession) {
      const joinParents = parentsBySession[targetSession.id] ?? [];
      if (joinParents.length > 1) {
        return buildCombineContext(joinParents);
      }
      if (targetSession.parent_session_id) {
        return buildForkContext(targetSession.parent_session_id);
      }
    }
    return null;
  }, [
    target,
    targetSession,
    buildForkContext,
    buildCombineContext,
    parentsBySession,
  ]);

  /** Display names for lineage / "Sources" chips (session_target-first). */
  const sessionLabels = useMemo(() => {
    const m: Record<string, string> = {};
    for (const s of sessions) {
      m[s.id] = sessionDisplayName(s);
    }
    return m;
  }, [sessions]);

  // Render -----------------------------------------------------------

  const inner = {
    width: Math.max(layout.width + FOREST_PADDING * 2, NODE_W * 2),
    height: Math.max(layout.height + FOREST_PADDING * 2, NODE_H * 2),
  };

  const hasSelection = selectedIds.size > 0;

  return (
    <section className="relative z-10 flex h-full min-h-0 flex-1 flex-col bg-background/80 backdrop-blur-sm">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border/60 bg-card/50 px-4 py-3">
        <NewTreeButton onClick={startNewTree} />

        {hasSelection ? (
          <>
            <span className="text-xs text-muted-foreground">
              {selectedIds.size} selected
            </span>
            <button
              type="button"
              onClick={newChatWithContext}
              className={cn(
                "inline-flex items-center gap-2 rounded-2xl border-2 border-violet-400/70 bg-violet-500/15 px-3 py-1.5",
                "text-sm font-medium text-violet-700 shadow-sm transition-all",
                "hover:scale-[1.02] hover:bg-violet-500/25 hover:shadow-md",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400",
                "dark:border-violet-300/50 dark:bg-violet-400/10 dark:text-violet-200"
              )}
              aria-label="Start a new chat seeded from the selected node or nodes"
            >
              <GitMergeIcon className="size-4" strokeWidth={2.5} />
              <span>New chat with context</span>
            </button>
            <button
              type="button"
              onClick={clearSelection}
              className="ml-auto inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
              aria-label="Clear selection"
            >
              <XIcon className="size-3" />
              Clear
            </button>
          </>
        ) : (
          <div className="text-xs text-muted-foreground">
            Click <span className="font-medium text-foreground">+</span> to plant
            a new tree, or click any node to open its chat.
            {" "}Use <span className="font-medium text-foreground">✓</span> on cards to
            select nodes, then start a new chat with context.
          </div>
        )}

        {error ? (
          <div className="ml-auto text-xs text-destructive">Error: {error}</div>
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
            const isMerged = node.parentIds.length > 1;
            return (
              <NodeCard
                key={node.id}
                position={offset(pos)}
                label={node.label}
                summary={node.summary}
                isRoot={node.parentId == null}
                isMerged={isMerged}
                isLocked={node.pendingUserId != null}
                presence={othersBySession[node.id] ?? []}
                focused={focused}
                isSelected={selectedIds.has(node.id)}
                onSelect={() => toggleSelect(node.id)}
                onClick={() => setTarget({ kind: "session", sessionId: node.id })}
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
                : target.kind === "new-combine"
                  ? `combine:${[...target.parentSessionIds].sort().join(",")}`
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
                : target.kind === "new-combine"
                  ? "new-combine"
                  : undefined
          }
          parentIds={
            target.kind === "new-fork"
              ? [target.parentSessionId]
              : target.kind === "new-combine"
                ? target.parentSessionIds
                : target.kind === "session" && targetSession
                  ? (() => {
                      const fromJoin = parentsBySession[targetSession.id] ?? [];
                      if (fromJoin.length > 0) return fromJoin;
                      return targetSession.parent_session_id
                        ? [targetSession.parent_session_id]
                        : [];
                    })()
                  : []
          }
          parentLabels={sessionLabels}
          forkContext={forkContext}
          onSendNew={handleFirstSend}
          onBranchOff={() => {
            if (target.kind === "session") void branchOff(target.sessionId);
          }}
          onOpenSession={(sessionId) =>
            setTarget({ kind: "session", sessionId })
          }
          onClose={closeOverlay}
          scrollToMessageId={highlightJumpMessageId}
          onScrollToMessageHandled={() => setHighlightJumpMessageId(null)}
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
      {layout.edges.map((edge: LaidOutEdge) => {
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
            stroke={edge.secondary ? "rgb(139 92 246 / 0.55)" : "currentColor"}
            strokeWidth={1.5}
            strokeDasharray={edge.secondary ? "5 3" : undefined}
            fill="none"
            opacity={edge.secondary ? 0.7 : 0.55}
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
      <p className="text-xs">Hit &ldquo;New chat&rdquo; at the top to plant one.</p>
    </div>
  );
}
