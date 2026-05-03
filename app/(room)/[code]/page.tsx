import { notFound } from "next/navigation";

import { getSupabaseServer } from "@/lib/supabase/server";

import { AgentSection } from "./agent/AgentSection";
import { ChatPanel } from "./chat/ChatPanel";
import { ForestCanvas } from "./forest/ForestCanvas";
import { RightPanel } from "./right/RightPanel";

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
    <div className="grid min-h-0 flex-1 grid-cols-3 gap-0">
      <div className="relative col-span-2 flex min-h-0 flex-col overflow-hidden border-r border-border">
        {treeEnabled ? (
          <div className="flex min-h-0 flex-1 flex-row">
            <div className="relative flex min-w-0 flex-[5] flex-col overflow-hidden">
              <ForestCanvas projectId={projectId} />
            </div>

            <div className="relative shrink-0">
              <div className="h-full w-[3px] bg-gradient-to-b from-violet-500/20 via-violet-500/70 to-fuchsia-500/20" />
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 select-none">
                <span className="inline-flex rotate-90 items-center gap-1.5 rounded-full border border-violet-400/60 bg-card px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.22em] text-violet-700 shadow-sm dark:border-violet-300/40 dark:text-violet-200">
                  <span className="size-1.5 rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-500" />
                  agent
                </span>
              </div>
            </div>

            <div className="relative flex min-w-[400px] flex-[3] flex-col overflow-hidden bg-gradient-to-r from-violet-50/30 via-background to-background dark:from-violet-950/20">
              <AgentSection projectId={projectId} />
            </div>
          </div>
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
