"use client";

import { useEffect, useMemo, useRef } from "react";

import { useAgentActivity } from "@/lib/agent/agent-activity-context";
import type { SessionRow } from "@/types/db";

import { useProjectSessions } from "../forest/hooks";

function sessionGoal(s: SessionRow): string {
  return (
    s.session_target?.trim() ||
    s.label?.trim() ||
    `Session ${s.id.slice(0, 8)}`
  );
}

function latestSession(sessions: SessionRow[]): SessionRow | null {
  let latest: SessionRow | null = null;
  for (const s of sessions) {
    if (!latest || s.last_activity_at > latest.last_activity_at) latest = s;
  }
  return latest;
}

function buildContext(sessions: SessionRow[]): string {
  const latest = latestSession(sessions);
  const activeGoals = sessions
    .slice()
    .sort((a, b) => b.last_activity_at.localeCompare(a.last_activity_at))
    .slice(0, 5)
    .map((s, i) => `Branch ${i + 1}: ${sessionGoal(s)}`);
  return [
    latest ? `Active target: ${sessionGoal(latest)}` : null,
    `Project tree: ${sessions.length} sessions`,
    ...activeGoals,
  ]
    .filter(Boolean)
    .join("\n");
}

function targetFingerprint(sessions: SessionRow[]): string {
  return sessions
    .map((s) =>
      [
        s.id,
        s.parent_session_id ?? "",
        s.session_target?.trim() ?? "",
        s.label?.trim() ?? "",
      ].join(":")
    )
    .sort()
    .join("|");
}

/**
 * Watches the user tree and starts the visual agent whenever the project state
 * changes: new branch, removed branch, new message, or edited session target.
 */
export function AgentTriggerWatcher({ projectId }: { projectId: string }) {
  const { sessions } = useProjectSessions(projectId);
  const { trigger } = useAgentActivity();

  const context = useMemo(() => buildContext(sessions), [sessions]);
  const primaryTarget = useMemo(
    () => (latestSession(sessions) ? sessionGoal(latestSession(sessions)!) : ""),
    [sessions]
  );

  const lastSnapshotRef = useRef<{
    count: number;
    totalMessages: number;
    latestActivity: string;
    targetsKey: string;
  } | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const totalMessages = sessions.reduce(
      (sum, s) => sum + (s.message_count ?? 0),
      0
    );
    const latestActivity = sessions.reduce(
      (acc, s) =>
        s.last_activity_at && s.last_activity_at > acc
          ? s.last_activity_at
          : acc,
      ""
    );
    const snapshot = {
      count: sessions.length,
      totalMessages,
      latestActivity,
      targetsKey: targetFingerprint(sessions),
    };

    const last = lastSnapshotRef.current;
    lastSnapshotRef.current = snapshot;

    if (!last) return;

    let reason: string | null = null;
    let source: "chat" | "tree" | "prompt" = "tree";
    if (snapshot.count > last.count) {
      reason = "new branch added to the user tree";
      source = "tree";
    } else if (snapshot.count < last.count) {
      reason = "branch removed from the user tree";
      source = "tree";
    } else if (snapshot.targetsKey !== last.targetsKey) {
      reason = "session target updated";
      source = "prompt";
    } else if (snapshot.totalMessages > last.totalMessages) {
      reason = "user added a query";
      source = "chat";
    } else if (
      snapshot.latestActivity &&
      snapshot.latestActivity !== last.latestActivity
    ) {
      reason = "session activity changed";
      source = "tree";
    }

    if (!reason) return;

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      trigger({
        reason,
        source,
        targetPrompt: primaryTarget,
        context,
      });
    }, 250);
  }, [sessions, trigger, primaryTarget, context]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  return null;
}
