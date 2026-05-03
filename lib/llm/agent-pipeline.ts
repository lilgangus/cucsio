import "server-only";

import { generateText, streamText, type ModelMessage } from "ai";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  AGENT_PHASE_LABELS,
  encodeAgentEvent,
  type AgentEvent,
  type AgentPhaseId,
} from "@/lib/llm/agent-events";
import {
  getOpenRouter,
  getOpenRouterChatModelId,
} from "@/lib/llm/openrouter";

/**
 * Server-side orchestrator for the visible agent timeline.
 *
 * Two real Nemotron calls + a handful of real DB reads dressed up as
 * named "tools" so the trace reads like a clinical workup:
 *
 *   Phase 1 — Differential brainstorming
 *     One Nemotron call asks for a short scratchpad: hypotheses,
 *     uncertainties, and a one-line plan describing which evidence is
 *     worth pulling. Streamed token-by-token to the UI.
 *
 *   Phase 2 — Evidence retrieval
 *     We run 2-3 fake-named DB reads (`fetch_session_digests`,
 *     `read_recent_messages`, `pull_pinned_highlights`). Each one emits
 *     a `tool_call` followed by a `tool_result` with a one-line log.
 *
 *   Phase 3 — Attending-style synthesis
 *     Second Nemotron call. The system prompt now includes the evidence
 *     pack and the brainstorm scratchpad. The streamed tokens are the
 *     final assistant turn — that's what the route handler persists into
 *     `messages`. Citations use `[[<session_id>]]`.
 */

const MAX_DIGEST_SESSIONS = 8;
const MAX_RECENT_MESSAGES = 15;
const MAX_HIGHLIGHTS = 10;
const SNIPPET_CHARS = 220;

type SessionDigestRow = {
  id: string;
  label: string | null;
  session_target: string;
  summary: string;
  message_count: number;
};

type RecentMessageRow = {
  id: string;
  session_id: string;
  role: string;
  content: string;
  created_at: string;
};

type HighlightDigestRow = {
  id: string;
  session_id: string;
  content: string;
  created_at: string;
};

export type AgentEvidencePack = {
  digests: SessionDigestRow[];
  recentByPriorityId: Map<string, RecentMessageRow[]>;
  highlights: HighlightDigestRow[];
  /** Session ids that turned up in any of the lookups (for citation hinting). */
  surfacedSessionIds: string[];
};

type Emit = (event: AgentEvent) => Promise<void>;

function clampSnippet(content: string, max = SNIPPET_CHARS): string {
  const t = content.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}

function shortId(id: string): string {
  return id.slice(0, 8);
}

/**
 * Streams a phase header, then streams the model output as `delta`
 * events tagged with that phase, then closes the phase with
 * `phase_status: done`. Returns the full text the model emitted.
 */
async function streamPhase(args: {
  emit: Emit;
  phase: AgentPhaseId;
  system: string;
  messages: ModelMessage[];
  maxOutputTokens?: number;
  temperature?: number;
}): Promise<string> {
  const { emit, phase, system, messages, maxOutputTokens, temperature } = args;

  await emit({
    type: "phase",
    phase,
    label: AGENT_PHASE_LABELS[phase],
  });

  const openrouter = getOpenRouter();
  const modelId = getOpenRouterChatModelId();

  const result = streamText({
    model: openrouter.chat(modelId),
    system,
    messages,
    maxOutputTokens: maxOutputTokens ?? 800,
    temperature: temperature ?? 0.4,
  });

  let buffer = "";
  for await (const chunk of result.textStream) {
    if (!chunk) continue;
    buffer += chunk;
    await emit({ type: "delta", phase, text: chunk });
  }

  await emit({ type: "phase_status", phase, status: "done" });
  return buffer.trim();
}

const DIFFERENTIAL_SYSTEM = [
  "You are the planning step of a clinical-style multi-agent reasoner working inside a fork-tree chat workspace.",
  "Frame your output as a brief 'differential brainstorm': enumerate 2-4 plausible interpretations of the user's latest ask, call out the largest open uncertainty, then list which pieces of evidence you'd pull from the workspace next.",
  "Keep it short — 6-10 lines of bullet points total. No code blocks, no headings.",
  "End with a single sentence prefixed with `Plan:` describing what you'll fetch (sibling sessions / recent messages / pinned highlights).",
  "Do NOT try to answer the user yet. This is the scratchpad before evidence retrieval.",
].join(" ");

