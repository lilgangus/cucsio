/**
 * 6-character room code generator.
 *
 * Alphabet excludes confusable characters so codes can be read aloud
 * or copied off a screen without ambiguity:
 *   - removed: 0, o, 1, l, i
 *   - kept lowercase only — the join input also lowercases inputs.
 *
 * 31 chars ^ 6 ≈ 887M codes; collisions are rare enough that the
 * insert-and-retry pattern in `POST /api/projects` is cheap.
 */

export const ROOM_CODE_LENGTH = 6;
const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
export const ROOM_CODE_RE = new RegExp(`^[a-z0-9]{${ROOM_CODE_LENGTH}}$`);

export function generateRoomCode(): string {
  const buf = new Uint32Array(ROOM_CODE_LENGTH);
  crypto.getRandomValues(buf);
  let out = "";
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    out += ALPHABET[buf[i] % ALPHABET.length];
  }
  return out;
}

export function normalizeRoomCode(input: string): string {
  return input.trim().toLowerCase();
}

export function isValidRoomCode(input: string): boolean {
  return ROOM_CODE_RE.test(normalizeRoomCode(input));
}
