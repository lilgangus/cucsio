import { generateText } from "ai";
import { NextResponse } from "next/server";

import type {
  VisualAgentFinding,
  VisualAgentPlan,
  VisualAgentPlanResponse,
  VisualAgentPlanStep,
  VisualAgentTriggerPayload,
} from "@/lib/agent/visual-plan";
import { getOpenRouter, getOpenRouterChatModelId } from "@/lib/llm/openrouter";

type Body = {
  trigger?: unknown;
  treeSnapshot?: unknown;
};

function clean(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

function asTrigger(value: unknown): VisualAgentTriggerPayload {
  if (!value || typeof value !== "object") return { reason: "agent trigger" };
  const raw = value as Record<string, unknown>;
  const sourceRaw = clean(raw.source, 24);
  const source =
    sourceRaw === "chat" ||
    sourceRaw === "search" ||
    sourceRaw === "tree" ||
    sourceRaw === "prompt"
      ? sourceRaw
      : undefined;
  return {
    reason: clean(raw.reason, 180) || "agent trigger",
    targetPrompt: clean(raw.targetPrompt, 500),
    context: clean(raw.context, 1200),
    source,
  };
}

function extractJson(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }
    throw new Error("model did not return JSON");
  }
}

function normalizeStep(value: unknown): VisualAgentPlanStep | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const label = clean(raw.label, 72);
  const detail = clean(raw.detail, 140);
  if (!label || !detail) return null;
  return { label, detail };
}

function normalizeFinding(value: unknown): VisualAgentFinding | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const label = clean(raw.label, 84);
  const reason = clean(raw.reason, 150);
  if (!label || !reason) return null;
  return { label, reason };
}

function normalizePlan(parsed: unknown): VisualAgentPlan {
  if (!parsed || typeof parsed !== "object") {
    throw new Error("bad plan");
  }
  const raw = parsed as Record<string, unknown>;
  const steps = Array.isArray(raw.steps)
    ? raw.steps.map(normalizeStep).filter((s): s is VisualAgentPlanStep => !!s)
    : [];
  const findings = Array.isArray(raw.findings)
    ? raw.findings
        .map(normalizeFinding)
        .filter((f): f is VisualAgentFinding => !!f)
    : [];

  if (steps.length < 3 || findings.length < 2) {
    throw new Error("model plan too sparse");
  }

  return {
    planSummary:
      clean(raw.planSummary, 140) ||
      "Model generated a traversal plan for the visual agent.",
    steps: steps.slice(0, 5),
    findings: findings.slice(0, 4),
  };
}

export async function POST(req: Request) {
  if (!process.env.OPENROUTER_API_KEY?.trim()) {
    return NextResponse.json(
      { error: "missing OPENROUTER_API_KEY" },
      { status: 503 }
    );
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const trigger = asTrigger(body.trigger);
  const snapshot =
    Array.isArray(body.treeSnapshot) && body.treeSnapshot.length > 0
      ? JSON.stringify(body.treeSnapshot).slice(0, 1600)
      : "[]";

  const prompt = [
    "Return JSON only. Do not use markdown.",
    "You are generating visible agentic work for a hackathon demo inside a fork-tree chat workspace.",
    "Create a compact traversal plan the UI can walk node-by-node.",
    "The plan should feel like an autonomous agent: plan, inspect tools, critique gaps, decide next action, pin findings.",
    "Avoid generic 'target prompt' labels. Make findings concrete, visual, and useful.",
    "",
    "JSON shape:",
    '{"planSummary":"one sentence","steps":[{"label":"short node label","detail":"what the agent checks"}],"findings":[{"label":"Finding: short claim","reason":"why it matters"}]}',
    "",
    "Requirements:",
    "- 3 to 5 steps.",
    "- 2 to 4 findings.",
    "- Include at least one tool/action step and one critique/gap step.",
    "- Keep labels short enough for UI cards.",
    "",
    `Trigger reason: ${trigger.reason}`,
    `Source: ${trigger.source ?? "tree"}`,
    `User target/query: ${trigger.targetPrompt || "(none)"}`,
    `Project context: ${trigger.context || "(none)"}`,
    `Current visual tree snapshot: ${snapshot}`,
  ].join("\n");

  try {
    const { text } = await generateText({
      model: getOpenRouter().chat(getOpenRouterChatModelId()),
      system:
        "You produce terse JSON for a visual agent traversal. No prose outside JSON.",
      prompt,
      maxOutputTokens: 700,
      temperature: 0.55,
    });
    const plan = normalizePlan(extractJson(text ?? ""));
    return NextResponse.json({ plan } satisfies VisualAgentPlanResponse);
  } catch (err) {
    console.warn("[visual-plan] model plan failed", err);
    return NextResponse.json(
      { error: "could not generate visual plan" },
      { status: 502 }
    );
  }
}
