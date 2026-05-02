import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { ChatPanel } from "./chat/ChatPanel";
import { HighlightsPanel } from "./highlights/HighlightsPanel";
import { SearchPanel } from "./search/SearchPanel";
import { TreeBackground } from "./tree/TreeBackground";

type Props = {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ tree?: string | string[] }>;
};

/**
 * Room page: 2/3 left (chat over tree), 1/3 right (Highlights | Search tabs).
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

  return (
    <div className="grid min-h-0 flex-1 grid-cols-3 gap-0">
      <div className="relative col-span-2 flex min-h-0 flex-col overflow-hidden border-r border-border">
        {treeEnabled ? <TreeBackground roomCode={normalized} /> : null}
        <ChatPanel roomCode={normalized} />
      </div>

      <aside className="col-span-1 flex min-h-0 flex-col bg-card">
        <Tabs defaultValue="highlights" className="flex h-full min-h-0 flex-col">
          <TabsList className="m-3">
            <TabsTrigger value="highlights">Highlights</TabsTrigger>
            <TabsTrigger value="search">Search</TabsTrigger>
          </TabsList>
          <TabsContent value="highlights" className="min-h-0 flex-1 overflow-y-auto">
            <HighlightsPanel roomCode={normalized} />
          </TabsContent>
          <TabsContent value="search" className="min-h-0 flex-1 overflow-y-auto">
            <SearchPanel />
          </TabsContent>
        </Tabs>
      </aside>
    </div>
  );
}
