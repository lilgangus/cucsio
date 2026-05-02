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
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Params = { params: Promise<{ id: string }> };

/**
 * Fork a session. Per AGENTS.md "Forking semantics":
 *
 *   "Fork = copy. When a user forks from messageId of session A, insert
 *    a new sessions row with parent_session_id = A.id and
 *    fork_point_message_id = messageId, then copy messages 1..N from A
 *    into the new session as fresh rows."
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

  // Copy messages 1..forkPoint from parent.
  let copiedCount = 0;
  if (cutoffCreatedAt) {
    const { data: history, error: histErr } = await supabase
      .from("messages")
      .select("role, author_id, content, model, prompt_tokens, completion_tokens")
      .eq("session_id", parentRow.id)
      .eq("is_deleted", false)
      .lte("created_at", cutoffCreatedAt)
      .order("created_at", { ascending: true });
    if (histErr) {
      console.error("[/api/sessions/fork] history pull", histErr);
      // Roll back the orphan child so the user can retry.
      await supabase.from("sessions").delete().eq("id", childRow.id);
      return NextResponse.json({ error: histErr.message }, { status: 500 });
    }

    if (history && history.length > 0) {
      const rows = history.map((m) => ({
        session_id: childRow.id,
        role: m.role,
        author_id: m.author_id,
        content: m.content,
        model: m.model,
        prompt_tokens: m.prompt_tokens,
        completion_tokens: m.completion_tokens,
      }));
      const { error: copyErr } = await supabase.from("messages").insert(rows);
      if (copyErr) {
        console.error("[/api/sessions/fork] copy messages", copyErr);
        await supabase.from("sessions").delete().eq("id", childRow.id);
        return NextResponse.json({ error: copyErr.message }, { status: 500 });
      }
      copiedCount = rows.length;

      const { data: refreshed } = await supabase
        .from("sessions")
        .update({
          message_count: copiedCount,
          last_activity_at: new Date().toISOString(),
        })
        .eq("id", childRow.id)
        .select()
        .single();
      if (refreshed) {
        return NextResponse.json({
          session: refreshed as SessionRow,
          copiedMessages: copiedCount,
        });
      }
    }
  }

  return NextResponse.json({
    session: childRow,
    copiedMessages: copiedCount,
  });
}

export type ForkResponse = {
  session: SessionRow;
  copiedMessages: number;
};
