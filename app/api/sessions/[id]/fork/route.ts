import { NextResponse } from "next/server";

import { computeAndSaveSmartContext } from "@/lib/llm/smart-context";
import { getClientId } from "@/lib/server/request";
import { getSupabaseServer } from "@/lib/supabase/server";
import type { SessionRow } from "@/types/db";

type Body = {
  /**
   * Optional id of the message to fork from. If omitted we fork from
   * the latest message — i.e. "branch off using everything so far".
   * Provided when a future per-message UI lets users fork mid-thread.
   */
  forkPointMessageId?: unknown;
  label?: unknown;
  sessionTarget?: unknown;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Params = { params: Promise<{ id: string }> };

/**
 * Fork a session: new child row + parent edge + optional fork-point metadata.
 * Parent messages are **not** copied — upstream context is supplied only via
 * `smart_context` (AI key-details summary for the branch goal).
 */
export async function POST(req: Request, ctx: Params) {
  const clientId = getClientId(req);
  if (!clientId) {
    return NextResponse.json(
      { error: "missing or malformed x-client-id header" },
      { status: 401 }
    );
  }

  const { id: parentId } = await ctx.params;
  if (!UUID_RE.test(parentId)) {
    return NextResponse.json({ error: "bad session id" }, { status: 400 });
  }

  let body: Body = {};
  try {
    body = (await req.json()) as Body;
  } catch {
    // empty body is fine — fork from latest.
  }

  const supabase = getSupabaseServer();

  const { data: parent, error: parentErr } = await supabase
    .from("sessions")
    .select("*")
    .eq("id", parentId)
    .maybeSingle();
  if (parentErr) {
    console.error("[/api/sessions/fork] parent lookup", parentErr);
    return NextResponse.json({ error: parentErr.message }, { status: 500 });
  }
  if (!parent) {
    return NextResponse.json({ error: "parent session not found" }, { status: 404 });
  }
  const parentRow = parent as SessionRow;

  // Fork-point message id for lineage metadata (optional UI / future use).
  let forkPointId: string | null = null;

  if (typeof body.forkPointMessageId === "string") {
    if (!UUID_RE.test(body.forkPointMessageId)) {
      return NextResponse.json(
        { error: "forkPointMessageId must be a uuid" },
        { status: 400 }
      );
    }
    const { data: pointMsg, error: pointErr } = await supabase
      .from("messages")
      .select("id, session_id")
      .eq("id", body.forkPointMessageId)
      .maybeSingle();
    if (pointErr) {
      console.error("[/api/sessions/fork] fork-point lookup", pointErr);
      return NextResponse.json({ error: pointErr.message }, { status: 500 });
    }
    if (!pointMsg || pointMsg.session_id !== parentId) {
      return NextResponse.json(
        { error: "fork point does not belong to this session" },
        { status: 400 }
      );
    }
    forkPointId = pointMsg.id;
  } else {
    const { data: latest, error: latestErr } = await supabase
      .from("messages")
      .select("id")
      .eq("session_id", parentId)
      .eq("is_deleted", false)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latestErr) {
      console.error("[/api/sessions/fork] latest lookup", latestErr);
      return NextResponse.json({ error: latestErr.message }, { status: 500 });
    }
    if (latest) {
      forkPointId = latest.id;
    }
    // If parent has no messages, we still allow fork (just an empty new
    // session pointing at the parent). Useful for "branch from an empty
    // root" demos.
  }

  const rawLabel = typeof body.label === "string" ? body.label.trim() : "";
  const rawTarget =
    typeof body.sessionTarget === "string" ? body.sessionTarget.trim() : "";
  /** Never inherit the parent's target — empty client input uses a neutral default. */
  const sessionTarget =
    rawTarget.length > 0 ? rawTarget.slice(0, 160) : "General exploration";
  /** Null until the first user message names it (messages route). */
  const childLabel = rawLabel.length > 0 ? rawLabel.slice(0, 64) : null;

  const { data: child, error: childErr } = await supabase
    .from("sessions")
    .insert({
      project_id: parentRow.project_id,
      parent_session_id: parentRow.id,
      fork_point_message_id: forkPointId,
      session_target: sessionTarget,
      label: childLabel,
      summary: "",
      created_by: clientId,
    })
    .select()
    .single();
  if (childErr || !child) {
    console.error("[/api/sessions/fork] child insert", childErr);
    return NextResponse.json(
      { error: childErr?.message ?? "could not create fork" },
      { status: 500 }
    );
  }
  const childRow = child as SessionRow;

  // Record the parent edge in session_parents so the UI can render
  // multi-parent edges and "Branched from" breadcrumbs.
  const { error: edgeErr } = await supabase
    .from("session_parents")
    .insert({ session_id: childRow.id, parent_id: parentRow.id });
  if (edgeErr) {
    // Non-fatal: the session was created; the parent edge is advisory.
    // Log and continue rather than rolling back the fork.
    console.warn("[/api/sessions/fork] session_parents insert", edgeErr);
  }

  await computeAndSaveSmartContext(supabase, {
    childSessionId: childRow.id,
    seedParentIds: [parentRow.id],
    sessionTarget,
  });
  const { data: withSmart } = await supabase
    .from("sessions")
    .select("*")
    .eq("id", childRow.id)
    .single();

  return NextResponse.json({
    session: (withSmart ?? childRow) as SessionRow,
    copiedMessages: 0,
  });
}

export type ForkResponse = {
  session: SessionRow;
};
