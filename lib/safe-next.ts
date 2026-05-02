/**
 * Validate a `?next=` redirect target to prevent open-redirect bugs.
 *
 * We only allow paths that:
 *   - start with a single `/`
 *   - do NOT start with `//` (protocol-relative)
 *   - do NOT start with `/\` (Windows-style)
 *
 * Returns the safe path or `"/"` as a fallback.
 */
export function safeNextPath(input: string | null | undefined): string {
  if (!input) return "/";
  let raw: string;
  try {
    raw = decodeURIComponent(input);
  } catch {
    return "/";
  }
  if (raw.length === 0 || raw.length > 256) return "/";
  if (raw[0] !== "/") return "/";
  if (raw[1] === "/" || raw[1] === "\\") return "/";
  return raw;
}

/**
 * Build a `/?next=<encoded>` URL pointing back to the page that bounced
 * the user to the landing page.
 */
export function loginUrlFor(currentPath: string): string {
  return `/?next=${encodeURIComponent(currentPath)}`;
}
