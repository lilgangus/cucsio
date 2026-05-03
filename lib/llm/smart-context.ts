import "server-only";

import { generateText } from "ai";
import type { SupabaseClient } from "@supabase/supabase-js";

import { messageTextForPrompt } from "@/lib/chat/attachments";
import { getOpenRouter, getOpenRouterChatModelId } from "@/lib/llm/openrouter";

const MAX_ANCESTOR_NODES = 12;
const MAX_ASSISTANT_SNIPPETS = 4;
const MAX_USER_SNIPPETS = 2;
const SNIPPET_CHARS = 500;
const MAX_SUMMARY_CHARS = 2000;
const MAX_PACK_CHARS = 26_000;
const MAX_FINAL_CHARS = 6_000;

type StructuredUpstreamSession = {
  id: string;
  label: string;
  session_target: string;
  summary: string;
  assistantExcerpts: string[];
  /** Short capture of what the user asked (helps locale/topic like “Corvallis food”). */
  userAskLines: string[];
};

/**
 * Walk parents upward from immediate parent(s) using `session_parents` and
 * `parent_session_id` (BFS). Closest ancestors first in the returned array.
 */
async function collectAncestorIds(
  supabase: SupabaseClient,
  seedIds: string[],
  maxNodes: number
): Promise<string[]> {
  const seen = new Set<string>();
  const ordered: string[] = [];
  let frontier = [...new Set(seedIds)].filter(Boolean);

  while (frontier.length > 0 && ordered.length < maxNodes) {
    const layer: string[] = [];
    for (const id of frontier) {
      if (seen.has(id)) continue;
      seen.add(id);
      layer.push(id);
    }
    if (layer.length === 0) break;

    for (const id of layer) {
      if (ordered.length >= maxNodes) break;
      ordered.push(id);
    }
    if (ordered.length >= maxNodes) return ordered.slice(0, maxNodes);

    const { data: edges } = await supabase
      .from("session_parents")
      .select("parent_id")
      .in("session_id", layer);
    const { data: rows } = await supabase
      .from("sessions")
      .select("parent_session_id")
      .in("id", layer);

    const next = new Set<string>();
    for (const e of edges ?? []) {
      if (e.parent_id) next.add(e.parent_id);
    }
    for (const r of rows ?? []) {
      if (r.parent_session_id) next.add(r.parent_session_id);
    }
    frontier = [...next].filter((id) => !seen.has(id));
  }
  return ordered;
}

