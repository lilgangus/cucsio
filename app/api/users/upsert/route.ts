import { NextResponse } from "next/server";

import { getClientId } from "@/lib/server/request";
import { getSupabaseServer } from "@/lib/supabase/server";
import type { UserRow } from "@/types/db";

type Body = {
  displayName?: unknown;
  color?: unknown;
};

/**
 * Idempotent upsert for the anonymous identity row.
 *
 * The clientId comes from the `x-client-id` header and is the primary
 * key. Subsequent calls with the same clientId update display name /
 * colour and bump `last_seen_at`. See AGENTS.md "Identity (no auth)".
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

  const displayName =
    typeof body.displayName === "string" ? body.displayName.trim() : "";
  const color = typeof body.color === "string" ? body.color.trim() : "";

  if (displayName.length === 0 || displayName.length > 64) {
    return NextResponse.json(
      { error: "displayName must be 1-64 chars" },
      { status: 400 }
    );
  }
  if (!/^#[0-9a-f]{6}$/i.test(color)) {
    return NextResponse.json(
      { error: "color must be a #rrggbb hex string" },
      { status: 400 }
    );
  }

  const supabase = getSupabaseServer();
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("users")
    .upsert(
      {
        id: clientId,
        display_name: displayName,
        color,
        last_seen_at: now,
      },
      { onConflict: "id" }
    )
    .select()
    .single();

  if (error) {
    console.error("[/api/users/upsert] supabase error", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ user: data as UserRow });
}
