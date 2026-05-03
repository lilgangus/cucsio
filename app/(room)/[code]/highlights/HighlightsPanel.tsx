"use client";

import { PinIcon, Trash2Icon } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type MouseEvent,
} from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ApiError, deleteHighlight } from "@/lib/api";
import { useSessionFocus } from "@/lib/realtime/session-focus-context";
import { getSupabaseBrowser } from "@/lib/supabase/browser";
import { cn } from "@/lib/utils";
import type { HighlightRow } from "@/types/db";

import { useProjectSessions } from "../forest/hooks";

type Props = {
  projectId: string;
};

type EnrichedHighlight = HighlightRow & {
  sessionLabel: string;
};

/** Caption under each highlight: prefer authored purpose, not auto labels like "… fork". */
function sessionLabelFromRow(s: {
  id: string;
  label: string | null;
  session_target: string;
}): string {
  const target = s.session_target?.trim();
  if (target) return target;
  const label = s.label?.trim();
  if (label) return label;
  return `Session ${s.id.slice(0, 6)}`;
}

/**
 * Shared backboard: project highlights with deep-link back to source chat.
 */
export function HighlightsPanel({ projectId }: Props) {
  const { sessions } = useProjectSessions(projectId);
  const { openSessionChat } = useSessionFocus();
  const [rows, setRows] = useState<EnrichedHighlight[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const sessionIdsKey = useMemo(
    () => sessions.map((s) => s.id).sort().join(","),
    [sessions]
  );

  const loadHighlights = useCallback(async () => {
    setLoading(true);
    const ids = sessions.map((s) => s.id);
    if (ids.length === 0) {
      setRows([]);
      setLoading(false);
      setError(null);
      return;
    }
    const labelBySession = new Map(
      sessions.map((s) => [s.id, sessionLabelFromRow(s)] as const)
    );

    const supabase = getSupabaseBrowser();
    const { data, error: qErr } = await supabase
      .from("highlights")
      .select("*")
      .in("session_id", ids)
      .order("created_at", { ascending: false });

    if (qErr) {
      setError(qErr.message);
      setRows([]);
      setLoading(false);
      return;
    }

    const list = (data ?? []) as HighlightRow[];
    setRows(
      list.map((h) => ({
        ...h,
        sessionLabel:
          labelBySession.get(h.session_id) ?? h.session_id.slice(0, 8),
      }))
    );
    setError(null);
    setLoading(false);
  }, [sessions]);

  useEffect(() => {
    // Sync highlights list from Postgres when project sessions change.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async loader updates list state
    void loadHighlights();
  }, [loadHighlights, sessionIdsKey]);

  useEffect(() => {
    const ids = sessions.map((s) => s.id);
    if (ids.length === 0) return;

    const supabase = getSupabaseBrowser();
    const channel = supabase
      .channel(`highlights-feed:${projectId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "highlights",
        },
        (payload) => {
          const row = payload.new as HighlightRow;
          if (!ids.includes(row.session_id)) return;
          void loadHighlights();
        }
      )
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "highlights",
        },
        (payload) => {
          const oldRow = payload.old as Partial<HighlightRow> | null;
          const sid = oldRow?.session_id;
          if (sid != null && !ids.includes(sid)) return;
          void loadHighlights();
        }
      )
      .subscribe();

    return () => {
      void channel.unsubscribe();
      void supabase.removeChannel(channel);
    };
  }, [loadHighlights, projectId, sessions]);

  const onRemove = useCallback(
    async (highlightId: string, e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setRemovingId(highlightId);
      try {
        await deleteHighlight(highlightId);
        setRows((prev) => prev.filter((h) => h.id !== highlightId));
      } catch (err) {
        toast.error(
          err instanceof ApiError ? err.message : "Could not remove highlight"
        );
      } finally {
        setRemovingId(null);
      }
    },
    []
  );

  if (loading && rows.length === 0) {
    return (
      <div className="p-4 text-center text-sm text-muted-foreground">
        Loading highlights…
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 text-center text-sm text-destructive">{error}</div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-muted-foreground">
        <PinIcon className="size-6 opacity-40" />
        <p className="text-sm">
          Select text in any chat message, then choose{" "}
          <span className="font-medium text-foreground">Highlight</span> to
          pin it here.
        </p>
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-2 p-3">
      {rows.map((h) => (
        <li key={h.id}>
          <div
            className={cn(
              "relative rounded-xl border border-border bg-card text-left shadow-sm",
              "transition-colors hover:bg-muted/30"
            )}
          >
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="absolute top-1.5 right-1.5 z-10 text-muted-foreground hover:text-destructive"
              aria-label="Remove highlight"
              disabled={removingId === h.id}
              onClick={(e) => void onRemove(h.id, e)}
            >
              <Trash2Icon className="size-3.5" />
            </Button>
            <button
              type="button"
              className="flex w-full flex-col items-start gap-1 whitespace-normal rounded-xl px-3 py-2.5 pr-10 text-left"
              onClick={() =>
                openSessionChat(h.session_id, h.message_id ?? undefined)
              }
            >
              <span className="w-full line-clamp-3 text-sm text-foreground">
                {h.content}
              </span>
              <span className="text-[11px] text-muted-foreground">
                {h.sessionLabel}
              </span>
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}
