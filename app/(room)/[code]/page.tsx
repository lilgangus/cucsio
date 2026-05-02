import { ChatPanel } from "./chat/ChatPanel";
import { RightPanel } from "./right/RightPanel";
import { TreeBackground } from "./tree/TreeBackground";
import { getSupabaseServer } from "@/lib/supabase/server";

type Props = {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ tree?: string | string[] }>;
};

/**
 * Room page: 2/3 left (chat over tree), 1/3 right (unified search + highlights panel).
 *
 * Honors `?tree=off` (per AGENTS.md don't-forget list) by hiding the
 * React Flow background entirely. Build this flag in hour 1 in case
 * the tree misbehaves late in the build.
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
  const projectId = project?.id ?? "";

  return (
    <div className="grid min-h-0 flex-1 grid-cols-3 gap-0">
      <div className="relative col-span-2 flex min-h-0 flex-col overflow-hidden border-r border-border">
        {treeEnabled ? <TreeBackground roomCode={normalized} /> : null}
        <ChatPanel roomCode={normalized} />
      </div>

      <aside className="col-span-1 flex min-h-0 flex-col bg-card">
        <RightPanel projectId={projectId} />
      </aside>
    </div>
  );
}
