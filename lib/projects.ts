"use client";

import { getSupabaseBrowser } from "@/lib/supabase/browser";

/**
 * Check whether a project with the given (already-normalized) room code
 * exists. Uses the browser Supabase client because RLS is off and the
 * project name is non-sensitive — saves a round trip through a Next
 * route handler.
 *
 * Returns:
 *   - `true`  if a row was found
 *   - `false` if no row matches
 * Throws on transport errors so callers can distinguish "not found"
 * from "could not check".
 */
export async function projectExistsByCode(code: string): Promise<boolean> {
  const supabase = getSupabaseBrowser();
  const { data, error } = await supabase
    .from("projects")
    .select("id")
    .eq("room_code", code)
    .maybeSingle();
  if (error) {
    throw new Error(error.message);
  }
  return data !== null;
}
