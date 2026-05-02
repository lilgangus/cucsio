"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | null = null;

/**
 * Anon-key Supabase client for use inside client components.
 *
 * RLS is intentionally disabled for the hackathon (see AGENTS.md), so the
 * anon key is effectively god-mode. Don't ship this layout to production
 * without re-enabling RLS.
 */
export function getSupabaseBrowser(): SupabaseClient {
  if (cached) return cached;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anon) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY. " +
        "Copy .env.example to .env.local and fill in the values."
    );
  }

  cached = createClient(url, anon, {
    realtime: { params: { eventsPerSecond: 20 } },
  });
  return cached;
}
