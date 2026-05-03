import { NextResponse } from "next/server";
import { streamText, type ModelMessage } from "ai";

import {
  AGENT_PHASE_LABELS,
  encodeAgentEvent,
  type AgentEvent,
} from "@/lib/llm/agent-events";
import {
  describeAttachments,
  normalizeChatAttachments,
  packMessageContent,
} from "@/lib/chat/attachments";
import {
  buildSynthesisAugmentation,
  makeEmitter,
  runDifferentialBrainstorm,
  runEvidenceRetrieval,
} from "@/lib/llm/agent-pipeline";
import {
  buildTimelineFromEvents,
  serializeTimeline,
} from "@/lib/llm/agent-trace";
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
  attachments?: unknown;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Params = { params: Promise<{ id: string }> };

/**
 * Send one message into a session.
 *
 * Lock protocol unchanged from the prior implementation:
 *   1. Atomically claim the session (`pending_user_id`).
 *   2. Insert the user's message.
 *   3. Run the agent pipeline (differential brainstorm → evidence retrieval
 *      → attending-style synthesis), streaming NDJSON `AgentEvent` lines.
 *   4. Persist the synthesis text + bump counters in the synthesis call's
 *      `onFinish`, then release the lock and emit `done`.
 *
 * Stream body content-type is `text/plain` so existing fetch infra works,
 * but the body is NDJSON; the client parses it via `lib/llm/agent-events`.
 *
 * If the client disconnects, `req.signal` aborts the writer + clears the
 * lock so other users aren't stuck waiting for an unfinished turn.
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
  const attachments = normalizeChatAttachments(body.attachments);
  if (
    (content.length === 0 && attachments.length === 0) ||
    content.length > 8000
  ) {
    return NextResponse.json(
      { error: "content or attachment is required; content max is 8000 chars" },
      { status: 400 }
    );
  }
  const storedUserContent = packMessageContent(content, attachments);
  const attachmentSummary = describeAttachments(attachments);
  const userTurnForPlanning = [
    content,
    attachmentSummary ? `Attachments: ${attachmentSummary}` : null,
  ]
    .filter(Boolean)
    .join("\n");

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

  // Insert the user message + figure out prompt context BEFORE we open
  // the streaming response. If anything in here throws, we 500 cleanly.
  let userMsg: MessageRow;
  let chronological: MessageRow[];
  let baseSystem: string;
  let isFirstUserMessage = false;
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
    isFirstUserMessage =
      !countErr && typeof priorUserCount === "number" && priorUserCount === 0;

    const { data: insertedUser, error: insertUserErr } = await supabase
      .from("messages")
      .insert({
        session_id: sessionId,
        role: "user",
        author_id: clientId,
        content: storedUserContent,
      })
      .select()
      .single();
    if (insertUserErr || !insertedUser) {
      console.error("[/api/sessions/messages] user insert", insertUserErr);
      throw new Error(insertUserErr?.message ?? "could not insert message");
    }
    userMsg = insertedUser as MessageRow;

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
      const branchTitle = labelFromFirstUserMessage(
        content,
        attachmentSummary
      );
      const metaPatch: Record<string, string> = {
        label: branchTitle,
        updated_at: now(),
      };
      if (!(session.session_target ?? "").trim()) {
        metaPatch.session_target = branchTitle;
      }
      if (!(session.summary ?? "").trim()) {
        metaPatch.summary = previewFromFirstUserMessage(
          content,
          attachmentSummary
        );
      }
      await supabase.from("sessions").update(metaPatch).eq("id", sessionId);
    }

    const { data: promptSession } = await supabase
      .from("sessions")
      .select("session_target, smart_context")
      .eq("id", sessionId)
      .maybeSingle();

    const freshTarget = String(
      (promptSession as { session_target?: string } | null)?.session_target ?? ""
    ).trim();
    const sessionTargetForPrompt =
      freshTarget ||
      (isFirstUserMessage
        ? labelFromFirstUserMessage(content, attachmentSummary)
        : "") ||
      (session.session_target ?? "").trim();

    const smartContextForPrompt = String(
      (promptSession as { smart_context?: string } | null)?.smart_context ?? ""
    ).trim();

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
    chronological = ((historyDesc ?? []) as MessageRow[])
      .slice()
      .reverse();

    baseSystem = buildChatSystemPrompt({
      masterContext:
        (projectRow as { master_context?: string } | null)?.master_context ??
        "",
      sessionTarget: sessionTargetForPrompt,
      smartContext: smartContextForPrompt || undefined,
      isNewEmptySession: isFirstUserMessage,
    });
  } catch (e) {
    await releaseLock();
    const message = e instanceof Error ? e.message : "send failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  // -- Stream the agent timeline as NDJSON ----------------------------
  const stream = new TransformStream<Uint8Array, Uint8Array>();
  const writer = stream.writable.getWriter();
  const writerEmit = makeEmitter(writer);
  const encoder = new TextEncoder();
  /** Event log so we can persist the trace alongside the assistant row. */
  const recordedEvents: AgentEvent[] = [];
  const emit = async (event: AgentEvent) => {
    recordedEvents.push(event);
    await writerEmit(event);
  };

  const onClientGone = () => {
    void releaseLock();
    void writer.close().catch(() => {});
  };
  req.signal.addEventListener("abort", onClientGone);

  // Run the pipeline in the background so we can return the response now.
  void (async () => {
    let assistantMessageId: string | null = null;
    try {
      // Already-stored messages, minus the just-inserted user turn (we
      // pass that explicitly to the brainstorm + synthesis calls).
      const priorMessages = chronological.filter((m) => m.id !== userMsg.id);
      const priorAsModel: ModelMessage[] =
        messageRowsToModelMessages(priorMessages);

      // ---- Phase 1: differential brainstorm --------------------------
      const brainstorm = await runDifferentialBrainstorm({
        emit,
        baseSystem,
        recentMessages: priorAsModel,
        userTurn: userTurnForPlanning,
      });

      // ---- Phase 2: evidence retrieval ------------------------------
      const evidence = await runEvidenceRetrieval({
        emit,
        supabase,
        projectId: session.project_id,
        excludeSessionId: sessionId,
      });

      // ---- Phase 3: attending-style synthesis -----------------------
      await emit({
        type: "phase",
        phase: "synthesis",
        label: AGENT_PHASE_LABELS.synthesis,
      });

      const { extraSystem } = buildSynthesisAugmentation({
        brainstorm,
        evidence,
      });
      const synthesisSystem = `${baseSystem}\n\n${extraSystem}`;

      const openrouter = getOpenRouter();
      const chatModelId = getOpenRouterChatModelId();

      const result = streamText({
        model: openrouter.chat(chatModelId),
        system: synthesisSystem,
        messages: messageRowsToModelMessages(chronological),
        maxOutputTokens: 4096,
      });

      let assistantText = "";
      for await (const chunk of result.textStream) {
        if (!chunk) continue;
        assistantText += chunk;
        await emit({ type: "delta", phase: "synthesis", text: chunk });
      }

      const replyText = assistantText.trim() || "(No response text.)";
      let promptTokens: number | null = null;
      let completionTokens: number | null = null;
      try {
        const usage = await result.usage;
        if (usage) {
          promptTokens =
            typeof usage.inputTokens === "number" ? usage.inputTokens : null;
          completionTokens =
            typeof usage.outputTokens === "number"
              ? usage.outputTokens
              : null;
        }
      } catch {
        // Some providers don't return usage; fall through with nulls.
      }

      // Snapshot the timeline so a refresh / new viewer can replay
      // the agent's reasoning under this message. We synthesize from the
      // event log we collected as we streamed; the synthesis phase is
      // not yet marked done at this point, so we close it manually
      // before serializing.
      const timelineForPersist = buildTimelineFromEvents([
        ...recordedEvents,
        { type: "phase_status", phase: "synthesis", status: "done" },
      ]);
      const agentTrace = serializeTimeline(timelineForPersist);

      const { data: insertedAsst, error: insertAsstErr } = await supabase
        .from("messages")
        .insert({
          session_id: sessionId,
          role: "assistant",
          author_id: null,
          content: replyText,
          model: chatModelId,
          prompt_tokens: promptTokens,
          completion_tokens: completionTokens,
          agent_trace: agentTrace,
        })
        .select()
        .single();
      if (insertAsstErr || !insertedAsst) {
        console.error(
          "[/api/sessions/messages] assistant insert",
          insertAsstErr
        );
        throw new Error(
          insertAsstErr?.message ?? "could not insert assistant reply"
        );
      }
      assistantMessageId = (insertedAsst as MessageRow).id;

      await supabase
        .from("sessions")
        .update({
          message_count: session.message_count + 2,
          last_activity_at: now(),
          updated_at: now(),
        })
        .eq("id", sessionId);

      await emit({ type: "phase_status", phase: "synthesis", status: "done" });
    } catch (err) {
      console.error("[/api/sessions/messages] pipeline failed", err);
      try {
        const message = err instanceof Error ? err.message : "agent failed";
        await writer.write(
          encoder.encode(
            encodeAgentEvent({ type: "error", message } as AgentEvent)
          )
        );
      } catch {
        /* writer already closed */
      }
    } finally {
      try {
        await writer.write(
          encoder.encode(
            encodeAgentEvent({
              type: "done",
              assistantMessageId,
            })
          )
        );
      } catch {
        /* writer closed */
      }
      try {
        await writer.close();
      } catch {
        /* already closed */
      }
      await releaseLock();
      req.signal.removeEventListener("abort", onClientGone);
    }
  })();

  return new Response(stream.readable, {
    status: 200,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-content-type-options": "nosniff",
      "x-agent-stream": "v1",
      "X-User-Message-Id": userMsg.id,
    },
  });
}

/** Collapse whitespace and cap length for `sessions.label` / `session_target`. */
function labelFromFirstUserMessage(
  content: string,
  attachmentSummary = ""
): string {
  const line = (content || attachmentSummary).replace(/\s+/g, " ").trim();
  if (!line.length) return "Untitled";
  return line.slice(0, 64);
}

/**
 * Fills `sessions.summary` for the forest node card until a real LLM summary
 * exists (see `/api/summarize`). Uses the first user turn — the same text
 * that started the model call for this session.
 */
function previewFromFirstUserMessage(
  content: string,
  attachmentSummary = "",
  maxLen = 200
): string {
  const line = (content || attachmentSummary).replace(/\s+/g, " ").trim();
  if (!line.length) return "Conversation started";
  return line.length > maxLen ? `${line.slice(0, maxLen - 1)}…` : line;
}
