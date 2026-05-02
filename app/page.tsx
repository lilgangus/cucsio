"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { toast } from "sonner";

import { AccountMenu } from "@/components/account-menu";
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
import { ApiError, createProject } from "@/lib/api";
import { type Identity } from "@/lib/identity";
import { projectExistsByCode } from "@/lib/projects";
import { isValidRoomCode, normalizeRoomCode } from "@/lib/room-code";
import { safeNextPath } from "@/lib/safe-next";

export default function LandingPage() {
  // useSearchParams must be inside a Suspense boundary in Next.js 16.
  return (
    <Suspense
      fallback={
        <main className="flex flex-1 flex-col items-center justify-center px-6 py-16" />
      }
    >
      <Landing />
    </Suspense>
  );
}

function Landing() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = safeNextPath(searchParams.get("next"));
  const hasRedirect = nextPath !== "/";

  const [identity, setIdentity] = useState<Identity | null>(null);
  const [projectName, setProjectName] = useState("");
  const [initialSessionTarget, setInitialSessionTarget] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [creating, setCreating] = useState(false);
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [showIdentityDialog, setShowIdentityDialog] = useState(hasRedirect);

  const ready = identity !== null;

  // If we got bounced back here from a room URL, send the user straight
  // back as soon as identity is established.
  useEffect(() => {
    if (identity && hasRedirect) {
      router.replace(nextPath);
    }
  }, [identity, hasRedirect, nextPath, router]);

  const handleCreate = async () => {
    if (!ready) return;
    const name = projectName.trim();
    const target = initialSessionTarget.trim();
    if (!name) {
      toast.error("Pick a project name first");
      return;
    }
    if (!target) {
      toast.error("Add an initial session target");
      return;
    }
    setCreating(true);
    try {
      const { project } = await createProject({
        name,
        initialSessionTarget: target,
      });
      router.push(`/${project.room_code}`);
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : "Could not create project";
      toast.error(message);
      setCreating(false);
    }
  };

  const handleJoin = async () => {
    if (!ready || joining) return;
    const code = normalizeRoomCode(joinCode);
    if (!isValidRoomCode(code)) {
      setJoinError("Code must be 6 letters or digits");
      return;
    }
    setJoining(true);
    setJoinError(null);
    try {
      const exists = await projectExistsByCode(code);
      if (!exists) {
        setJoinError("This code is not available");
        setJoining(false);
        return;
      }
      router.push(`/${code}`);
    } catch (err) {
      console.warn("[landing] join lookup failed", err);
      setJoinError("Could not check the code. Try again.");
      setJoining(false);
    }
  };

  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6 py-16">
      <IdentityDialog
        onReady={setIdentity}
        open={showIdentityDialog}
        onOpenChange={setShowIdentityDialog}
      />

      <header className="mb-10 flex flex-col items-center gap-3 text-center">
        <h1 className="font-heading text-4xl font-semibold tracking-tight">
          cucsio
        </h1>
        <p className="max-w-md text-muted-foreground">
          A multiplayer ChatGPT-style workspace. Open a room, share the code,
          and explore branching conversations together.
        </p>
        {hasRedirect ? (
          <div className="rounded-md border border-border bg-muted/50 px-3 py-1.5 text-xs text-muted-foreground">
            Pick a name to continue to <code className="font-mono">{nextPath}</code>
          </div>
        ) : null}
        {identity ? (
          <AccountMenu
            identity={identity}
            onSignedOut={() => setIdentity(null)}
          />
        ) : (
          <Button onClick={() => setShowIdentityDialog(true)}>
            Log in with username
          </Button>
        )}
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
                if (e.key === "Enter") void handleCreate();
              }}
              maxLength={64}
              disabled={!ready || creating}
            />
            <Input
              placeholder="Initial session target (e.g. Find root cause of latency)"
              value={initialSessionTarget}
              onChange={(e) => setInitialSessionTarget(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleCreate();
              }}
              maxLength={240}
              disabled={!ready || creating}
            />
            <Button
              className="w-full"
              onClick={() => void handleCreate()}
              disabled={
                !ready ||
                creating ||
                projectName.trim().length === 0 ||
                initialSessionTarget.trim().length === 0
              }
            >
              {creating ? "Creating..." : "Create project"}
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
              onChange={(e) => {
                setJoinCode(
                  e.target.value.replace(/[^a-z0-9]/gi, "").slice(0, 6)
                );
                if (joinError) setJoinError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleJoin();
              }}
              maxLength={6}
              disabled={!ready || joining}
              aria-invalid={joinError ? true : undefined}
              className="font-mono uppercase tracking-widest"
            />
            <Button
              className="w-full"
              variant="outline"
              onClick={() => void handleJoin()}
              disabled={!ready || joining || !isValidRoomCode(joinCode)}
            >
              {joining ? "Checking..." : "Join"}
            </Button>
            {joinError ? (
              <p
                role="alert"
                className="text-xs text-destructive"
              >
                {joinError}
              </p>
            ) : null}
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
