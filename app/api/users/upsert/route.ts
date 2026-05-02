import { NextResponse } from "next/server";

import { CLIENT_ID_HEADER } from "@/lib/identity";
import { getSupabaseServer } from "@/lib/supabase/server";
import type { UserRow } from "@/types/db";

export async function POST(request: Request) {
  const clientId = request.headers.get(CLIENT_ID_HEADER);
  if (!clientId) {
    return NextResponse.json({ error: "missing_client_id" }, { status: 400 });
  }

  const { displayName, color } = (await request.json()) as {
    displayName?: string;
    color?: string;
  };

  if (!displayName?.trim() || !color?.trim()) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const supabase = getSupabaseServer();
  const { data: user, error } = await supabase
    .from("users")
    .upsert(
      {
        id: clientId,
        display_name: displayName.trim(),
        color: color.trim(),
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: "id" }
    )
    .select("*")
    .single<UserRow>();

  if (error || !user) {
    return NextResponse.json({ error: "upsert_failed" }, { status: 500 });
  }

  return NextResponse.json({ user });
}
