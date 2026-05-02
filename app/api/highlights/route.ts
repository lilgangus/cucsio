import { NextResponse } from "next/server";
import { CLIENT_ID_HEADER } from "@/lib/identity";
import {
  PROJECT_BROADCAST_EVENT,
  projectChannel,
  type ProjectEvent,
} from "@/lib/realtime/channels";
import { getSupabaseServer } from "@/lib/supabase/server";
import type { HighlightRow } from "@/types/db";

type HighlightRowWithJoin = HighlightRow & {
  sessions?: { project_id: string } | { project_id: string }[];
};

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

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get("projectId");
  if (!projectId) {
    return NextResponse.json({ error: "missing_project_id" }, { status: 400 });
  }

  if (projectId === "mock") {
    return NextResponse.json({ highlights: [] satisfies HighlightRow[] });
  }

  const supabase = getSupabaseServer();
  const { data, error } = await supabase
    .from("highlights")
    .select("*, sessions!inner(project_id)")
    .eq("sessions.project_id", projectId)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: "fetch_failed" }, { status: 500 });
  }

  const highlights = (data ?? []).map((row) => {
    const { sessions, ...highlight } = row as HighlightRowWithJoin;
    void sessions;
    return highlight;
  });

  return NextResponse.json({ highlights });
}

export async function POST(request: Request) {
  const clientId = request.headers.get(CLIENT_ID_HEADER);
  if (!clientId) {
    return NextResponse.json({ error: "missing_client_id" }, { status: 400 });
  }

  const body = (await request.json()) as {
    sessionId?: string;
    messageId?: string;
    content?: string;
    note?: string;
  };

  const sessionId = body.sessionId?.trim();
  const messageId = body.messageId?.trim();
  const content = body.content?.trim();
  const note = body.note?.trim() || null;

  if (!sessionId || !messageId || !content) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  if (sessionId === "mock") {
    const highlight: HighlightRow = {
      id: crypto.randomUUID(),
      session_id: sessionId,
      message_id: messageId,
      content,
      note,
      source: "user",
      created_by: clientId,
      created_at: new Date().toISOString(),
    };

    return NextResponse.json({ highlight }, { status: 201 });
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
    .select("project_id")
    .eq("id", sessionId)
    .single<{ project_id: string }>();

  if (sessionError || !session) {
    return NextResponse.json({ error: "session_not_found" }, { status: 404 });
  }

  const { data: highlight, error: insertError } = await supabase
    .from("highlights")
    .insert({
      session_id: sessionId,
      message_id: messageId,
      content,
      note,
      source: "user",
      created_by: user.id,
    })
    .select("*")
    .single<HighlightRow>();

  if (insertError || !highlight) {
    return NextResponse.json({ error: "insert_failed" }, { status: 500 });
  }

  await broadcastProjectEvent(session.project_id, {
    type: "highlight_created",
    highlight,
  });

  return NextResponse.json({ highlight }, { status: 201 });
}
