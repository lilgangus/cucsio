import { NextResponse } from "next/server";
import { streamText } from "ai";

import {
  buildChatSystemPrompt,
  messageRowsToModelMessages,
  SESSION_CHAT_HISTORY_LIMIT,
} from "@/lib/llm/session-chat-turn";
import { getOpenRouter, getOpenRouterChatModelId } from "@/lib/llm/openrouter";
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
 *   1. Atomically claim the session (pending_user_id).
 *   2. Insert the user's message.
 *   3. Stream the assistant via OpenRouter (`streamText`) — response body is
 *      `text/plain` chunks. Persist the full assistant row + bump counters in
 *      `onFinish`, then release the lock. `onError` also releases the lock.
 *
 * If the client disconnects before the stream finishes, `onFinish` may never
 * run — always listen on `req.signal` so we clear `pending_user_id`.
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

  if (!process.env.OPENROUTER_API_KEY?.trim()) {
    return NextResponse.json(
      {
        error:
          "Server is missing OPENROUTER_API_KEY. Add it to .env.local (see .env.example).",
      },
      { status: 503 }
    );
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
  let lockReleased = false;
  const releaseLock = async () => {
    if (lockReleased) return;
    lockReleased = true;
    await supabase
      .from("sessions")
      .update({ pending_user_id: null, pending_since: null })
      .eq("id", sessionId)
      .eq("pending_user_id", clientId);
  };

  const onClientGone = () => {
    void releaseLock();
  };
  req.signal.addEventListener("abort", onClientGone);

  try {
    const { count: priorUserCount, error: countErr } = await supabase
      .from("messages")
      .select("*", { count: "exact", head: true })
      .eq("session_id", sessionId)
      .eq("role", "user")
      .eq("is_deleted", false);
    if (countErr) {
      console.error("[/api/sessions/messages] user-count", countErr);
    }
    const isFirstUserMessage =
      !countErr && typeof priorUserCount === "number" && priorUserCount === 0;

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
    const userMsg = insertedUser as MessageRow;

    const { data: projectRow, error: projectErr } = await supabase
      .from("projects")
      .select("master_context")
      .eq("id", session.project_id)
      .maybeSingle();
    if (projectErr) {
      console.error("[/api/sessions/messages] project fetch", projectErr);
      throw new Error(projectErr.message);
    }

    if (isFirstUserMessage) {
      const branchTitle = labelFromFirstUserMessage(content);
      const metaPatch: Record<string, string> = {
        label: branchTitle,
        updated_at: now(),
      };
      if (!(session.session_target ?? "").trim()) {
        metaPatch.session_target = branchTitle;
      }
      if (!(session.summary ?? "").trim()) {
        metaPatch.summary = previewFromFirstUserMessage(content);
      }
      await supabase.from("sessions").update(metaPatch).eq("id", sessionId);
    }

    const sessionTargetForPrompt =
      isFirstUserMessage && !(session.session_target ?? "").trim()
        ? labelFromFirstUserMessage(content)
        : (session.session_target ?? "").trim();

    const { data: historyDesc, error: histErr } = await supabase
      .from("messages")
      .select("*")
      .eq("session_id", sessionId)
      .eq("is_deleted", false)
      .order("created_at", { ascending: false })
      .limit(SESSION_CHAT_HISTORY_LIMIT);
    if (histErr) {
      console.error("[/api/sessions/messages] history fetch", histErr);
      throw new Error(histErr.message);
    }
    const chronological = ((historyDesc ?? []) as MessageRow[])
      .slice()
      .reverse();

    const openrouter = getOpenRouter();
    const chatModelId = getOpenRouterChatModelId();
    const system = buildChatSystemPrompt({
      masterContext:
        (projectRow as { master_context?: string } | null)?.master_context ??
        "",
      sessionTarget: sessionTargetForPrompt,
      isNewEmptySession: isFirstUserMessage,
    });

    const result = streamText({
      model: openrouter.chat(chatModelId),
      system,
      messages: messageRowsToModelMessages(chronological),
      maxOutputTokens: 4096,
      async onFinish({ text, usage }) {
        try {
          const replyText = (text ?? "").trim() || "(No response text.)";
          let promptTokens: number | null = null;
          let completionTokens: number | null = null;
          if (usage) {
            promptTokens =
              typeof usage.inputTokens === "number" ? usage.inputTokens : null;
            completionTokens =
              typeof usage.outputTokens === "number"
                ? usage.outputTokens
                : null;
          }
          const { error: insertAsstErr } = await supabase.from("messages")
            .insert({
              session_id: sessionId,
              role: "assistant",
              author_id: null,
              content: replyText,
              model: chatModelId,
              prompt_tokens: promptTokens,
              completion_tokens: completionTokens,
            });
          if (insertAsstErr) {
            console.error(
              "[/api/sessions/messages] assistant insert",
              insertAsstErr
            );
            throw new Error(insertAsstErr.message);
          }

          await supabase
            .from("sessions")
            .update({
              message_count: session.message_count + 2,
              last_activity_at: now(),
              updated_at: now(),
            })
            .eq("id", sessionId);
        } catch (e) {
          console.error("[/api/sessions/messages] onFinish persist failed", e);
        } finally {
          await releaseLock();
        }
      },
      onError: ({ error }) => {
        console.error("[/api/sessions/messages] streamText", error);
        void releaseLock();
      },
    });

    return result.toTextStreamResponse({
      headers: {
        "X-User-Message-Id": userMsg.id,
      },
    });
  } catch (e) {
    await releaseLock();
    const message = e instanceof Error ? e.message : "send failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** Collapse whitespace and cap length for `sessions.label` / `session_target`. */
function labelFromFirstUserMessage(content: string): string {
  const line = content.replace(/\s+/g, " ").trim();
  if (!line.length) return "Untitled";
  return line.slice(0, 64);
}

/**
 * Fills `sessions.summary` for the forest node card until a real LLM summary
 * exists (see `/api/summarize`). Uses the first user turn — the same text
 * that started the model call for this session.
 */
function previewFromFirstUserMessage(content: string, maxLen = 200): string {
  const line = content.replace(/\s+/g, " ").trim();
  if (!line.length) return "Conversation started";
  return line.length > maxLen ? `${line.slice(0, maxLen - 1)}…` : line;
}
