import { NextResponse } from "next/server";
import { CLIENT_ID_HEADER } from "@/lib/identity";
import {
  PROJECT_BROADCAST_EVENT,
  SESSION_BROADCAST_EVENT,
  projectChannel,
  sessionChannel,
  type ProjectEvent,
  type SessionEvent,
} from "@/lib/realtime/channels";
import { getSupabaseServer } from "@/lib/supabase/server";
import type { MessageRow, SessionRow } from "@/types/db";

const ASSISTANT_REPLY =
  "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed non dui eget nunc congue pulvinar. " +
  "Vivamus feugiat, sapien a tincidunt ultrices, mi augue efficitur sapien, vitae luctus nisi justo sit amet nisl. " +
  "Curabitur finibus orci ut erat dapibus, vitae volutpat ligula faucibus. Integer et porta justo. " +
  "Suspendisse potenti. Praesent euismod, augue in faucibus blandit, tortor orci posuere velit, " +
  "vitae cursus velit ipsum vel orci.";

const burstTimers = new Map<string, ReturnType<typeof setTimeout>>();

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function splitIntoChunks(content: string, count: number): string[] {
  const size = Math.ceil(content.length / count);
  const chunks: string[] = [];

  for (let index = 0; index < content.length; index += size) {
    chunks.push(content.slice(index, index + size));
  }

  return chunks;
}

async function broadcastSessionEvent(sessionId: string, event: SessionEvent) {
  const supabase = getSupabaseServer();
  const channel = supabase.channel(sessionChannel(sessionId));

  try {
    await channel.send({
      type: "broadcast",
      event: SESSION_BROADCAST_EVENT,
      payload: event,
    });
  } finally {
    void supabase.removeChannel(channel);
  }
}

async function broadcastProjectEvent(projectId: string, event: ProjectEvent) {
  const supabase = getSupabaseServer();
  const channel = supabase.channel(projectChannel(projectId));

  try {
    await channel.send({
      type: "broadcast",
      event: PROJECT_BROADCAST_EVENT,
      payload: event,
    });
  } finally {
    void supabase.removeChannel(channel);
  }
}

async function syncSessionMetadata(
  sessionId: string,
  projectId: string,
  patch: Partial<Pick<SessionRow, "pending_user_id" | "pending_since">> = {}
) {
  const supabase = getSupabaseServer();
  const now = new Date().toISOString();
  const { count, error: countError } = await supabase
    .from("messages")
    .select("*", { count: "exact", head: true })
    .eq("session_id", sessionId)
    .eq("is_deleted", false);

  if (countError) {
    throw countError;
  }

  const { data: session, error: updateError } = await supabase
    .from("sessions")
    .update({
      message_count: count ?? 0,
      last_activity_at: now,
      updated_at: now,
      ...patch,
    })
    .eq("id", sessionId)
    .select("id, label, summary, last_activity_at, message_count")
    .single<Pick<
      SessionRow,
      "id" | "label" | "summary" | "last_activity_at" | "message_count"
    >>();

  if (updateError) {
    throw updateError;
  }

  await broadcastProjectEvent(projectId, {
    type: "session_updated",
    session,
  });
}

async function trySyncSessionMetadata(
  sessionId: string,
  projectId: string,
  patch: Partial<Pick<SessionRow, "pending_user_id" | "pending_since">> = {}
) {
  try {
    await syncSessionMetadata(sessionId, projectId, patch);
  } catch (error) {
    console.warn("[/api/messages] session metadata sync failed", error);
  }
}

async function runAssistantBurst(sessionId: string, projectId: string) {
  const supabase = getSupabaseServer();
  const tmpId = crypto.randomUUID();
  const chunks = splitIntoChunks(ASSISTANT_REPLY, 12);

  // Temp mock-route limitation: broadcast chunks in raw arrival order.
  // Swapping two sends on purpose lets the client tolerate mild
  // out-of-order delivery without trying to re-sequence tmpId streams.
  if (chunks.length > 3) {
    [chunks[2], chunks[3]] = [chunks[3], chunks[2]];
  }

  try {
    for (const chunk of chunks) {
      await broadcastSessionEvent(sessionId, {
        type: "assistant_chunk",
        sessionId,
        tmpId,
        delta: chunk,
      });
      await sleep(80);
    }

    const { data: assistantRow, error: assistantInsertError } = await supabase
      .from("messages")
      .insert({
        session_id: sessionId,
        role: "assistant",
        author_id: null,
        content: ASSISTANT_REPLY,
        model: "gpt-4o-mini",
      })
      .select("*")
      .single<MessageRow>();

    if (assistantInsertError) {
      throw assistantInsertError;
    }

    await broadcastSessionEvent(sessionId, {
      type: "assistant_done",
      message: assistantRow,
    });
    await trySyncSessionMetadata(sessionId, projectId, {
      pending_user_id: null,
      pending_since: null,
    });
  } catch (error) {
    await broadcastSessionEvent(sessionId, {
      type: "stream_error",
      sessionId,
      tmpId,
      error: error instanceof Error ? error.message : "Unknown stream failure",
    });
    await trySyncSessionMetadata(sessionId, projectId, {
      pending_user_id: null,
      pending_since: null,
    });
  }
}

function scheduleAssistantBurst(sessionId: string, projectId: string) {
  const existingTimer = burstTimers.get(sessionId);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }

  const timer = setTimeout(() => {
    burstTimers.delete(sessionId);
    void runAssistantBurst(sessionId, projectId);
  }, 500);

  burstTimers.set(sessionId, timer);
}

// TODO: REMOVE WHEN DEV A SHIPS THE REAL ROUTE
// This route is a temporary stand-in so the chat transport can be wired and
// smoke-tested before the real debounce + OpenAI implementation lands.
export async function POST(request: Request) {
  const clientId = request.headers.get(CLIENT_ID_HEADER);
  if (!clientId) {
    return NextResponse.json({ error: "missing_client_id" }, { status: 400 });
  }

  const { sessionId, content } = (await request.json()) as {
    sessionId?: string;
    content?: string;
  };

  if (!sessionId || !content?.trim()) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const supabase = getSupabaseServer();
  const { data: user, error: userError } = await supabase
    .from("users")
    .select("id")
    .eq("id", clientId)
    .single<{ id: string }>();

  if (userError || !user) {
    return NextResponse.json({ error: "user_not_found" }, { status: 404 });
  }

  const { data: session, error: sessionError } = await supabase
    .from("sessions")
    .select("id, project_id")
    .eq("id", sessionId)
    .maybeSingle<{ id: string; project_id: string }>();

  if (sessionError) {
    return NextResponse.json({ error: "session_lookup_failed" }, { status: 500 });
  }

  if (!session) {
    return NextResponse.json({ error: "session_not_found" }, { status: 404 });
  }

  const { data: userRow, error: insertError } = await supabase
    .from("messages")
    .insert({
      session_id: sessionId,
      role: "user",
      author_id: user.id,
      content: content.trim(),
      model: null,
    })
    .select("*")
    .single<MessageRow>();

  if (insertError) {
    return NextResponse.json({ error: "insert_failed" }, { status: 500 });
  }

  await broadcastSessionEvent(sessionId, {
    type: "user_msg",
    message: userRow,
  });
  await trySyncSessionMetadata(sessionId, session.project_id, {
    pending_user_id: user.id,
    pending_since: new Date().toISOString(),
  });

  scheduleAssistantBurst(sessionId, session.project_id);

  return new NextResponse(null, { status: 202 });
}
