import { NextResponse } from "next/server";

import { getClientId } from "@/lib/server/request";
import { getSupabaseServer } from "@/lib/supabase/server";
import type { SessionParentRow, SessionRow } from "@/types/db";

type Body = {
  /** One or more parent session ids (linked in `session_parents`; no message copy). */
  parentIds?: unknown;
  /** Optional label for the new node. */
  label?: unknown;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Create a new session seeded from one or more parent sessions.
 *
 * Strategy:
 *   1. Validate the caller supplied ≥ 1 parent session id.
 *   2. Load all parent sessions (verify they belong to the same project).
 *   3. Insert the new `sessions` row with `parent_session_id = parentIds[0]`
 *      (primary parent for layout) and `is_archived = false`.
 *   4. Insert one row per parent into `session_parents`.
 *   5. No message copy — the chat starts empty; parents are linked only
 *      via `session_parents` for the "Branched from" UI.
 *   6. Return the new session (`label` null until the first user send).
 *
 * The session lock is not held during creation (no chat turn yet).
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

  if (!Array.isArray(body.parentIds) || body.parentIds.length < 1) {
    return NextResponse.json(
      { error: "parentIds must be a non-empty array of session uuids" },
      { status: 400 }
    );
  }
  const parentIds = body.parentIds as unknown[];
  if (!parentIds.every((id) => typeof id === "string" && UUID_RE.test(id))) {
    return NextResponse.json(
      { error: "every parentId must be a valid uuid" },
      { status: 400 }
    );
  }
  const parentIdList = [...new Set(parentIds as string[])];

  const rawLabel = typeof body.label === "string" ? body.label.trim() : "";
  /** Null until the first user message names the session (see messages route). */
  const label = rawLabel.length > 0 ? rawLabel.slice(0, 64) : null;

  const supabase = getSupabaseServer();

  // Verify parents exist and are from the same project.
  const { data: parents, error: parentsErr } = await supabase
    .from("sessions")
    .select("id, project_id, label, summary, message_count")
    .in("id", parentIdList);

  if (parentsErr) {
    console.error("[/api/sessions/combine] parents lookup", parentsErr);
    return NextResponse.json({ error: parentsErr.message }, { status: 500 });
  }
  if (!parents || parents.length !== parentIdList.length) {
    return NextResponse.json(
      { error: "one or more parent sessions not found" },
      { status: 404 }
    );
  }

  const parentRows = parents as Pick<
    SessionRow,
    "id" | "project_id" | "label" | "summary" | "message_count"
  >[];

  const projectIds = new Set(parentRows.map((p) => p.project_id));
  if (projectIds.size > 1) {
    return NextResponse.json(
      { error: "all parent sessions must belong to the same project" },
      { status: 400 }
    );
  }
  const projectId = [...projectIds][0];

  const now = new Date().toISOString();

  // Create the combined session. Primary parent for layout = first in list.
  const { data: child, error: childErr } = await supabase
    .from("sessions")
    .insert({
      project_id: projectId,
      parent_session_id: parentIdList[0],
      fork_point_message_id: null,
      label,
      created_by: clientId,
      created_at: now,
      updated_at: now,
      last_activity_at: now,
    })
    .select()
    .single();

  if (childErr || !child) {
    console.error("[/api/sessions/combine] child insert", childErr);
    return NextResponse.json(
      { error: childErr?.message ?? "could not create combined session" },
      { status: 500 }
    );
  }
  const childRow = child as SessionRow;

  // Write one session_parents row per parent.
  const parentEdges: Pick<SessionParentRow, "session_id" | "parent_id">[] =
    parentIdList.map((pid) => ({ session_id: childRow.id, parent_id: pid }));

  const { error: edgesErr } = await supabase
    .from("session_parents")
    .insert(parentEdges);

  if (edgesErr) {
    console.error("[/api/sessions/combine] edges insert", edgesErr);
    await supabase.from("sessions").delete().eq("id", childRow.id);
    return NextResponse.json({ error: edgesErr.message }, { status: 500 });
  }

  // Intentionally no message copy: the UI shows only "Branched from …"
  // until the user types; parent context stays on the parent nodes.

  const { data: refreshed } = await supabase
    .from("sessions")
    .select("*")
    .eq("id", childRow.id)
    .single();

  return NextResponse.json({
    session: (refreshed ?? childRow) as SessionRow,
    parentIds: parentIdList,
    copiedMessages: 0,
  });
}

export type CombineResponse = {
  session: SessionRow;
  parentIds: string[];
  copiedMessages: number;
};
