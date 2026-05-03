import { generateObject, generateText, jsonSchema } from "ai";
import { NextResponse } from "next/server";

import type {
  VisualAgentFinding,
  VisualAgentPlan,
  VisualAgentPlanResponse,
  VisualAgentTreeNode,
  VisualAgentTriggerPayload,
} from "@/lib/agent/visual-plan";
import { getOpenRouter, getOpenRouterChatModelId } from "@/lib/llm/openrouter";

type Body = {
  trigger?: unknown;
};

const DESIRED_TREE_NODES = 4;
const DESIRED_FINDINGS = 2;
const MAX_CONTEXT_CHARS = 4000;
const MAX_FINDING_WORDS = 10;

const visualPlanSchema = jsonSchema<VisualAgentPlan>({
  type: "object",
  additionalProperties: false,
  required: ["planSummary", "tree", "findings"],
  properties: {
    planSummary: {
      type: "string",
      description: "One sentence describing how the agent will traverse.",
    },
    tree: {
      type: "array",
      minItems: 1,
      maxItems: 7,
      description:
        "Content-specific thinking tree. The first node must be the root.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["key", "parentKey", "summary", "detail"],
        properties: {
          key: {
            type: "string",
            description:
              "Short stable key like root, evidence, gap, synthesis.",
          },
          parentKey: {
            anyOf: [{ type: "string" }, { type: "null" }],
            description: "Parent key. Root uses null.",
          },
          summary: {
            type: "string",
            description: "Short node text derived from the user's content.",
          },
          detail: {
            type: "string",
            description: "What the agent is checking or deciding here.",
          },
        },
      },
    },
    findings: {
      type: "array",
      minItems: 1,
      maxItems: 4,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["summary"],
        properties: {
          summary: {
            type: "string",
            description:
              "One compact important takeaway from the content, 6 to 10 words, no label prefix.",
          },
        },
      },
    },
  },
});

function clean(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

function compactFinding(value: unknown): string {
  const summary = clean(value, 90)
    .replace(/^(agent finding|finding|takeaway|insight)\s*[:\-]\s*/i, "")
    .replace(/\s+-\s+.+$/, "")
    .split(/[.!?]/)[0]
    .trim();
  const words = summary.split(/\s+/).filter(Boolean);
  if (words.length <= MAX_FINDING_WORDS) return summary;
  return words.slice(0, MAX_FINDING_WORDS).join(" ");
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
    reason: clean(raw.reason, 160) || "agent trigger",
    targetPrompt: clean(raw.targetPrompt, 500),
    context: clean(raw.context, 1000),
    source,
  };
}

function extractJsonText(text: string): string | null {
  const trimmed = text
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  return trimmed
    .slice(start, end + 1)
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/,\s*([}\]])/g, "$1")
    .replace(/}\s*{/g, "},{");
}

function normalizeTreeNode(value: unknown): VisualAgentTreeNode | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const key = clean(raw.key, 32).replace(/[^a-z0-9_-]/gi, "-") || "";
  const parentKeyRaw = raw.parentKey;
  const parentKey =
    parentKeyRaw === null ? null : clean(parentKeyRaw, 32).replace(/[^a-z0-9_-]/gi, "-");
  const summary = clean(raw.summary, 72);
  const detail = clean(raw.detail, 140);
  if (!key || !summary || !detail) return null;
  return { key, parentKey: parentKey || null, summary, detail };
}

function normalizeFinding(value: unknown): VisualAgentFinding | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const summary = compactFinding(raw.summary);
  if (!summary) return null;
  return { summary };
}

function normalizePlan(parsed: unknown): VisualAgentPlan {
  if (!parsed || typeof parsed !== "object") {
    throw new Error("bad plan");
  }
  const raw = parsed as Record<string, unknown>;
  const tree = Array.isArray(raw.tree)
    ? raw.tree
        .map(normalizeTreeNode)
        .filter((n): n is VisualAgentTreeNode => !!n)
    : [];
  const findings = Array.isArray(raw.findings)
    ? raw.findings
        .map(normalizeFinding)
        .filter((f): f is VisualAgentFinding => !!f)
    : [];

  const planSummary = clean(raw.planSummary, 140);

  if (tree.length === 0 || findings.length === 0 || !planSummary) {
    throw new Error("model plan missing generated content");
  }

  const keys = new Set(tree.map((n) => n.key));
  const normalizedTree = tree.slice(0, 7).map((node, index) => ({
    ...node,
    parentKey:
      index === 0 || !node.parentKey || !keys.has(node.parentKey)
        ? null
        : node.parentKey,
  }));
  normalizedTree[0] = { ...normalizedTree[0], parentKey: null };

  return {
    planSummary,
    tree: normalizedTree,
    findings: findings.slice(0, 4),
  };
}

