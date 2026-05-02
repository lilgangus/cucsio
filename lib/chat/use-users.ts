"use client";

import useSWR from "swr";
import { getSupabaseBrowser } from "@/lib/supabase/browser";
import type { UserRow, Uuid } from "@/types/db";

function sortDistinctIds(authorIds: (string | null)[]): Uuid[] {
  return Array.from(new Set(authorIds.filter((authorId): authorId is Uuid => Boolean(authorId)))).sort();
}

export function useUsers(authorIds: (string | null)[]): Record<Uuid, UserRow> {
  const ids = sortDistinctIds(authorIds);
  const key = ids.length > 0 ? ["users", ids.join(",")] : null;

  const { data } = useSWR<Record<Uuid, UserRow>>(key, async () => {
    if (
      !process.env.NEXT_PUBLIC_SUPABASE_URL ||
      !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    ) {
      return {};
    }

    const { data: rows, error } = await getSupabaseBrowser()
      .from("users")
      .select("id,display_name,color")
      .in("id", ids);

    if (error) {
      throw error;
    }

    return (rows ?? []).reduce<Record<Uuid, UserRow>>((acc, row) => {
      acc[row.id] = {
        id: row.id,
        display_name: row.display_name,
        color: row.color,
        created_at: "",
        last_seen_at: "",
      };
      return acc;
    }, {});
  });

  return data ?? {};
}
