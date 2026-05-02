"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

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
import { ApiError, upsertUser } from "@/lib/api";
import {
  ensureIdentity,
  loadIdentity,
  type Identity,
} from "@/lib/identity";

type Props = {
  /** Called once an identity is available AND has been upserted server-side. */
  onReady: (identity: Identity) => void;
};

async function syncIdentity(identity: Identity): Promise<void> {
  try {
    await upsertUser(
      { displayName: identity.displayName, color: identity.color },
      identity
    );
  } catch (err) {
    // Don't block the UI on a transient upsert failure; the user can
    // still navigate. Subsequent writes will retry the upsert path
    // (created_by may be NULL until then).
    if (err instanceof ApiError) {
      console.warn("[identity] upsert failed", err.status, err.message);
    } else {
      console.warn("[identity] upsert failed", err);
    }
    toast.warning("Couldn't sync your profile to the server (is the DB up?)");
  }
}

/**
 * Pops on first load when no identity exists in localStorage. After
 * the user picks a display name, mints + persists the identity locally
 * AND upserts it to the `users` table, then hands it back via `onReady`.
 *
 * If an identity already exists, fires `onReady` immediately and refreshes
 * the server row in the background (best-effort, non-blocking).
 */
export function IdentityDialog({ onReady }: Props) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    // localStorage isn't reachable during SSR, so this is the canonical
    // sync-with-external-system pattern; the setState branches are the
    // intended escape hatch from react-hooks/set-state-in-effect.
    const existing = loadIdentity();
    if (existing) {
      onReady(existing);
      // Best-effort background refresh of the row's last_seen_at.
      void syncIdentity(existing);
    } else {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOpen(true);
    }
  }, [onReady]);

  const submit = async () => {
    const trimmed = name.trim();
    if (trimmed.length === 0 || submitting) return;
    setSubmitting(true);
    const identity = ensureIdentity(trimmed);
    await syncIdentity(identity);
    setSubmitting(false);
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
            if (e.key === "Enter") void submit();
          }}
          placeholder="e.g. Alice"
          maxLength={32}
          disabled={submitting}
        />
        <DialogFooter>
          <Button
            onClick={() => void submit()}
            disabled={name.trim().length === 0 || submitting}
          >
            {submitting ? "Saving..." : "Continue"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
