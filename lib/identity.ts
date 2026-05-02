/**
 * Anonymous identity for the hackathon: no auth, just a per-browser UUID.
 *
 * On first load the client generates `clientId` and persists it in
 * localStorage along with the chosen display name and a colour. Every
 * write that hits a server action / route handler must send the
 * clientId via the `x-client-id` header so `created_by` is populated.
 *
 * Anyone with a clientId can claim to be anyone else — acceptable for
 * an MVP demo.
 */

export const IDENTITY_STORAGE_KEY = "cucsio.identity.v1";
export const CLIENT_ID_HEADER = "x-client-id";

export type Identity = {
  clientId: string;
  displayName: string;
  color: string;
};

/** Tailwind-friendly accent palette used for presence badges. */
const PALETTE = [
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#06b6d4",
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
];

function pickColor(): string {
  return PALETTE[Math.floor(Math.random() * PALETTE.length)];
}

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

/** Returns the stored identity or null. Safe to call during SSR (returns null). */
export function loadIdentity(): Identity | null {
  if (!isBrowser()) return null;
  try {
    const raw = localStorage.getItem(IDENTITY_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Identity>;
    if (!parsed.clientId || !parsed.displayName || !parsed.color) return null;
    return {
      clientId: parsed.clientId,
      displayName: parsed.displayName,
      color: parsed.color,
    };
  } catch {
    return null;
  }
}

/**
 * Idempotent: if an identity already exists, returns it (and updates the
 * display name if the caller passed a different one). Otherwise mints
 * a fresh clientId, picks a colour, and persists.
 */
export function ensureIdentity(displayName: string): Identity {
  if (!isBrowser()) {
    throw new Error("ensureIdentity can only run in the browser");
  }
  const existing = loadIdentity();
  if (existing) {
    if (existing.displayName !== displayName && displayName.trim().length > 0) {
      const updated = { ...existing, displayName: displayName.trim() };
      localStorage.setItem(IDENTITY_STORAGE_KEY, JSON.stringify(updated));
      return updated;
    }
    return existing;
  }
  const fresh: Identity = {
    clientId: crypto.randomUUID(),
    displayName: displayName.trim() || "Anonymous",
    color: pickColor(),
  };
  localStorage.setItem(IDENTITY_STORAGE_KEY, JSON.stringify(fresh));
  return fresh;
}

/** Clears local identity. Useful for "switch user" affordances. */
export function clearIdentity(): void {
  if (!isBrowser()) return;
  localStorage.removeItem(IDENTITY_STORAGE_KEY);
}

/** Helper for client fetches that need the clientId header. */
export function authHeaders(identity: Identity | null): HeadersInit {
  return identity ? { [CLIENT_ID_HEADER]: identity.clientId } : {};
}

/**
 * UI helper for collision-safe display: appends `#<first-4-of-clientId>`.
 * Never make `display_name` unique in the DB — disambiguate at the UI layer.
 */
export function displayLabel(identity: Identity): string {
  return `${identity.displayName}#${identity.clientId.slice(0, 4)}`;
}
