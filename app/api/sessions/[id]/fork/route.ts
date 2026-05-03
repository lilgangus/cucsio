import { NextResponse } from "next/server";

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
 * Fork a session. Per AGENTS.md "Forking semantics":
 *
 *   "Fork = child session with parent pointer + fork point." For this
 *   UI variant we do NOT duplicate parent messages into the child.
 *
 * The duplication cost is fine for an MVP. Multi-parent merges are
 * explicitly out of scope.
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

  // Resolve the fork-point cutoff: explicit id, or latest message's id.
  let forkPointId: string | null = null;
  let cutoffCreatedAt: string | null = null;

  if (typeof body.forkPointMessageId === "string") {
    if (!UUID_RE.test(body.forkPointMessageId)) {
      return NextResponse.json(
        { error: "forkPointMessageId must be a uuid" },
        { status: 400 }
      );
    }
    const { data: pointMsg, error: pointErr } = await supabase
      .from("messages")
      .select("id, session_id, created_at")
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
    cutoffCreatedAt = pointMsg.created_at;
  } else {
    const { data: latest, error: latestErr } = await supabase
      .from("messages")
      .select("id, created_at")
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
      cutoffCreatedAt = latest.created_at;
    }
    // If parent has no messages, we still allow fork (just an empty new
    // session pointing at the parent). Useful for "branch from an empty
    // root" demos.
  }

  const rawLabel = typeof body.label === "string" ? body.label.trim() : "";
  const rawTarget =
    typeof body.sessionTarget === "string" ? body.sessionTarget.trim() : "";
  const sessionTarget =
    rawTarget.length > 0
      ? rawTarget.slice(0, 160)
      : parentRow.session_target?.trim() || "General exploration";
  const childLabel =
    rawLabel.length > 0
      ? rawLabel.slice(0, 64)
      : parentRow.label
        ? `${parentRow.label} fork`
        : "Fork";

  const { data: child, error: childErr } = await supabase
    .from("sessions")
    .insert({
      project_id: parentRow.project_id,
      parent_session_id: parentRow.id,
      fork_point_message_id: forkPointId,
      session_target: sessionTarget,
      label: childLabel,
      summary: parentRow.summary,
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

  void cutoffCreatedAt;
  return NextResponse.json({ session: childRow });
}

export type ForkResponse = {
  session: SessionRow;
};