function clampContent(text: string, max: number): string {
  const t = messageTextForPrompt(text).replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

/**
 * Loads summaries, session purposes, recent assistant excerpts, and short
 * user-question lines (topics/locale) — not a full transcript.
 */
async function buildUpstreamMaterial(
  supabase: SupabaseClient,
  sessionIdsRootFirst: string[]
): Promise<{ pack: string; structured: StructuredUpstreamSession[] }> {
  const structured: StructuredUpstreamSession[] = [];
  const blocks: string[] = [];

  for (const sid of sessionIdsRootFirst) {
    const { data: s } = await supabase
      .from("sessions")
      .select("id, label, session_target, summary")
      .eq("id", sid)
      .maybeSingle();
    if (!s) continue;

    const label = (s as { label?: string | null }).label?.trim() || "(untitled)";
    const target = String(
      (s as { session_target?: string }).session_target ?? ""
    ).trim();
    const summary = clampContent(
      String((s as { summary?: string }).summary ?? ""),
      MAX_SUMMARY_CHARS
    );

    const { data: assistantMsgs } = await supabase
      .from("messages")
      .select("content")
      .eq("session_id", sid)
      .eq("role", "assistant")
      .eq("is_deleted", false)
      .order("created_at", { ascending: false })
      .limit(MAX_ASSISTANT_SNIPPETS);

    const snippets = (assistantMsgs ?? [])
      .map((m) =>
        clampContent(String((m as { content: string }).content), SNIPPET_CHARS)
      )
      .filter(Boolean);

    const { data: userMsgs } = await supabase
      .from("messages")
      .select("content")
      .eq("session_id", sid)
      .eq("role", "user")
      .eq("is_deleted", false)
      .order("created_at", { ascending: false })
      .limit(MAX_USER_SNIPPETS);

    const userAskLines = (userMsgs ?? [])
      .map((m) =>
        clampContent(String((m as { content: string }).content), 220)
      )
      .filter(Boolean);

    structured.push({
      id: sid,
      label,
      session_target: target,
      summary,
      assistantExcerpts: snippets,
      userAskLines,
    });

    const snippetBlock =
      snippets.length > 0
        ? snippets.map((t, i) => `  ${i + 1}. ${t}`).join("\n")
        : "  (none)";

    const userBlock =
      userAskLines.length > 0
        ? userAskLines.map((t, i) => `  ${i + 1}. ${t}`).join("\n")
        : "  (none)";

    blocks.push(
      [
        `### Session ${sid.slice(0, 8)}… — ${label}`,
        `- Purpose (session target): ${target || "(none)"}`,
        `- Stored summary: ${summary || "(empty)"}`,
        `- Recent user questions / asks (short):`,
        userBlock,
        `- Recent assistant outputs (excerpts):`,
        snippetBlock,
      ].join("\n")
    );
  }

  return {
    pack: blocks.join("\n\n---\n\n"),
    structured,
  };
}

function clampString(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

function fallbackMarkdown(structured: StructuredUpstreamSession[]): string {
  if (structured.length === 0) return "";

  const lines: string[] = [
    "## Key details from prior sessions",
    "",
    "_Automatically summarized from upstream session targets and summaries (LLM step was unavailable or returned empty)._",
    "",
  ];

  for (const u of structured) {
    const has =
      u.summary.trim() ||
      u.session_target.trim() ||
      u.assistantExcerpts.length > 0 ||
      u.userAskLines.length > 0;
    if (!has) continue;

    lines.push(`### ${u.label}`);
    if (u.session_target.trim()) {
      lines.push(`- **Session focus:** ${u.session_target}`);
    }
    if (u.userAskLines.length > 0) {
      lines.push(
        `- **User asked about:** ${u.userAskLines.join(" · ")}`
      );
    }
    if (u.summary.trim()) {
      lines.push(`- **Recorded summary:** ${u.summary}`);
    }
    for (let i = 0; i < Math.min(2, u.assistantExcerpts.length); i++) {
      lines.push(`- **Prior assistant note:** ${u.assistantExcerpts[i]}`);
    }
    lines.push("");
  }

  return clampString(lines.join("\n").trim(), MAX_FINAL_CHARS);
}

const SYNTH_SYSTEM = [
  "You create the block \"Key details from prior sessions\" for a NEW branch chat.",
  "Input describes upstream sessions: each has a purpose (session target), an optional stored summary, short user asks, and short assistant excerpts.",
  "Your output MUST:",
  "- Start with exactly: ## Key details from prior sessions",
  "- Then bullet lists (and optional ### subsections) with concrete, transferable facts: names, places, recommendations, decisions, constraints, open questions.",
  "Rules:",
  "- If the NEW BRANCH GOAL is specific, prioritize facts that help that goal. If it is broad (e.g. general exploration), still summarize the main topics and concrete facts from upstream — do NOT output an empty or useless section when upstream has substantive summaries or excerpts.",
  "- Never paste raw chat transcripts. Paraphrase into bullets.",
  "- Do not invent venues, facts, or URLs that are not supported by the upstream material.",
  "- If upstream material is thin, write fewer bullets but never skip the heading.",
].join("\n");

async function synthesizeKeyDetails(args: {
  branchGoal: string;
  pack: string;
}): Promise<string> {
  const modelId = getOpenRouterChatModelId();
  const openrouter = getOpenRouter();

  const { text } = await generateText({
    model: openrouter.chat(modelId),
    system: SYNTH_SYSTEM,
    prompt: [
      `## New branch goal / session target\n${args.branchGoal}`,
      "",
      "## Upstream sessions (use only this material)",
      args.pack || "(empty)",
    ].join("\n"),
    maxOutputTokens: 2200,
    temperature: 0.25,
  });

  const out = (text ?? "").trim();
  if (!out || out.length < 12) return "";
  if (!out.includes("Key details from prior sessions")) {
    return clampString(
      `## Key details from prior sessions\n\n${out}`,
      MAX_FINAL_CHARS
    );
  }
  return clampString(out, MAX_FINAL_CHARS);
}

function pickSmartContext(
  synthesized: string,
  structured: StructuredUpstreamSession[]
): string {
  const syn = synthesized.trim();
  const hasHeading = syn.includes("Key details from prior sessions");
  if (syn.length >= 25 && (hasHeading || syn.includes("\n-"))) return syn;
  const fb = fallbackMarkdown(structured);
  return fb;
}

/**
 * Builds `sessions.smart_context` for a new child session from ancestor
 * sessions (targets, summaries, excerpts). Always prefers LLM synthesis; falls
 * back to structured Markdown if the model returns nothing.
 */
export async function computeAndSaveSmartContext(
  supabase: SupabaseClient,
  args: {
    childSessionId: string;
    seedParentIds: string[];
    sessionTarget: string;
  }
): Promise<void> {
  const { childSessionId, seedParentIds, sessionTarget } = args;
  const seeds = [...new Set(seedParentIds)].filter(Boolean);
  if (seeds.length === 0) return;

  if (!process.env.OPENROUTER_API_KEY?.trim()) {
    console.warn("[smart-context] OPENROUTER_API_KEY missing; skipping LLM");
    try {
      const closestFirst = await collectAncestorIds(
        supabase,
        seeds,
        MAX_ANCESTOR_NODES
      );
      const rootFirst = closestFirst.slice().reverse();
      const { structured } = await buildUpstreamMaterial(supabase, rootFirst);
      const fb = fallbackMarkdown(structured);
      if (fb) {
        await supabase
          .from("sessions")
          .update({
            smart_context: fb,
            updated_at: new Date().toISOString(),
          })
          .eq("id", childSessionId);
      }
    } catch (e) {
      console.error("[smart-context] fallback-only save failed", e);
    }
    return;
  }

  try {
    const closestFirst = await collectAncestorIds(
      supabase,
      seeds,
      MAX_ANCESTOR_NODES
    );
    const rootFirst = closestFirst.slice().reverse();

    const { pack: rawPack, structured } = await buildUpstreamMaterial(
      supabase,
      rootFirst
    );
    const pack = clampString(rawPack, MAX_PACK_CHARS);

    const branchGoal =
      sessionTarget.trim() || "General exploration";

    let synthesized = "";
    try {
      synthesized = await synthesizeKeyDetails({
        branchGoal,
        pack,
      });
    } catch (e) {
      console.error("[smart-context] synthesize failed", e);
    }

    const smart = pickSmartContext(synthesized, structured);

    await supabase
      .from("sessions")
      .update({
        smart_context: smart,
        updated_at: new Date().toISOString(),
      })
      .eq("id", childSessionId);
  } catch (e) {
    console.error("[smart-context] compute failed", e);
  }
}
