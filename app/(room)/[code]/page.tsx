import { notFound } from "next/navigation";

import { getSupabaseServer } from "@/lib/supabase/server";

import { ChatPanel } from "./chat/ChatPanel";
import { RightPanel } from "./right/RightPanel";
import { RoomResizableLayout } from "./RoomResizableLayout";

type Props = {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ tree?: string | string[] }>;
};

/**
 * Room page: the main canvas puts the user forest beside the agent thinking
 * forest. The right column stays focused on search, highlights, and findings.
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
    <div className="flex min-h-0 flex-1">
      {treeEnabled ? (
        <RoomResizableLayout projectId={projectId} />
      ) : (
        <>
          <div className="relative flex min-h-0 flex-[2] flex-col overflow-hidden border-r border-border">
            <ChatPanel roomCode={normalized} projectId={projectId} />
          </div>
          <aside className="flex min-h-0 flex-1 flex-col bg-card">
            <RightPanel projectId={projectId} />
          </aside>
        </>
      )}
    </div>
  );
}
