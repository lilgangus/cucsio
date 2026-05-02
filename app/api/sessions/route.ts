import { NextResponse } from "next/server";

import {
  PROJECT_BROADCAST_EVENT,
  projectChannel,
  type ProjectEvent,
} from "@/lib/realtime/channels";
import { getClientId } from "@/lib/server/request";
import { getSupabaseServer } from "@/lib/supabase/server";
import type { SessionRow } from "@/types/db";

type Body = {
  projectId?: unknown;
  label?: unknown;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

/**
 * Create a new root session inside a project.
 *
 * Used both by the forest UI's "+ new chat" flow and by the room chat
 * fallback if a legacy project somehow has zero sessions. Forks live
 * in `/api/sessions/[id]/fork`.
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

  const projectId = typeof body.projectId === "string" ? body.projectId : "";
  if (!UUID_RE.test(projectId)) {
    return NextResponse.json(
      { error: "projectId must be a uuid" },
      { status: 400 }
    );
  }

  const rawLabel = typeof body.label === "string" ? body.label.trim() : "";
  const label = rawLabel.length > 0 ? rawLabel.slice(0, 64) : null;
  const sessionTarget = label ?? "General exploration";

  const supabase = getSupabaseServer();

  const { data: user, error: userError } = await supabase
    .from("users")
    .select("id")
    .eq("id", clientId)
    .maybeSingle();

  if (userError) {
    console.error("[/api/sessions] user lookup failed", userError);
    return NextResponse.json({ error: userError.message }, { status: 500 });
  }
  if (!user) {
    return NextResponse.json({ error: "user not found" }, { status: 404 });
  }

  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .maybeSingle();

  if (projectError) {
    console.error("[/api/sessions] project lookup failed", projectError);
    return NextResponse.json({ error: projectError.message }, { status: 500 });
  }
  if (!project) {
    return NextResponse.json({ error: "project not found" }, { status: 404 });
  }

  const { data, error } = await supabase
    .from("sessions")
    .insert({
      project_id: projectId,
      parent_session_id: null,
      fork_point_message_id: null,
      label,
      session_target: sessionTarget,
      created_by: clientId,
    })
    .select()
    .single();

  if (error || !data) {
    console.error("[/api/sessions] insert failed", error);
    return NextResponse.json(
      { error: error?.message ?? "could not create session" },
      { status: 500 }
    );
  }

  const session = data as SessionRow;

  await broadcastProjectEvent(projectId, {
    type: "session_created",
    session,
  });

  return NextResponse.json({ session }, { status: 201 });
}
