import "server-only";

import { createOpenAI } from "@ai-sdk/openai";

/**
 * Singleton OpenAI provider configured for the hackathon. We use
 * `gpt-4o-mini` everywhere (chat, summaries, search) — the 128k window
 * has plenty of headroom for the simple stuffing strategy described
 * in AGENTS.md, so we don't bother counting tokens.
 *
 * Real prompt builders (history + master_context + ancestor summaries
 * for chat, project-wide session summary list for search, etc.) belong
 * in sibling files in this directory.
 */

export const CHAT_MODEL = "gpt-4o-mini" as const;

let cached: ReturnType<typeof createOpenAI> | null = null;

export function getOpenAI() {
  if (cached) return cached;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Missing OPENAI_API_KEY. Copy .env.example to .env.local and fill it in."
    );
  }
  cached = createOpenAI({ apiKey });
  return cached;
}
