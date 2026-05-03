import { generateObject, jsonSchema } from "ai";
import { NextResponse } from "next/server";

import type {
  AgentChatFindingsPayload,
  AgentChatFindingsResponse,
  VisualAgentFinding,
} from "@/lib/agent/visual-plan";
import { getOpenRouter, getOpenRouterChatModelId } from "@/lib/llm/openrouter";

type Body = {
  payload?: unknown;
};

const MAX_FINDINGS = 3;
const MAX_FINDING_WORDS = 10;

const findingsSchema = jsonSchema<AgentChatFindingsResponse>({
  type: "object",
  additionalProperties: false,
  required: ["findings"],
  properties: {
    findings: {
      type: "array",
      minItems: 0,
      maxItems: MAX_FINDINGS,
      description:
        "Important answer-grounded findings only. Empty when the answer has no durable content takeaway.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["summary"],
        properties: {
          summary: {
            type: "string",
            description:
              "One factual takeaway from the assistant answer, 5 to 10 words, no prefix.",
          },
        },
      },
    },
  },
});

const PROCESS_WORDS = [
  "active context",
  "branch",
  "checking",
  "citation",
  "completes",
  "displayed",
  "grounded synthesis",
  "session",
  "status",
  "target",
  "tool",
  "travers",
  "verification",
  "visual",
  "workflow",
  "xray verification",
];

function clean(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

function compactFinding(value: unknown): string {
  const summary = clean(value, 100)
    .replace(/^(agent finding|finding|takeaway|insight)\s*[:\-]\s*/i, "")
    .split(/[.!?]/)[0]
    .trim();
  const words = summary.split(/\s+/).filter(Boolean);
  if (words.length <= MAX_FINDING_WORDS) return summary;
  return words.slice(0, MAX_FINDING_WORDS).join(" ");
}

function isUsefulFinding(summary: string): boolean {
  const normalized = summary.toLowerCase();
  const words = normalized.split(/\s+/).filter(Boolean);
  if (words.length < 4) return false;
  if (PROCESS_WORDS.some((word) => normalized.includes(word))) return false;
  if (/^(the )?(image|document|answer|assistant|model)\s+(shows|says|states)/i.test(summary)) {
    return words.length >= 6;
  }
  return true;
}

function asPayload(value: unknown): AgentChatFindingsPayload {
  if (!value || typeof value !== "object") {
    return { userMessage: "", assistantAnswer: "" };
  }
  const raw = value as Record<string, unknown>;
  return {
    userMessage: clean(raw.userMessage, 3000),
    assistantAnswer: clean(raw.assistantAnswer, 5000),
    context: clean(raw.context, 1200),
  };
}

function normalizeFindings(value: unknown): VisualAgentFinding[] {
  if (!value || typeof value !== "object") return [];
  const raw = value as Record<string, unknown>;
  const items = Array.isArray(raw.findings) ? raw.findings : [];
  const seen = new Set<string>();
  const findings: VisualAgentFinding[] = [];

  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const summary = compactFinding((item as Record<string, unknown>).summary);
    const key = summary.toLowerCase();
    if (!summary || seen.has(key) || !isUsefulFinding(summary)) continue;
    seen.add(key);
    findings.push({ summary });
    if (findings.length >= MAX_FINDINGS) break;
  }

  return findings;
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

  const payload = asPayload(body.payload);
  if (!payload.assistantAnswer.trim()) {
    return NextResponse.json({ findings: [] } satisfies AgentChatFindingsResponse);
  }

  const prompt = [
    "Extract only the important findings from the completed chat answer.",
    "The assistant answer is the source of truth. Do not infer from the prompt alone.",
    "Do not produce workflow/status/process findings.",
    "Reject phrases about target prompts, active context, verification, branches, tools, or synthesis status.",
    "If the answer corrects the user's premise, the finding should reflect that correction.",
    "Return an empty findings array when there is no durable factual takeaway.",
    "",
    `User message: ${payload.userMessage || "(none)"}`,
    `Context: ${payload.context || "(none)"}`,
    `Assistant answer: ${payload.assistantAnswer}`,
  ].join("\n");

  try {
    const { object } = await generateObject({
      model: getOpenRouter().chat(getOpenRouterChatModelId()),
      schema: findingsSchema,
      schemaName: "AnswerGroundedFindings",
      schemaDescription:
        "Short important findings grounded in the assistant answer.",
      system:
        "Return structured data only. Findings must come from the assistant answer, not from agent tree planning.",
      prompt,
      maxOutputTokens: 800,
      temperature: 0.1,
    });

    return NextResponse.json({
      findings: normalizeFindings(object),
    } satisfies AgentChatFindingsResponse);
  } catch (err) {
    console.error("[agent-findings] model failed", err);
    return NextResponse.json(
      { error: "could not generate answer findings" },
      { status: 502 }
    );
  }
}
