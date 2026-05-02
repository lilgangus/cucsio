import { NextResponse } from "next/server";

// TODO(summary PR): given { sessionId }, load all messages, summarize via
// gpt-4o-mini in <=200 tokens, write to sessions.summary, broadcast a
// session_updated event on `project:{id}`.
// Trigger: on fork, and whenever sessions.message_count crosses a multiple of 10.
// See AGENTS.md "LLM prompt rules" → Summary regeneration.
export async function POST() {
  return NextResponse.json(
    { error: "not_implemented" },
    { status: 501 }
  );
}