function isSparsePlan(plan: VisualAgentPlan): boolean {
  return (
    plan.tree.length < DESIRED_TREE_NODES ||
    plan.findings.length < DESIRED_FINDINGS
  );
}

function modelPrompt(trigger: VisualAgentTriggerPayload): string {
  return [
    "Generate a content-specific thinking tree for the visible agent UI.",
    "Use the user's actual query, session target, and project context.",
    "Return concise JSON-compatible content. Do not include reasoning prose outside the object.",
    "Do not output generic labels like target prompt, fallback, template, step 1, or analyze request.",
    "Every tree node summary must be about the content being investigated.",
    "Every tree node detail must describe what the agent checks, decides, or does.",
    "Every finding must capture only the most important content insight.",
    "Findings must be 6 to 10 words, with no prefix like finding, insight, or agent.",
    `Create ${DESIRED_TREE_NODES}-7 tree nodes and ${DESIRED_FINDINGS}-4 findings when the content supports it.`,
    "",
    `Trigger: ${trigger.reason}`,
    `Source: ${trigger.source ?? "tree"}`,
    `User content: ${trigger.targetPrompt || "(none)"}`,
    `Project context: ${trigger.context || "(none)"}`,
  ].join("\n");
}

function expansionPrompt(
  trigger: VisualAgentTriggerPayload,
  sparsePlan: VisualAgentPlan
): string {
  return [
    "Expand this valid but sparse visual agent plan using only the user's content and project context.",
    "Keep the same intent, but make the tree visually rich enough for traversal.",
    "Return structured data only.",
    "Do not invent unrelated facts. Do not use generic labels.",
    "Each finding must be the shortest important takeaway, 6 to 10 words, no prefix.",
    `Target: ${DESIRED_TREE_NODES}-7 content-specific tree nodes and ${DESIRED_FINDINGS}-4 condensed findings.`,
    "",
    `Trigger: ${trigger.reason}`,
    `Source: ${trigger.source ?? "tree"}`,
    `User content: ${trigger.targetPrompt || "(none)"}`,
    `Project context: ${trigger.context || "(none)"}`,
    "",
    "Sparse plan to expand:",
    JSON.stringify(sparsePlan).slice(0, MAX_CONTEXT_CHARS),
  ].join("\n");
}

async function generateVisualPlan(prompt: string): Promise<VisualAgentPlan> {
  const { object } = await generateObject({
    model: getOpenRouter().chat(getOpenRouterChatModelId()),
    schema: visualPlanSchema,
    schemaName: "VisualAgentContentTree",
    schemaDescription:
      "A concise, content-specific thinking tree and one-line findings.",
    system:
      "Return structured data only. Build a tree from the user's content, not from template labels.",
    prompt,
    maxOutputTokens: 3000,
    temperature: 0.25,
    experimental_repairText: async ({ text }) => {
      const { text: repaired } = await generateText({
        model: getOpenRouter().chat(getOpenRouterChatModelId()),
        system:
          "Repair malformed JSON into valid JSON for the schema. Output JSON only.",
        prompt: [
          "Repair this JSON. Preserve all content-specific tree nodes and findings.",
          "Required shape:",
          '{"planSummary":"string","tree":[{"key":"root","parentKey":null,"summary":"string","detail":"string"}],"findings":[{"summary":"string"}]}',
          "Rules: no markdown; close all arrays and objects; escape inner quotes.",
          "",
          text.slice(0, 5000),
        ].join("\n"),
        maxOutputTokens: 2200,
        temperature: 0,
      });
      return extractJsonText(repaired ?? "");
    },
  });

  return normalizePlan(object);
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

  try {
    let plan = await generateVisualPlan(modelPrompt(trigger));
    if (isSparsePlan(plan)) {
      try {
        plan = await generateVisualPlan(expansionPrompt(trigger, plan));
      } catch (err) {
        console.warn("[visual-plan] expansion pass kept initial model plan", err);
      }
    }
    return NextResponse.json({ plan } satisfies VisualAgentPlanResponse);
  } catch (err) {
    console.error("[visual-plan] structured model plan failed", err);
    return NextResponse.json(
      { error: "could not generate content tree" },
      { status: 502 }
    );
  }
}
