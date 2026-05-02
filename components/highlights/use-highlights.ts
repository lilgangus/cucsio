"use client";

import { useEffect } from "react";
import useSWR, { useSWRConfig } from "swr";
import {
  PROJECT_BROADCAST_EVENT,
  projectChannel,
  type ProjectEvent,
} from "@/lib/realtime/channels";
import { getSupabaseBrowser } from "@/lib/supabase/browser";
import type { HighlightRow } from "@/types/db";

type HighlightRowWithJoin = HighlightRow & {
  sessions?: { project_id: string } | { project_id: string }[];
};

async function fetchHighlights(projectId: string): Promise<HighlightRow[]> {
  if (projectId === "mock") {
    return [];
  }

  const { data, error } = await getSupabaseBrowser()
    .from("highlights")
    .select("*, sessions!inner(project_id)")
    .eq("sessions.project_id", projectId)
    .order("created_at", { ascending: false });

  if (error) {
    throw error;
  }

  return (data ?? []).map((row) => {
    const { sessions, ...highlight } = row as HighlightRowWithJoin;
    void sessions;
    return highlight;
  });
}

export function useHighlights(projectId: string): {
  highlights: HighlightRow[];
  isLoading: boolean;
} {
  const { data, isLoading } = useSWR<HighlightRow[]>(
    ["highlights", projectId],
    () => fetchHighlights(projectId),
    projectId === "mock"
      ? {
          revalidateOnFocus: false,
          revalidateOnMount: false,
          revalidateIfStale: false,
          fallbackData: [],
        }
      : undefined
  );
  const { mutate } = useSWRConfig();

  useEffect(() => {
    if (projectId === "mock") return;

    const supabase = getSupabaseBrowser();
    const channel = supabase
      .channel(projectChannel(projectId))
      .on("broadcast", { event: PROJECT_BROADCAST_EVENT }, ({ payload }) => {
        const event = payload as ProjectEvent;
        if (event.type !== "highlight_created") return;

        void mutate<HighlightRow[]>(
          ["highlights", projectId],
          (current = []) => {
            if (current.some((highlight) => highlight.id === event.highlight.id)) {
              return current;
            }

            return [event.highlight, ...current];
          },
          { revalidate: false }
        );
      });

    channel.subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [mutate, projectId]);

  return {
    highlights: data ?? [],
    isLoading,
  };
}
