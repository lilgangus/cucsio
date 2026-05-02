import { NextResponse } from "next/server";
import { generateText } from "ai";

import { CHAT_MODEL, getOpenAI } from "@/lib/llm/openai";
import { getSupabaseServer } from "@/lib/supabase/server";

type Body = {
  projectId?: unknown;
  query?: unknown;
};

type PlannerJSON = {
  searchPlan: string;
  selectedSessionIds: string[];
};

type SearchMessageRow = {
  id: string;
  session_id: string;
  role: string;
  content: string;
  created_at: string;
};

function extractJsonObject(text: string): string | null {
  const fenced = text.match(/```json\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first >= 0 && last > first) return text.slice(first, last + 1).trim();
  return null;
}

function parsePlanner(text: string): PlannerJSON {
  const parsedRaw = extractJsonObject(text);
  if (!parsedRaw) return { searchPlan: "fallback", selectedSessionIds: [] };
  try {
    const parsed = JSON.parse(parsedRaw) as Partial<PlannerJSON>;
    return {
      searchPlan:
        typeof parsed.searchPlan === "string"
          ? parsed.searchPlan
          : "fallback",
      selectedSessionIds: Array.isArray(parsed.selectedSessionIds)
        ? parsed.selectedSessionIds.filter((x): x is string => typeof x === "string")
        : [],
    };
  } catch {
    return { searchPlan: "fallback", selectedSessionIds: [] };
  }
}

function fallbackSelect(
  query: string,
  sessions: { id: string; session_target: string; summary: string }[]
): string[] {
  const keywords = query
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter((x) => x.length > 2);
  if (keywords.length === 0) return sessions.slice(0, 5).map((s) => s.id);
  const scored = sessions.map((session) => {
    const haystack = `${session.session_target} ${session.summary}`.toLowerCase();
    const score = keywords.reduce(
      (sum, keyword) => sum + (haystack.includes(keyword) ? 1 : 0),
      0
    );
    return { id: session.id, score };
  });
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((x) => x.id);
}

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const projectId = typeof body.projectId === "string" ? body.projectId.trim() : "";
  const query = typeof body.query === "string" ? body.query.trim() : "";

  if (!projectId) {
    return NextResponse.json({ error: "projectId is required" }, { status: 400 });
  }
  if (query.length === 0 || query.length > 1000) {
    return NextResponse.json(
      { error: "query must be 1-1000 chars" },
      { status: 400 }
    );
  }

  const supabase = getSupabaseServer();
  const { data: sessions, error: sessionsError } = await supabase
    .from("sessions")
    .select(
      "id, label, session_target, summary, message_count, last_activity_at, is_archived"
    )
    .eq("project_id", projectId)
    .eq("is_archived", false)
    .order("last_activity_at", { ascending: false });

  if (sessionsError) {
    console.error("[/api/search] session fetch failed", sessionsError);
    return NextResponse.json({ error: sessionsError.message }, { status: 500 });
  }
  if (!sessions || sessions.length === 0) {
    return NextResponse.json({
      answer: "No sessions found in this project yet.",
      searchPlan: "none",
      selectedSessionIds: [],
    });
  }

  const sessionDigest = sessions
    .map((s) => {
      const summary = (s.summary || "").slice(0, 1500);
      return [
        `id=${s.id}`,
        `label=${s.label ?? "untitled"}`,
        `target=${s.session_target}`,
        `summary=${summary || "(empty summary)"}`,
      ].join(" | ");
    })
    .join("\n");

  const openai = getOpenAI();

  // Phase 1: "agentic" planning over every node summary/target.
  const planner = await generateText({
    model: openai(CHAT_MODEL),
    system: [
      "You are a search planner for a fork-tree chat workspace.",
      "You receive all session nodes as summaries. Pick the sessions that are most likely to contain evidence for the query.",
      "Return STRICT JSON only: {\"searchPlan\": string, \"selectedSessionIds\": string[]}",
      "Select at most 6 session IDs. Prefer precision over recall.",
    ].join(" "),
    prompt: [
      `Query:\n${query}`,
      "",
      "Session digests:",
      sessionDigest,
    ].join("\n"),
    maxOutputTokens: 500,
  });

  const parsedPlanner = parsePlanner(planner.text);
  const validIds = new Set(sessions.map((s) => s.id));
  let selectedSessionIds = parsedPlanner.selectedSessionIds.filter((id) =>
    validIds.has(id)
  );
  if (selectedSessionIds.length === 0) {
    selectedSessionIds = fallbackSelect(query, sessions).filter((id) =>
      validIds.has(id)
    );
  }
  selectedSessionIds = selectedSessionIds.slice(0, 6);

  // Phase 2: inject deeper context from selected nodes (recent messages).
  let contextBlocks: string[] = [];
  if (selectedSessionIds.length > 0) {
    const { data: selectedMessages, error: messagesError } = await supabase
      .from("messages")
      .select("id, session_id, role, content, created_at")
      .in("session_id", selectedSessionIds)
      .eq("is_deleted", false)
      .order("created_at", { ascending: false });
    if (messagesError) {
      console.error("[/api/search] message fetch failed", messagesError);
    } else {
      const bySession = new Map<string, SearchMessageRow[]>();
      for (const row of (selectedMessages ?? []) as SearchMessageRow[]) {
        const list = bySession.get(row.session_id) ?? [];
        if (list.length < 8) list.push(row);
        bySession.set(row.session_id, list);
      }
      contextBlocks = sessions
        .filter((s) => selectedSessionIds.includes(s.id))
        .map((session) => {
          const recent = (bySession.get(session.id) ?? [])
            .reverse()
            .map(
              (m) =>
                `- (${m.role}) ${m.content.replace(/\s+/g, " ").slice(0, 300)}`
            )
            .join("\n");
          return [
            `SESSION [[${session.id}]]`,
            `label: ${session.label ?? "untitled"}`,
            `target: ${session.session_target}`,
            `summary: ${session.summary || "(empty summary)"}`,
            `recent_messages:\n${recent || "- (none)"}`,
          ].join("\n");
        });
    }
  }

  const answer = await generateText({
    model: openai(CHAT_MODEL),
    system: [
      "You answer project-wide questions about a fork-tree chat workspace.",
      "You must be concise and factual.",
      "Cite supporting sessions using [[<session_id>]].",
      "Only cite sessions present in the provided context.",
      "If evidence is weak, say so explicitly.",
    ].join(" "),
    prompt: [
      `User query:\n${query}`,
      "",
      `Planner rationale:\n${parsedPlanner.searchPlan}`,
      "",
      "Focused context from selected sessions:",
      contextBlocks.join("\n\n---\n\n"),
    ].join("\n"),
    maxOutputTokens: 1400,
  });

  return NextResponse.json({
    answer: answer.text,
    searchPlan: parsedPlanner.searchPlan,
    selectedSessionIds,
  });
}
