import { NextResponse } from "next/server";

import { markdownToPlainText } from "@/lib/markdown-plain";
import { getClientId } from "@/lib/server/request";
import { getSupabaseServer } from "@/lib/supabase/server";
import type { HighlightRow } from "@/types/db";

type Body = {
  sessionId?: unknown;
  messageId?: unknown;
  content?: unknown;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function normalizeWs(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function snippetMatchesMessage(
  snippet: string,
  messageBody: string,
  role: string
): boolean {
  const sn = snippet.trim();
  if (sn.length === 0) return false;
  if (messageBody.includes(sn)) return true;
  if (normalizeWs(messageBody).includes(normalizeWs(sn))) return true;

  // Assistant bubbles render Markdown; selection is plain text from the DOM.
  if (role === "assistant") {
    const plain = markdownToPlainText(messageBody);
    if (plain.includes(sn)) return true;
    if (normalizeWs(plain).includes(normalizeWs(sn))) return true;
  }

  return false;
}

/**
 * Pin a substring from a chat message to the project highlights board.
 */
export async function POST(req: Request) {
  const clientId = getClientId(req);
  if (!clientId) {
    return NextResponse.json(
      { error: "missing or malformed x-client-id header" },
      { status: 401 }
    );
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
  const messageId = typeof body.messageId === "string" ? body.messageId : "";
  const content =
    typeof body.content === "string" ? body.content.trim() : "";

  if (!UUID_RE.test(sessionId) || !UUID_RE.test(messageId)) {
    return NextResponse.json(
      { error: "sessionId and messageId must be UUIDs" },
      { status: 400 }
    );
  }
  if (content.length === 0 || content.length > 8000) {
    return NextResponse.json(
      { error: "content (snippet) must be 1-8000 chars" },
      { status: 400 }
    );
  }

  const supabase = getSupabaseServer();

  const { data: message, error: msgErr } = await supabase
    .from("messages")
    .select("id, session_id, content, is_deleted, role")
    .eq("id", messageId)
    .maybeSingle();

  if (msgErr || !message) {
    return NextResponse.json({ error: "message not found" }, { status: 404 });
  }

  const row = message as {
    session_id: string;
    content: string;
    is_deleted: boolean;
    role: string;
  };

  if (row.is_deleted || row.session_id !== sessionId) {
    return NextResponse.json(
      { error: "message does not belong to this session" },
      { status: 400 }
    );
  }

  if (!snippetMatchesMessage(content, row.content, row.role)) {
    return NextResponse.json(
      {
        error:
          "selection does not appear in the stored message text (try a shorter selection if you edited formatting)",
      },
      { status: 400 }
    );
  }

  const { data: inserted, error: insErr } = await supabase
    .from("highlights")
    .insert({
      session_id: sessionId,
      message_id: messageId,
      content,
      source: "user",
      created_by: clientId,
    })
    .select()
    .single();

  if (insErr || !inserted) {
    console.error("[POST /api/highlights]", insErr);
    return NextResponse.json(
      { error: insErr?.message ?? "could not create highlight" },
      { status: 500 }
    );
  }

  return NextResponse.json({ highlight: inserted as HighlightRow });
}
