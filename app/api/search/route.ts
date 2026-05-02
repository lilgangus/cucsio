import { NextResponse } from "next/server";

// TODO(search PR): given { projectId, query }, single stateless gpt-4o-mini call.
// System prompt = every session's id/label/summary in the project (no embeddings).
// Instruct the model to cite session IDs as [[<id>]]; the UI parses citations
// and links them to the tree.
// See AGENTS.md "LLM prompt rules" → Search.
export async function POST() {
  return NextResponse.json(
    { error: "not_implemented" },
    { status: 501 }
  );
}
