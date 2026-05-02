"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  ensureIdentity,
  loadIdentity,
  type Identity,
} from "@/lib/identity";

type Props = {
  /** Called once an identity is available (whether pre-existing or just created). */
  onReady: (identity: Identity) => void;
};

/**
 * Pops on first load when no identity exists in localStorage. Once the
 * user picks a display name, mints + persists the identity and hands it
 * back via `onReady`. If an identity already exists, calls `onReady`
 * immediately and never opens.
 */
export function IdentityDialog({ onReady }: Props) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");

  useEffect(() => {
    // Reading from localStorage is a sync-with-external-system operation
    // (it isn't reachable during SSR), so the setState branches below are
    // the intended escape hatch from the new react-hooks/set-state-in-effect
    // lint. See AGENTS.md "Identity (no auth)".
    const existing = loadIdentity();
    if (existing) {
      onReady(existing);
    } else {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOpen(true);
    }
  }, [onReady]);

  const submit = () => {
    const trimmed = name.trim();
    if (trimmed.length === 0) return;
    const identity = ensureIdentity(trimmed);
    setOpen(false);
    onReady(identity);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Pick a display name</DialogTitle>
          <DialogDescription>
            Shown to everyone in your project. You can change it later.
          </DialogDescription>
        </DialogHeader>
        <Input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
          placeholder="e.g. Alice"
          maxLength={32}
        />
        <DialogFooter>
          <Button onClick={submit} disabled={name.trim().length === 0}>
            Continue
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
