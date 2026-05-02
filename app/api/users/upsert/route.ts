import { NextResponse } from "next/server";

// TODO(identity PR): upsert into `users` (id = clientId, display_name, color).
// Read clientId from the `x-client-id` header. See AGENTS.md "Identity (no auth)".
export async function POST() {
  return NextResponse.json(
    { error: "not_implemented" },
    { status: 501 }
  );
}
