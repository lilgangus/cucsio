import "server-only";

import { CLIENT_ID_HEADER } from "@/lib/identity";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Pull the clientId off an incoming request and validate that it
 * looks like a UUID. Returns null if missing or malformed; route
 * handlers turn that into a 401.
 *
 * AGENTS.md don't-forget list: "Always pass the clientId header on
 * writes; otherwise created_by will be NULL and the UI looks broken."
 */
export function getClientId(req: Request): string | null {
  const raw = req.headers.get(CLIENT_ID_HEADER);
  if (!raw) return null;
  const trimmed = raw.trim().toLowerCase();
  return UUID_RE.test(trimmed) ? trimmed : null;
}
