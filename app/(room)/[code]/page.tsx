import { notFound } from "next/navigation";

import { getSupabaseServer } from "@/lib/supabase/server";

import { ChatPanel } from "./chat/ChatPanel";
import { ForestCanvas } from "./forest/ForestCanvas";
import { RightPanel } from "./right/RightPanel";

type Props = {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ tree?: string | string[] }>;
};

/**
 * Room page: 2/3 left (forest of chats with pop-up nodes, or chat
 * placeholder when `?tree=off`), 1/3 right (unified search + highlights).
 *
 * Re-resolves `projectId` here so `ForestCanvas` can subscribe to
 * sessions (layout already validated the room code upstream).
 *
 * Honors `?tree=off` (per AGENTS.md don't-forget list).
 */
export default async function RoomPage({ params, searchParams }: Props) {
  const [{ code }, search] = await Promise.all([params, searchParams]);
  const treeParam = Array.isArray(search.tree) ? search.tree[0] : search.tree;
  const treeEnabled = treeParam !== "off";
  const normalized = code.toLowerCase();

  const supabase = getSupabaseServer();
  const { data: project } = await supabase
    .from("projects")
    .select("id")
    .eq("room_code", normalized)
    .maybeSingle();

  if (!project) notFound();
  const projectId = project.id as string;

  return (
    <div className="grid min-h-0 flex-1 grid-cols-3 gap-0">
      <div className="relative col-span-2 flex min-h-0 flex-col overflow-hidden border-r border-border">
        {treeEnabled ? (
          <ForestCanvas projectId={projectId} />
        ) : (
          <ChatPanel roomCode={normalized} projectId={projectId} />
        )}
      </div>

      <aside className="col-span-1 flex min-h-0 flex-col bg-card">
        <RightPanel projectId={projectId} />
      </aside>
    </div>
  );
}
