import { NextResponse } from "next/server";

import { CLIENT_ID_HEADER } from "@/lib/identity";
import {
  PROJECT_BROADCAST_EVENT,
  projectChannel,
  type ProjectEvent,
} from "@/lib/realtime/channels";
import { getSupabaseServer } from "@/lib/supabase/server";
import type { SessionRow } from "@/types/db";

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

// TODO(Dev A): remove this temporary hackathon route once project creation
// reliably provisions the default session on the server.
export async function POST(request: Request) {
  const clientId = request.headers.get(CLIENT_ID_HEADER);
  if (!clientId) {
    return NextResponse.json({ error: "missing_client_id" }, { status: 400 });
  }

  const { projectId } = (await request.json()) as { projectId?: string };
  if (!projectId?.trim()) {
    return NextResponse.json({ error: "missing_project_id" }, { status: 400 });
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

  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .single<{ id: string }>();

  if (projectError || !project) {
    return NextResponse.json({ error: "project_not_found" }, { status: 404 });
  }

  const { data: session, error: sessionError } = await supabase
    .from("sessions")
    .insert({
      project_id: project.id,
      created_by: user.id,
      label: "New session",
    })
    .select("*")
    .single<SessionRow>();

  if (sessionError || !session) {
    return NextResponse.json({ error: "insert_failed" }, { status: 500 });
  }

  await broadcastProjectEvent(project.id, {
    type: "session_created",
    session,
  });

  return NextResponse.json({ session }, { status: 201 });
}