const SYNTHESIS_SYSTEM_SUFFIX = [
  "",
  "You are now in the 'attending-style synthesis' phase of a multi-agent reasoner.",
  "An evidence pack from the workspace is included below. Cite supporting sessions inline with [[<session_id>]] when you reference them.",
  "Do not invent session ids or facts that are not in the evidence pack.",
  "Format the answer with GitHub-flavored Markdown. Lead with the answer in 1-2 sentences, then go deeper if useful.",
].join("\n");

function digestPackToMarkdown(pack: AgentEvidencePack): string {
  const sections: string[] = [];

  if (pack.digests.length > 0) {
    const lines = pack.digests.map((d) => {
      const lbl = (d.label?.trim() || "Untitled").replace(/\s+/g, " ");
      const target = (d.session_target ?? "").replace(/\s+/g, " ").trim();
      const summary = clampSnippet(d.summary ?? "", 320) || "(no summary yet)";
      return `- [[${d.id}]] ${lbl} — purpose: ${target || "(none)"} — summary: ${summary}`;
    });
    sections.push(`### Workspace session digests\n${lines.join("\n")}`);
  }

  if (pack.recentByPriorityId.size > 0) {
    const blocks: string[] = [];
    for (const [sid, rows] of pack.recentByPriorityId.entries()) {
      const lines = rows
        .slice()
        .reverse()
        .map(
          (m) =>
            `  - (${m.role}) ${clampSnippet(m.content)}`
        )
        .join("\n");
      blocks.push(`- [[${sid}]] last ${rows.length} messages:\n${lines}`);
    }
    sections.push(`### Recent transcript snippets\n${blocks.join("\n")}`);
  }

  if (pack.highlights.length > 0) {
    const lines = pack.highlights.map(
      (h) =>
        `- [[${h.session_id}]] "${clampSnippet(h.content, 180)}"`
    );
    sections.push(`### Pinned team highlights\n${lines.join("\n")}`);
  }

  return sections.length === 0
    ? "(no evidence available — answer from the live conversation alone)"
    : sections.join("\n\n");
}

/**
 * Pulls evidence from the project that the live chat context wouldn't
 * normally see (siblings, highlights), emitting one tool_call/tool_result
 * pair per "tool" so the user sees the agent working.
 */
