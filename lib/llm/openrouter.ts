import "server-only";

import { createOpenAI } from "@ai-sdk/openai";

/** Default: small Nemotron on OpenRouter free tier (override via `OPENROUTER_CHAT_MODEL`). */
export const OPENROUTER_DEFAULT_CHAT_MODEL =
  "nvidia/nemotron-nano-9b-v2:free" as const;

let cached: ReturnType<typeof createOpenAI> | null = null;

export function getOpenRouterChatModelId(): string {
  return (
    process.env.OPENROUTER_CHAT_MODEL?.trim() || OPENROUTER_DEFAULT_CHAT_MODEL
  );
}

/**
 * OpenRouter exposes an OpenAI-compatible **chat completions** API. We reuse
 * `@ai-sdk/openai` with a custom `baseURL`. Call `getOpenRouter().chat(modelId)`
 * from route handlers — the default `provider(modelId)` uses OpenAI's
 * Responses API, which OpenRouter does not support.
 */
export function getOpenRouter() {
  if (cached) return cached;
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Missing OPENROUTER_API_KEY. Copy .env.example to .env.local and set your key from https://openrouter.ai/keys"
    );
  }
  const referer =
    process.env.OPENROUTER_HTTP_REFERER?.trim() ||
    (process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "http://localhost:3000");

  cached = createOpenAI({
    apiKey,
    baseURL: "https://openrouter.ai/api/v1",
    headers: {
      "HTTP-Referer": referer,
      "X-Title": "cucsio",
    },
  });
  return cached;
}
