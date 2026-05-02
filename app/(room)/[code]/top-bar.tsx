"use client";

import { CheckIcon, CopyIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { AccountMenu } from "@/components/account-menu";
import { PresenceBar } from "@/components/presence-bar";
import { Button } from "@/components/ui/button";
import { loadIdentity, type Identity } from "@/lib/identity";

type Props = {
  /** 6-char room code, already lowercased and validated upstream. */
  roomCode: string;
  /** Project UUID, used as the Realtime channel key for presence. */
  projectId: string;
  /** Project name, hydrated server-side in the room layout. */
  projectName: string;
};

/**
 * Top bar for the room shell. Renders project name, a click-to-copy
 * room code, the live presence bar, and the account menu (which
 * combines "Leave room" and "Sign out" actions).
 */
export function TopBar({ roomCode, projectId, projectName }: Props) {
  const [identity, setIdentity] = useState<Identity | null>(null);

  useEffect(() => {
    // localStorage is only reachable post-hydration; sync-with-external-
    // system read, canonical escape hatch from react-hooks/set-state-in-effect.
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

  return (
    <header className="flex h-14 items-center justify-between gap-4 border-b border-border bg-card px-4">
      <div className="flex items-center gap-3">
        <Link href="/" className="font-heading text-base font-semibold">
          cucsio
        </Link>
        <span className="text-sm text-muted-foreground">{projectName}</span>
      </div>

      <div className="flex items-center gap-3">
        <PresenceBar projectId={projectId} />

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
  );
}
