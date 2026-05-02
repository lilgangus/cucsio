import { NextResponse } from "next/server";

import { generateRoomCode } from "@/lib/room-code";
import { getClientId } from "@/lib/server/request";
import { getSupabaseServer } from "@/lib/supabase/server";
import type { ProjectRow, SessionRow } from "@/types/db";

type Body = {
  name?: unknown;
  initialSessionTarget?: unknown;
};

const MAX_CODE_RETRIES = 5;
// Postgres unique-violation code; Supabase exposes it on the error.
const PG_UNIQUE_VIOLATION = "23505";

/**
 * Create a new project + its root session.
 *
 * Per AGENTS.md MVP scope #2: "Anyone joins by code, picks a display
 * name, lands in a session." So every project starts with one empty
 * root session. The chat panel will pick that up later.
 *
 * The room code is generated client-side here and inserted; on the
 * (rare) unique-constraint conflict we retry with a new code. After
 * `MAX_CODE_RETRIES` we give up rather than spin forever.
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

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const initialSessionTarget =
    typeof body.initialSessionTarget === "string"
      ? body.initialSessionTarget.trim()
      : "";
  if (name.length === 0 || name.length > 128) {
    return NextResponse.json(
      { error: "name must be 1-128 chars" },
      { status: 400 }
    );
  }
  if (initialSessionTarget.length === 0 || initialSessionTarget.length > 240) {
    return NextResponse.json(
      { error: "initialSessionTarget must be 1-240 chars" },
      { status: 400 }
    );
  }

  const supabase = getSupabaseServer();

  let project: ProjectRow | null = null;
  let lastError: { message: string; code?: string } | null = null;

  for (let attempt = 0; attempt < MAX_CODE_RETRIES; attempt++) {
    const code = generateRoomCode();
    const { data, error } = await supabase
      .from("projects")
      .insert({ name, room_code: code, created_by: clientId })
      .select()
      .single();

    if (!error && data) {
      project = data as ProjectRow;
      break;
    }
    lastError = error
      ? { message: error.message, code: error.code }
      : { message: "unknown insert error" };
    if (lastError.code !== PG_UNIQUE_VIOLATION) {
      // Not a code collision — bail with the actual error.
      console.error("[/api/projects] supabase error", error);
      return NextResponse.json({ error: lastError.message }, { status: 500 });
    }
    // Collision: loop and try a new code.
  }

  if (!project) {
    console.error(
      "[/api/projects] exhausted room-code retries",
      lastError
    );
    return NextResponse.json(
      { error: "could not allocate a room code, try again" },
      { status: 503 }
    );
  }

  const { data: session, error: sessionError } = await supabase
    .from("sessions")
    .insert({
      project_id: project.id,
      label: "Main",
      session_target: initialSessionTarget,
      created_by: clientId,
    })
    .select()
    .single();

  if (sessionError || !session) {
    // Roll back the orphan project so the room code is freed.
    await supabase.from("projects").delete().eq("id", project.id);
    console.error("[/api/projects] failed to create root session", sessionError);
    return NextResponse.json(
      { error: sessionError?.message ?? "failed to create initial session" },
      { status: 500 }
    );
  }

  return NextResponse.json({
    project,
    session: session as SessionRow,
  });
}
