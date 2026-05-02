"use client";

import { ChevronDownIcon, HomeIcon, LogOutIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  clearIdentity,
  displayLabel,
  type Identity,
} from "@/lib/identity";

type Props = {
  identity: Identity;
  /**
   * If true, the menu includes a "Leave room" entry that routes to "/"
   * without touching the local identity. Pass true from the room top
   * bar; omit from the landing page (where you're already at "/").
   */
  showLeaveRoom?: boolean;
  /** Optional callback after the local identity is cleared. */
  onSignedOut?: () => void;
};

const CONFIRM_TIMEOUT_MS = 3000;

/**
 * The user pill + popover used wherever someone needs to leave the
 * current room or fully sign out. Sign-out is intentionally two-click:
 * the first press flips the button to a destructive "Click again to
 * confirm" state for a few seconds. No global confirm dialog needed.
 */
export function AccountMenu({
  identity,
  showLeaveRoom = false,
  onSignedOut,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelConfirmTimer = () => {
    if (confirmTimer.current) {
      clearTimeout(confirmTimer.current);
      confirmTimer.current = null;
    }
  };

  // Reset the confirm state whenever the popover closes so the next
  // open starts fresh.
  useEffect(() => {
    if (!open) {
      cancelConfirmTimer();
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setConfirming(false);
    }
  }, [open]);

  useEffect(() => () => cancelConfirmTimer(), []);

  const handleSignOut = () => {
    if (!confirming) {
      setConfirming(true);
      cancelConfirmTimer();
      confirmTimer.current = setTimeout(() => {
        setConfirming(false);
      }, CONFIRM_TIMEOUT_MS);
      return;
    }
    cancelConfirmTimer();
    clearIdentity();
    toast.success("Signed out");
    setOpen(false);
    onSignedOut?.();
    router.push("/");
  };

  const handleLeaveRoom = () => {
    setOpen(false);
    router.push("/");
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-3 py-1 text-xs transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <span
              className="size-2 rounded-full"
              style={{ background: identity.color }}
              aria-hidden
            />
            <span>{displayLabel(identity)}</span>
            <ChevronDownIcon className="size-3 opacity-60" />
          </button>
        }
      />
      <PopoverContent align="end" className="w-64 gap-1 p-2">
        <div className="flex items-center gap-2 px-2 pt-1 pb-2">
          <span
            className="size-2.5 rounded-full"
            style={{ background: identity.color }}
            aria-hidden
          />
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-sm font-medium">
              {identity.displayName}
            </span>
            <span className="truncate font-mono text-[10px] text-muted-foreground">
              {identity.clientId}
            </span>
          </div>
        </div>

        <div className="-mx-2 border-t border-border" />

        {showLeaveRoom ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleLeaveRoom}
            className="w-full justify-start gap-2"
          >
            <HomeIcon />
            Leave room (keep identity)
          </Button>
        ) : null}

        <Button
          variant={confirming ? "destructive" : "ghost"}
          size="sm"
          onClick={handleSignOut}
          className="w-full justify-start gap-2"
        >
          <LogOutIcon />
          {confirming ? "Click again to confirm sign out" : "Sign out"}
        </Button>

        {confirming ? (
          <p className="px-2 pt-1 text-[11px] text-muted-foreground">
            Forgets <span className="font-mono">{identity.clientId.slice(0, 8)}</span>
            {" "}from this browser. Your past messages stay.
          </p>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
