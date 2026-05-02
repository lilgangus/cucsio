"use client";

import { CheckIcon, CopyIcon, LogOutIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button, buttonVariants } from "@/components/ui/button";
import { displayLabel, loadIdentity, type Identity } from "@/lib/identity";
import { cn } from "@/lib/utils";

type Props = {
  /** 6-char room code, already lowercased and validated upstream. */
  roomCode: string;
};

/**
 * Top bar for the room shell. Renders project name (TODO: hydrate from DB),
 * a click-to-copy room code, and the local user's display-name pill.
 */
export function TopBar({ roomCode }: Props) {
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    // localStorage is only reachable post-hydration; this is a sync-with-
    // external-system read, the canonical escape hatch from the new
    // react-hooks/set-state-in-effect lint.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIdentity(loadIdentity());
  }, []);

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

  return (
    <header className="flex h-14 items-center justify-between gap-4 border-b border-border bg-card px-4">
      <div className="flex items-center gap-3">
        <Link href="/" className="font-heading text-base font-semibold">
          cucsio
        </Link>
        <span className="text-sm text-muted-foreground">
          {/* TODO(landing): hydrate project name from /api/projects/by-code/[code] */}
          Untitled project
        </span>
      </div>

      <div className="flex items-center gap-2">
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
          <span className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-3 py-1 text-xs">
            <span
              className="size-2 rounded-full"
              style={{ background: identity.color }}
              aria-hidden
            />
            {displayLabel(identity)}
          </span>
        ) : null}

        <Link
          href="/"
          aria-label="Leave room"
          className={cn(
            buttonVariants({ variant: "ghost", size: "icon-sm" })
          )}
        >
          <LogOutIcon />
        </Link>
      </div>
    </header>
  );
}
