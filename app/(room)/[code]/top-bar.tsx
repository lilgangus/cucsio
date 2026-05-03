"use client";

import { CheckIcon, CopyIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { AccountMenu } from "@/components/account-menu";
import { PresenceBar } from "@/components/presence-bar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { loadIdentity, type Identity } from "@/lib/identity";
import { getSupabaseBrowser } from "@/lib/supabase/browser";

type Props = {
  /** 6-char room code, already lowercased and validated upstream. */
  roomCode: string;
  /** Project UUID — Realtime presence + Postgres updates. */
  projectId: string;
  /** Project name, hydrated server-side in the room layout. */
  projectName: string;
  /** Latest `projects.master_context` from the server snapshot. */
  initialMasterContext: string;
};

/**
 * Room header: branding, clickable project title (opens shared master prompt
 * editor, debounced Postgres writes, live merges when the textarea isn't
 * focused), copy room code, presence, account menu.
 */
export function TopBar({
  roomCode,
  projectId,
  projectName,
  initialMasterContext,
}: Props) {
  const [identity, setIdentity] = useState<Identity | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIdentity(loadIdentity());
  }, []);

  const [copied, setCopied] = useState(false);

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(roomCode);
      setCopied(true);
      toast.success("Room code copied");
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Could not copy");
    }
  };

  const [masterOpen, setMasterOpen] = useState(false);
  const [masterContext, setMasterContext] = useState(initialMasterContext);
  const masterLastWrittenRef = useRef(initialMasterContext);
  const masterTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMasterContext(initialMasterContext);
    masterLastWrittenRef.current = initialMasterContext;
  }, [initialMasterContext]);

  useEffect(() => {
    const supabase = getSupabaseBrowser();
    const channel = supabase
      .channel(`projects-master-context:${projectId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "projects",
          filter: `id=eq.${projectId}`,
        },
        (payload) => {
          const row = payload.new as { master_context?: string };
          if (typeof row.master_context !== "string") return;
          const textarea = masterTextareaRef.current;
          if (textarea && document.activeElement === textarea) {
            return;
          }
          masterLastWrittenRef.current = row.master_context;
          setMasterContext(row.master_context);
        }
      )
      .subscribe();

    return () => {
      void channel.unsubscribe();
      void supabase.removeChannel(channel);
    };
  }, [projectId]);

  useEffect(() => {
    const t = window.setTimeout(async () => {
      if (masterContext === masterLastWrittenRef.current) return;
      const supabase = getSupabaseBrowser();
      const next = masterContext;
      try {
        const { error } = await supabase
          .from("projects")
          .update({
            master_context: next,
            updated_at: new Date().toISOString(),
          })
          .eq("id", projectId);
        if (error) throw error;
        masterLastWrittenRef.current = next;
      } catch (e) {
        console.warn("[top-bar] master_context save failed", e);
        toast.error("Could not save master context");
      }
    }, 300);
    return () => window.clearTimeout(t);
  }, [masterContext, projectId]);

  return (
    <>
      <header className="flex h-14 items-center justify-between gap-4 border-b border-border bg-card px-4">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <Link href="/" className="font-heading text-base font-semibold">
            cucsio
          </Link>
          <button
            type="button"
            onClick={() => setMasterOpen(true)}
            className="group min-w-0 truncate text-left text-sm text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
            aria-label={`Edit project brief: ${projectName}`}
          >
            <span className="truncate font-medium text-foreground">
              {projectName}
            </span>
            <span className="ml-1 text-xs group-hover:text-muted-foreground">
              (brief)
            </span>
          </button>
        </div>

        <div className="flex shrink-0 items-center gap-3">
          <PresenceBar />

          <Button
            variant="outline"
            size="sm"
            onClick={copyCode}
            className="font-mono uppercase tracking-widest"
          >
            {copied ? <CheckIcon /> : <CopyIcon />}
            {roomCode}
          </Button>

          {identity ? (
            <AccountMenu
              identity={identity}
              showLeaveRoom
              onSignedOut={() => setIdentity(null)}
            />
          ) : null}
        </div>
      </header>

      <Dialog open={masterOpen} onOpenChange={setMasterOpen}>
        <DialogContent className="max-w-xl sm:max-w-xl" showCloseButton>
          <DialogHeader>
            <DialogTitle>{projectName} — project brief</DialogTitle>
            <DialogDescription>
              Shared prompt for everyone in this room. Included with every AI
              turn across sessions ({`system: master_context`} in AGENTS terms).
              Only overwrites elsewhere while you aren&apos;t typing here.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2 pt-2">
            <label htmlFor="master-context" className="sr-only">
              Master context
            </label>
            <Textarea
              id="master-context"
              ref={masterTextareaRef}
              rows={12}
              value={masterContext}
              onChange={(e) => setMasterContext(e.target.value)}
              placeholder="Goals, glossary, conventions, URLs — anything teammates and the assistant should constantly remember about this project."
              className="min-h-[200px] resize-y font-mono text-xs leading-relaxed"
            />
          </div>
          <Button
            type="button"
            variant="outline"
            className="self-end"
            onClick={() => setMasterOpen(false)}
          >
            Done
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}
