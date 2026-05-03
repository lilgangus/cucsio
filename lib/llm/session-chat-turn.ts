import type { ModelMessage } from "ai";

import type { MessageRow } from "@/types/db";

/** Max prior rows (including the new user line) sent to the model. */
export const SESSION_CHAT_HISTORY_LIMIT = 30;

export type BuildChatSystemPromptInput = {
  masterContext: string;
  sessionTarget: string;
  /**
   * True for the first user message in a session that had no messages yet
   * (e.g. brand-new tree). Forks that copy history already have messages.
   */
  isNewEmptySession: boolean;
};

export function buildChatSystemPrompt(
  input: BuildChatSystemPromptInput
): string {
  const { masterContext, sessionTarget, isNewEmptySession } = input;
  const parts: string[] = [
    "You are a helpful assistant in a collaborative team workspace with a shared fork-tree of chats.",
    "Answer clearly and concisely unless the user asks for depth.",
    "Format your replies using GitHub-flavored Markdown when it helps: headings, **bold**, *italic*, bullet/numbered lists, `inline code`, fenced ``` code blocks ```, and tables. Use structure when it adds clarity.",
  ];

  const mc = masterContext.trim();
  if (mc) {
    parts.push(`Shared project instructions (master context):\n${mc}`);
  }

  const st = sessionTarget.trim();
  if (st) {
    parts.push(
      `Session objective for this chat — keep every turn focused on making progress here unless the user clearly pivots:\n${st}`
    );
    if (isNewEmptySession) {
      parts.push(
        "This is a new session created to pursue the session objective above. Briefly acknowledge that focus in your first reply when it fits, then help the user move forward on that objective."
      );
    }
  }

  return parts.join("\n\n");
}

/** Maps stored rows to SDK messages (chronological). */
export function messageRowsToModelMessages(rows: MessageRow[]): ModelMessage[] {
  const out: ModelMessage[] = [];
  for (const m of rows) {
    if (m.is_deleted) continue;
    if (m.role === "user") {
      out.push({ role: "user", content: m.content });
    } else if (m.role === "assistant") {
      out.push({ role: "assistant", content: m.content });
    }
  }
  return out;
}
