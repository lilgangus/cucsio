"use client";

import { useEffect } from "react";
import useSWR from "swr";

import {
  PROJECT_BROADCAST_EVENT,
  projectChannel,
  type ProjectEvent,
} from "@/lib/realtime/channels";
import { getSupabaseBrowser } from "@/lib/supabase/browser";
import type { ProjectRow, SessionRow } from "@/types/db";

export type RoomSession = Pick<
  SessionRow,
  "id" | "label" | "message_count" | "parent_session_id" | "is_archived" | "created_at"
>;

export type RoomProject = Pick<ProjectRow, "id" | "name" | "master_context"> & {
  sessions: RoomSession[];
};

type RoomProjectRow = Pick<ProjectRow, "id" | "name" | "master_context"> & {
  sessions: RoomSession[] | null;
};

export function roomKey(roomCode: string) {
  return ["room", roomCode] as const;
}

async function fetchRoomProject(roomCode: string): Promise<RoomProject | null> {
  const { data, error } = await getSupabaseBrowser()
    .from("projects")
    .select(
      "id, name, master_context, sessions:sessions(id, label, message_count, parent_session_id, is_archived, created_at)"
    )
    .eq("room_code", roomCode)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data) {
    return null;
  }

  const room = data as RoomProjectRow;

  return {
    ...room,
    sessions: [...(room.sessions ?? [])].sort(
      (left, right) =>
        new Date(left.created_at).getTime() - new Date(right.created_at).getTime()
    ),
  };
}

export function useRoomProject(roomCode: string | null) {
  const swr = useSWR<RoomProject | null>(
    roomCode ? roomKey(roomCode) : null,
    () => fetchRoomProject(roomCode ?? "")
  );

  useEffect(() => {
    if (!roomCode || !swr.data?.id) return;

    const supabase = getSupabaseBrowser();
    const channel = supabase
      .channel(projectChannel(swr.data.id))
      .on("broadcast", { event: PROJECT_BROADCAST_EVENT }, ({ payload }) => {
        const event = payload as ProjectEvent;

        if (event.type === "session_created") {
          void swr.mutate(
            (current) => {
              if (!current) return current;
              if (current.sessions.some((session) => session.id === event.session.id)) {
                return current;
              }

              return {
                ...current,
                sessions: [...current.sessions, event.session].sort(
                  (left, right) =>
                    new Date(left.created_at).getTime() -
                    new Date(right.created_at).getTime()
                ),
              };
            },
            { revalidate: false }
          );
        }

        if (event.type === "project_updated") {
          void swr.mutate(
            (current) =>
              current
                ? {
                    ...current,
                    id: event.project.id,
                    name: event.project.name,
                  }
                : current,
            { revalidate: false }
          );
        }
      });

    channel.subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [roomCode, swr]);

  return swr;
}
