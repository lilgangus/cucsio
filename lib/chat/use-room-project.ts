"use client";

import useSWR from "swr";

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

export function useRoomProject(roomCode: string) {
  return useSWR<RoomProject | null>(roomKey(roomCode), () => fetchRoomProject(roomCode));
}
