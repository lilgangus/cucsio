"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { ChatSession } from "@/components/chat";
import { Button } from "@/components/ui/button";
import { useRoomProject, type RoomSession } from "@/lib/chat/use-room-project";
import { authHeaders, loadIdentity, type Identity } from "@/lib/identity";

type Props = {
  roomCode: string;
};

export function ChatPanel({ roomCode }: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedSessionId = searchParams.get("session");
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [identityReady, setIdentityReady] = useState(false);
  const [creatingSession, setCreatingSession] = useState(false);
  const { data: room, error, isLoading, mutate } = useRoomProject(roomCode);

  useEffect(() => {
    // Reading from localStorage is a sync-with-external-system operation
    // (it isn't reachable during SSR), so the setState branches below are
    // the intended escape hatch from the new react-hooks/set-state-in-effect
    // lint. See AGENTS.md "Identity (no auth)".
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIdentity(loadIdentity());
    setIdentityReady(true);
  }, []);

  const activeSession = useMemo(() => {
    if (!room) return null;

    const availableSessions = room.sessions.filter((session) => !session.is_archived);
    if (availableSessions.length === 0) {
      return null;
    }

    if (requestedSessionId) {
      return (
        availableSessions.find((session) => session.id === requestedSessionId) ??
        availableSessions[0]
      );
    }

    return availableSessions[0];
  }, [requestedSessionId, room]);

  const createSession = async () => {
    if (!identity || !room) return;

    setCreatingSession(true);

    try {
      const response = await fetch("/api/sessions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders(identity),
        },
        // TODO(Dev A): remove this fallback once project creation always
        // provisions an initial session for newly-created rooms.
        body: JSON.stringify({ projectId: room.id }),
      });

      if (!response.ok) {
        throw new Error(`Create session failed: ${response.status}`);
      }

      const { session } = (await response.json()) as { session: RoomSession };

      await mutate(
        (current) =>
          current
            ? {
                ...current,
                sessions: [...current.sessions, session].sort(
                  (left, right) =>
                    new Date(left.created_at).getTime() -
                    new Date(right.created_at).getTime()
                ),
              }
            : current,
        { revalidate: false }
      );

      const nextParams = new URLSearchParams(searchParams.toString());
      nextParams.set("session", session.id);
      router.replace(`${pathname}?${nextParams.toString()}`);
      void mutate();
      toast.success("Session created.");
    } catch (createError) {
      toast.error(
        createError instanceof Error ? createError.message : "Could not create session"
      );
    } finally {
      setCreatingSession(false);
    }
  };

  const availableSessionCount = room?.sessions.filter((session) => !session.is_archived).length;

  return (
    <section className="relative z-10 flex h-full min-h-0 flex-1 flex-col bg-background/80 backdrop-blur-sm">
      {!identityReady || isLoading ? (
        <div className="flex flex-1 items-center justify-center p-8 text-sm text-muted-foreground">
          Loading room...
        </div>
      ) : null}

      {identityReady && !identity ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
          <p className="max-w-sm text-sm text-muted-foreground">
            Pick a display name on the landing page before joining a room.
          </p>
          <Link
            href="/"
            className="text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            Return home
          </Link>
        </div>
      ) : null}

      {identityReady && identity && error ? (
        <div className="flex flex-1 items-center justify-center p-8 text-sm text-destructive">
          Could not load room data.
        </div>
      ) : null}

      {identityReady && identity && !isLoading && !error && !room ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
          <p className="max-w-sm text-sm text-muted-foreground">
            No project found for code <code className="font-mono">{roomCode}</code>.
          </p>
          <Link
            href="/"
            className="text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            Back to landing page
          </Link>
        </div>
      ) : null}

      {identityReady && identity && room && availableSessionCount === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
          <div className="space-y-2">
            <h2 className="font-heading text-lg text-foreground">No sessions yet</h2>
            <p className="max-w-sm text-sm text-muted-foreground">
              Create the first chat thread for this room and we&apos;ll drop you into it.
            </p>
          </div>
          <Button onClick={createSession} disabled={creatingSession}>
            {creatingSession ? "Creating..." : "Create one"}
          </Button>
        </div>
      ) : null}

      {identityReady && identity && room && activeSession ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <ChatSession
            key={activeSession.id}
            sessionId={activeSession.id}
            projectId={room.id}
            identity={identity}
          />
        </div>
      ) : null}
    </section>
  );
}
