import { notFound } from "next/navigation";

import { isValidRoomCode, normalizeRoomCode } from "@/lib/room-code";
import { getSupabaseServer } from "@/lib/supabase/server";
import type { ProjectRow } from "@/types/db";

import { RoomGuard } from "./room-guard";
import { RoomProviders } from "./room-providers";
import { TopBar } from "./top-bar";

type Props = {
  children: React.ReactNode;
  params: Promise<{ code: string }>;
};

/**
 * Room shell. Validates the URL code, looks up the project (404 if
 * missing), and renders the top bar above the page-supplied body.
 *
 * The body is split 2/3 + 1/3 inside the page itself so that the page
 * can also overlay a tree background under the chat panel.
 */
export default async function RoomLayout({ children, params }: Props) {
  const { code } = await params;
  const normalized = normalizeRoomCode(code);
  if (!isValidRoomCode(normalized)) {
    notFound();
  }

  const supabase = getSupabaseServer();
  const { data, error } = await supabase
    .from("projects")
    .select("id, name, room_code, master_context, created_at, updated_at, created_by")
    .eq("room_code", normalized)
    .maybeSingle();

  if (error) {
    console.error("[room layout] supabase error", error);
    throw new Error(`Could not load room: ${error.message}`);
  }

  if (!data) {
    notFound();
  }

  const project = data as Pick<
    ProjectRow,
    | "id"
    | "name"
    | "room_code"
    | "master_context"
    | "created_at"
    | "updated_at"
    | "created_by"
  >;

  return (
    <RoomProviders projectId={project.id}>
      <div className="flex h-screen min-h-0 flex-col">
        <RoomGuard roomCode={normalized} />
        <TopBar
          roomCode={normalized}
          projectId={project.id}
          projectName={project.name}
          initialMasterContext={project.master_context}
        />
        <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      </div>
    </RoomProviders>
  );
}
