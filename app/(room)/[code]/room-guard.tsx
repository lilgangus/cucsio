"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { loadIdentity } from "@/lib/identity";
import { loginUrlFor } from "@/lib/safe-next";

type Props = {
  /** Room code; used to build the `?next=` redirect target. */
  roomCode: string;
};

/**
 * Bounce anyone hitting a room URL without a stored identity back to
 * the landing page, preserving the room URL in `?next=` so the landing
 * page can return them after they pick a name.
 *
 * Renders nothing while the redirect is in flight (and a tiny placeholder
 * during the SSR -> hydration window so the room shell doesn't flash
 * for someone who's about to be redirected).
 */
export function RoomGuard({ roomCode }: Props) {
  const router = useRouter();
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    // Sync-with-external-system read; canonical escape hatch for the
    // new react-hooks/set-state-in-effect lint.
    if (loadIdentity()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setChecked(true);
      return;
    }
    router.replace(loginUrlFor(`/${roomCode}`));
  }, [router, roomCode]);

  if (checked) return null;

  // Brief blank overlay so the room UI doesn't flash before the redirect
  // (only visible during the post-hydration tick).
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-[60] bg-background"
    />
  );
}