export async function runEvidenceRetrieval(args: {
  emit: Emit;
  supabase: SupabaseClient;
  projectId: string;
  /** Optional session id to exclude from sibling digest (the active chat). */
  excludeSessionId?: string | null;
  /** Optional pre-selected ids to deepen with `read_recent_messages`. */
  prioritySessionIds?: string[];
}): Promise<AgentEvidencePack> {
  const { emit, supabase, projectId, excludeSessionId, prioritySessionIds } =
    args;

  await emit({
    type: "phase",
    phase: "evidence",
    label: AGENT_PHASE_LABELS.evidence,
  });

  // Tool 1: list every other session in the project.
  await emit({
    type: "tool_call",
    name: "fetch_session_digests",
    label: "Fetching session digests",
    args: `project=${shortId(projectId)}`,
  });

  let digests: SessionDigestRow[] = [];
  try {
    const query = supabase
      .from("sessions")
      .select(
        "id, label, session_target, summary, message_count, last_activity_at, is_archived"
      )
      .eq("project_id", projectId)
      .eq("is_archived", false)
      .order("last_activity_at", { ascending: false })
      .limit(MAX_DIGEST_SESSIONS * 2);
    const { data, error } = await query;
    if (error) {
      await emit({
        type: "tool_result",
        name: "fetch_session_digests",
        log: `error: ${error.message}`,
      });
    } else {
      digests = ((data ?? []) as SessionDigestRow[])
        .filter((s) => s.id !== excludeSessionId)
        .slice(0, MAX_DIGEST_SESSIONS);
      await emit({
        type: "tool_result",
        name: "fetch_session_digests",
        log: `found ${digests.length} sibling session${
          digests.length === 1 ? "" : "s"
        }`,
        sessionIds: digests.map((d) => d.id),
      });
    }
  } catch (err) {
    await emit({
      type: "tool_result",
      name: "fetch_session_digests",
      log: `error: ${err instanceof Error ? err.message : "unknown"}`,
    });
  }

  // Tool 2: deepen on a small set of priority sessions with their last
  // few messages. Default = top digests by recency.
  const recentByPriorityId = new Map<string, RecentMessageRow[]>();
  const targetIds = (
    prioritySessionIds && prioritySessionIds.length > 0
      ? prioritySessionIds
      : digests.slice(0, 3).map((d) => d.id)
  ).slice(0, 3);

  if (targetIds.length > 0) {
    await emit({
      type: "tool_call",
      name: "read_recent_messages",
      label: "Reading recent transcripts",
      args: `sessions=${targetIds.map(shortId).join(",")} limit=${MAX_RECENT_MESSAGES}`,
    });

    try {
      const { data, error } = await supabase
        .from("messages")
        .select("id, session_id, role, content, created_at")
        .in("session_id", targetIds)
        .eq("is_deleted", false)
        .order("created_at", { ascending: false });
      if (error) {
        await emit({
          type: "tool_result",
          name: "read_recent_messages",
          log: `error: ${error.message}`,
        });
      } else {
        for (const row of (data ?? []) as RecentMessageRow[]) {
          const list = recentByPriorityId.get(row.session_id) ?? [];
          if (list.length < MAX_RECENT_MESSAGES) list.push(row);
          recentByPriorityId.set(row.session_id, list);
        }
        for (const sid of targetIds) {
          const got = recentByPriorityId.get(sid) ?? [];
          await emit({
            type: "tool_result",
            name: "read_recent_messages",
            log: `Read session [[${sid}]]: last ${got.length} messages`,
            sessionIds: [sid],
          });
        }
      }
    } catch (err) {
      await emit({
        type: "tool_result",
        name: "read_recent_messages",
        log: `error: ${err instanceof Error ? err.message : "unknown"}`,
      });
    }
  }

  // Tool 3: pull pinned highlights anywhere in the project.
  await emit({
    type: "tool_call",
    name: "pull_pinned_highlights",
    label: "Pulling pinned highlights",
    args: `project=${shortId(projectId)}`,
  });

  let highlights: HighlightDigestRow[] = [];
  try {
    const sessionIdsForHighlights = digests.map((d) => d.id);
    if (excludeSessionId) sessionIdsForHighlights.push(excludeSessionId);
    if (sessionIdsForHighlights.length === 0) {
      await emit({
        type: "tool_result",
        name: "pull_pinned_highlights",
        log: "no sessions in scope yet",
      });
    } else {
      const { data, error } = await supabase
        .from("highlights")
        .select("id, session_id, content, created_at")
        .in("session_id", sessionIdsForHighlights)
        .order("created_at", { ascending: false })
        .limit(MAX_HIGHLIGHTS);
      if (error) {
        await emit({
          type: "tool_result",
          name: "pull_pinned_highlights",
          log: `error: ${error.message}`,
        });
      } else {
        highlights = (data ?? []) as HighlightDigestRow[];
        await emit({
          type: "tool_result",
          name: "pull_pinned_highlights",
          log:
            highlights.length === 0
              ? "no pinned highlights in this project"
              : `found ${highlights.length} pinned highlight${
                  highlights.length === 1 ? "" : "s"
                }`,
          sessionIds: [...new Set(highlights.map((h) => h.session_id))],
        });
      }
    }
  } catch (err) {
    await emit({
      type: "tool_result",
      name: "pull_pinned_highlights",
      log: `error: ${err instanceof Error ? err.message : "unknown"}`,
    });
  }

  await emit({ type: "phase_status", phase: "evidence", status: "done" });

  const surfaced = new Set<string>();
  for (const d of digests) surfaced.add(d.id);
  for (const h of highlights) surfaced.add(h.session_id);
  for (const sid of recentByPriorityId.keys()) surfaced.add(sid);
  if (excludeSessionId) surfaced.delete(excludeSessionId);

  return {
    digests,
    recentByPriorityId,
    highlights,
    surfacedSessionIds: [...surfaced],
  };
}

/**
 * Shortcut helper used by chat: runs the brainstorm pass and returns the
 * raw scratchpad text. The route handler then runs evidence retrieval +
 * the synthesis call itself so it can reuse the existing system prompt.
 */
export async function runDifferentialBrainstorm(args: {
  emit: Emit;
  baseSystem: string;
  recentMessages: ModelMessage[];
  userTurn: string;
}): Promise<string> {
  const { emit, baseSystem, recentMessages, userTurn } = args;

  const system = `${baseSystem}\n\n${DIFFERENTIAL_SYSTEM}`;
  const messages: ModelMessage[] = [
    ...recentMessages,
    { role: "user", content: userTurn },
  ];
  return streamPhase({
    emit,
    phase: "differential",
    system,
    messages,
    maxOutputTokens: 600,
    temperature: 0.6,
  });
}

