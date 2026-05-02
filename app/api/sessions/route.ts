import { NextResponse } from "next/server";

import { getClientId } from "@/lib/server/request";
import { getSupabaseServer } from "@/lib/supabase/server";
import type { SessionRow } from "@/types/db";

type Body = {
  projectId?: unknown;
  label?: unknown;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Create a new root session inside a project. Used by the "+ new chat"
 * button in the forest UI. Returns the inserted row.
 *
 * Forks (child sessions with messages copied from the parent) live in
 * `/api/sessions/[id]/fork` instead.
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

  const supabase = getSupabaseServer();
  const { data, error } = await supabase
    .from("sessions")
    .insert({
      project_id: projectId,
      parent_session_id: null,
      fork_point_message_id: null,
      label,
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

  return NextResponse.json({ session: data as SessionRow });
}
