import { NextResponse } from "next/server";
import { CLIENT_ID_HEADER } from "@/lib/identity";
import {
  SESSION_BROADCAST_EVENT,
  sessionChannel,
  type SessionEvent,
} from "@/lib/realtime/channels";
import { getSupabaseServer } from "@/lib/supabase/server";
import type { MessageRow } from "@/types/db";

const ASSISTANT_REPLY =
  "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed non dui eget nunc congue pulvinar. " +
  "Vivamus feugiat, sapien a tincidunt ultrices, mi augue efficitur sapien, vitae luctus nisi justo sit amet nisl. " +
  "Curabitur finibus orci ut erat dapibus, vitae volutpat ligula faucibus. Integer et porta justo. " +
  "Suspendisse potenti. Praesent euismod, augue in faucibus blandit, tortor orci posuere velit, " +
  "vitae cursus velit ipsum vel orci.";

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

async function runAssistantBurst(sessionId: string) {
  const supabase = getSupabaseServer();
  const tmpId = crypto.randomUUID();
  const chunks = splitIntoChunks(ASSISTANT_REPLY, 12);

  try {
    await sleep(500);

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
  } catch (error) {
    await broadcastSessionEvent(sessionId, {
      type: "stream_error",
      sessionId,
      tmpId,
      error: error instanceof Error ? error.message : "Unknown stream failure",
    });
  }
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

  void runAssistantBurst(sessionId);

  return new NextResponse(null, { status: 202 });
}
