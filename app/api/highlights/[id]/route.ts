import { NextResponse } from "next/server";

import { getClientId } from "@/lib/server/request";
import { getSupabaseServer } from "@/lib/supabase/server";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Params = { params: Promise<{ id: string }> };

/** Remove a pinned highlight from the project backboard. */
export async function DELETE(req: Request, ctx: Params) {
  const clientId = getClientId(req);
  if (!clientId) {
    return NextResponse.json(
      { error: "missing or malformed x-client-id header" },
      { status: 401 }
    );
  }

  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "bad highlight id" }, { status: 400 });
  }

  const supabase = getSupabaseServer();
  const { data, error } = await supabase
    .from("highlights")
    .delete()
    .eq("id", id)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("[DELETE /api/highlights/[id]]", error);
    return NextResponse.json(
      { error: error.message ?? "could not delete highlight" },
      { status: 500 }
    );
  }
  if (!data) {
    return NextResponse.json({ error: "highlight not found" }, { status: 404 });
  }

  return new NextResponse(null, { status: 204 });
}
