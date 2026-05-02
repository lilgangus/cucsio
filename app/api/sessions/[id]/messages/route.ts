import { NextResponse } from "next/server";

import { getClientId } from "@/lib/server/request";
import { getSupabaseServer } from "@/lib/supabase/server";
import type { MessageRow, SessionRow } from "@/types/db";

type Body = {
  content?: unknown;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Params = { params: Promise<{ id: string }> };

/**
 * Send one message into a session.
 *
 * Lock protocol:
 *   1. Atomically claim the session by UPDATEing pending_user_id from
 *      NULL to the caller's clientId. If 0 rows are affected, someone
 *      else is mid-turn — return 409.
 *   2. Insert the user's message.
 *   3. (Eventually: stream the LLM. For now: instant fake echo. The
 *      tiny artificial delay below makes the lock observable in the
 *      UI; remove it once the real streaming call is in place.)
 *   4. Insert the assistant reply.
 *   5. Bump message_count + last_activity_at.
 *   6. Release the lock (always, via finally).
 *
 * Per AGENTS.md don't-forget list: bumps message_count + last_activity_at
 * in the same writer that inserts the messages.
 */
export async function POST(req: Request, ctx: Params) {
  const clientId = getClientId(req);
  if (!clientId) {
    return NextResponse.json(
      { error: "missing or malformed x-client-id header" },
      { status: 401 }
    );
  }

  const { id: sessionId } = await ctx.params;
  if (!UUID_RE.test(sessionId)) {
    return NextResponse.json({ error: "bad session id" }, { status: 400 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const content = typeof body.content === "string" ? body.content.trim() : "";
  if (content.length === 0 || content.length > 8000) {
    return NextResponse.json(
      { error: "content must be 1-8000 chars" },
      { status: 400 }
    );
  }

  const supabase = getSupabaseServer();
  const now = () => new Date().toISOString();

  // 1. Atomic lock acquisition: UPDATE only if pending_user_id is NULL.
  //    Postgres returns the row count of affected rows; we map "no rows"
  //    to a 409 so the client can show "Alice is sending...".
  const { data: locked, error: lockErr } = await supabase
    .from("sessions")
    .update({ pending_user_id: clientId, pending_since: now() })
    .eq("id", sessionId)
    .is("pending_user_id", null)
    .select()
    .maybeSingle();

  if (lockErr) {
    console.error("[/api/sessions/messages] lock error", lockErr);
    return NextResponse.json({ error: lockErr.message }, { status: 500 });
  }
  if (!locked) {
    // Either the session doesn't exist, or someone else holds the lock.
    // Disambiguate with a quick read so we can return a sharper 404.
    const { data: existing } = await supabase
      .from("sessions")
      .select("id, pending_user_id")
      .eq("id", sessionId)
      .maybeSingle();
    if (!existing) {
      return NextResponse.json({ error: "session not found" }, { status: 404 });
    }
    return NextResponse.json(
      {
        error: "another user is currently sending in this session",
        pendingUserId: (existing as { pending_user_id: string | null })
          .pending_user_id,
      },
      { status: 409 }
    );
  }

  const session = locked as SessionRow;
  let userMsg: MessageRow | null = null;
  let assistantMsg: MessageRow | null = null;

  try {
    // 2. Insert the user's message.
    const { data: insertedUser, error: insertUserErr } = await supabase
      .from("messages")
      .insert({
        session_id: sessionId,
        role: "user",
        author_id: clientId,
        content,
      })
      .select()
      .single();
    if (insertUserErr || !insertedUser) {
      console.error("[/api/sessions/messages] user insert", insertUserErr);
      throw new Error(insertUserErr?.message ?? "could not insert message");
    }
    userMsg = insertedUser as MessageRow;

    // 3. Pretend to think. Real streaming would replace this whole block.
    await new Promise((r) => setTimeout(r, 300));

    // 4. Insert the (fake) assistant reply. author_id stays NULL because
    //    the assistant isn't a user. Mirror the user's content for now.
    const { data: insertedAsst, error: insertAsstErr } = await supabase
      .from("messages")
      .insert({
        session_id: sessionId,
        role: "assistant",
        author_id: null,
        content: fakeRespond(content),
        model: "echo-fake",
      })
      .select()
      .single();
    if (insertAsstErr || !insertedAsst) {
      console.error("[/api/sessions/messages] asst insert", insertAsstErr);
      throw new Error(insertAsstErr?.message ?? "could not insert reply");
    }
    assistantMsg = insertedAsst as MessageRow;

    // 5. Bump aggregate counters on the session row.
    await supabase
      .from("sessions")
      .update({
        message_count: session.message_count + 2,
        last_activity_at: now(),
        updated_at: now(),
      })
      .eq("id", sessionId);

    return NextResponse.json({ user: userMsg, assistant: assistantMsg });
  } catch (e) {
    const message = e instanceof Error ? e.message : "send failed";
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    // 6. Always release the lock, even on partial failures, so the
    //    session never wedges. We only release if we still hold it
    //    (defensive — no other writer should touch it, but cheap).
    await supabase
      .from("sessions")
      .update({ pending_user_id: null, pending_since: null })
      .eq("id", sessionId)
      .eq("pending_user_id", clientId);
  }
}

function fakeRespond(prompt: string): string {
  return prompt;
}

export type SendMessageResponse = {
  user: MessageRow;
  assistant: MessageRow;
};