/**
 * Builds the system + extra context payload for the synthesis phase
 * given a brainstorm and an evidence pack. The route hands these to its
 * own `streamText` call so it can install `onFinish` and persist the
 * assistant message into `messages`.
 */
export function buildSynthesisAugmentation(args: {
  brainstorm: string;
  evidence: AgentEvidencePack;
}): { extraSystem: string } {
  const { brainstorm, evidence } = args;
  const evidencePack = digestPackToMarkdown(evidence);
  const extraSystem = [
    SYNTHESIS_SYSTEM_SUFFIX,
    "",
    "## Differential brainstorm (your own scratchpad — do not repeat verbatim)",
    brainstorm || "(empty)",
    "",
    "## Workspace evidence pack",
    evidencePack,
  ].join("\n");
  return { extraSystem };
}

export { AGENT_PHASE_LABELS };

/**
 * Convenience: builds an `Emit` that writes to a `WritableStreamDefaultWriter`
 * with the event encoder. Used by both /api/sessions/[id]/messages and /api/search.
 */
export function makeEmitter(
  writer: WritableStreamDefaultWriter<Uint8Array>,
  encoder = new TextEncoder()
): Emit {
  return async (event) => {
    try {
      await writer.write(encoder.encode(encodeAgentEvent(event)));
    } catch {
      // Writer closed (client gone). Swallow — caller will release lock
      // via the request abort signal.
    }
  };
}

/** Search variant: full pipeline with both LLM calls, returns the answer text. */
export async function runSearchPipeline(args: {
  emit: Emit;
  supabase: SupabaseClient;
  projectId: string;
  query: string;
}): Promise<{ answer: string; selectedSessionIds: string[]; brainstorm: string }> {
  const { emit, supabase, projectId, query } = args;

  // Phase 1 — brainstorm against the query alone.
  const brainstormSystem = [
    "You are the planning step of a clinical-style cross-session search agent.",
    "Given the user's project-wide question, write a 'differential brainstorm':",
    "  - 2-4 plausible interpretations or angles",
    "  - one open uncertainty",
    "  - a single sentence prefixed with `Plan:` describing the evidence to gather",
    "  - keep it short, no headings, no code blocks",
    "Do NOT answer the question yet.",
  ].join(" ");

  const brainstorm = await streamPhase({
    emit,
    phase: "differential",
    system: brainstormSystem,
    messages: [{ role: "user", content: query }],
    maxOutputTokens: 500,
    temperature: 0.55,
  });

  // Phase 2 — pull evidence (no excluded session for search).
  const evidence = await runEvidenceRetrieval({
    emit,
    supabase,
    projectId,
  });

  // Phase 3 — synthesis.
  const synthSystem = [
    "You answer project-wide questions about a fork-tree chat workspace as the attending physician of a clinical team.",
    "Be concise and factual. Cite supporting sessions inline using [[<session_id>]].",
    "Only cite sessions that appear in the evidence pack. If evidence is weak, say so explicitly and suggest what else to look at.",
    "Format with GitHub-flavored Markdown. Lead with the answer in 1-2 sentences, then go deeper if useful.",
  ].join(" ");

  const evidenceMarkdown = digestPackToMarkdown(evidence);
  const synthesisPrompt = [
    `## User question\n${query}`,
    "",
    "## Differential brainstorm (your own scratchpad — do not repeat verbatim)",
    brainstorm || "(empty)",
    "",
    "## Workspace evidence pack",
    evidenceMarkdown,
  ].join("\n");

  const answer = await streamPhase({
    emit,
    phase: "synthesis",
    system: synthSystem,
    messages: [{ role: "user", content: synthesisPrompt }],
    maxOutputTokens: 1400,
    temperature: 0.3,
  });

  return {
    answer,
    selectedSessionIds: evidence.surfacedSessionIds,
    brainstorm,
  };
}

/**
 * Helper for plain non-streaming brainstorms (kept around in case search
 * ever wants to skip the streaming phase). Currently unused by chat.
 */
export async function quickBrainstorm(args: {
  system: string;
  prompt: string;
}): Promise<string> {
  const openrouter = getOpenRouter();
  const modelId = getOpenRouterChatModelId();
  const { text } = await generateText({
    model: openrouter.chat(modelId),
    system: args.system,
    prompt: args.prompt,
    maxOutputTokens: 500,
    temperature: 0.55,
  });
  return (text ?? "").trim();
}
