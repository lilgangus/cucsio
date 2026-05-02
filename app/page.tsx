"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { IdentityDialog } from "@/components/identity-dialog";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { authHeaders, displayLabel, type Identity } from "@/lib/identity";

const ROOM_CODE_LENGTH = 6;
const ROOM_CODE_RE = /^[a-z0-9]{6}$/i;

export default function LandingPage() {
  const router = useRouter();
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [projectName, setProjectName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [creating, setCreating] = useState(false);

  const ready = identity !== null;

  const syncIdentity = async (currentIdentity: Identity) => {
    const response = await fetch("/api/users/upsert", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders(currentIdentity),
      },
      body: JSON.stringify({
        displayName: currentIdentity.displayName,
        color: currentIdentity.color,
      }),
    });

    if (!response.ok) {
      throw new Error(`Identity sync failed: ${response.status}`);
    }
  };

  const handleCreate = async () => {
    if (!identity) return;
    const name = projectName.trim();
    if (!name) {
      toast.error("Pick a project name first");
      return;
    }
    setCreating(true);
    try {
      await syncIdentity(identity);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not sync your identity"
      );
      setCreating(false);
      return;
    }
    // TODO(api): POST /api/projects { name } with x-client-id header,
    //            read { code } from the response, then router.push.
    //            For now we mint a fake code locally so the room shell is
    //            navigable end-to-end without a backend.
    console.warn(
      "[cucsio] create-project API not implemented yet — using a local fake code"
    );
    const fakeCode = Math.random()
      .toString(36)
      .replace(/[^a-z0-9]/g, "")
      .slice(0, ROOM_CODE_LENGTH)
      .padEnd(ROOM_CODE_LENGTH, "x");
    router.push(`/${fakeCode}`);
  };

  const handleJoin = async () => {
    if (!identity) return;
    const code = joinCode.trim().toLowerCase();
    if (!ROOM_CODE_RE.test(code)) {
      toast.error("Room code must be 6 letters or digits");
      return;
    }
    try {
      await syncIdentity(identity);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not sync your identity"
      );
      return;
    }
    router.push(`/${code}`);
  };

  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6 py-16">
      <IdentityDialog onReady={setIdentity} />

      <header className="mb-10 flex flex-col items-center gap-3 text-center">
        <h1 className="font-heading text-4xl font-semibold tracking-tight">
          cucsio
        </h1>
        <p className="max-w-md text-muted-foreground">
          A multiplayer ChatGPT-style workspace. Open a room, share the code,
          and explore branching conversations together.
        </p>
        {identity ? (
          <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs">
            <span
              className="size-2 rounded-full"
              style={{ background: identity.color }}
              aria-hidden
            />
            <span>You are {displayLabel(identity)}</span>
          </div>
        ) : null}
      </header>

      <div className="grid w-full max-w-3xl gap-6 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Create a project</CardTitle>
            <CardDescription>Get a 6-character room code to share.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Input
              placeholder="Project name"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreate();
              }}
              maxLength={64}
              disabled={!ready || creating}
            />
            <Button
              className="w-full"
              onClick={handleCreate}
              disabled={!ready || creating || projectName.trim().length === 0}
            >
              Create project
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Join by code</CardTitle>
            <CardDescription>Hop into an existing project.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Input
              placeholder="6-char code"
              value={joinCode}
              onChange={(e) =>
                setJoinCode(e.target.value.replace(/[^a-z0-9]/gi, "").slice(0, 6))
              }
              onKeyDown={(e) => {
                if (e.key === "Enter") handleJoin();
              }}
              maxLength={6}
              disabled={!ready}
              className="font-mono uppercase tracking-widest"
            />
            <Button
              className="w-full"
              variant="outline"
              onClick={handleJoin}
              disabled={!ready || !ROOM_CODE_RE.test(joinCode.trim())}
            >
              Join
            </Button>
          </CardContent>
        </Card>
      </div>

      <p className="mt-10 max-w-md text-center text-xs text-muted-foreground">
        Hackathon MVP. No accounts, no passwords. Anyone with a room code can
        join. See <code className="font-mono">AGENTS.md</code> for scope.
      </p>
    </main>
  );
}
