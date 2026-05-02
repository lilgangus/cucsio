"use client";

import { useEffect, useMemo } from "react";
import { useSWRConfig } from "swr";
import {
  ChatSession,
  MockChatDriver,
  useChatSessionCtx,
} from "@/components/chat";
import { MOCK_USER_ROWS } from "@/components/chat/chat-session.mock";
import { Backboard } from "@/components/highlights";
import { Button } from "@/components/ui/button";
import type { Identity } from "@/lib/identity";
import type { UserRow } from "@/types/db";

const DEV_IDENTITY: Identity = {
  clientId: "dev-user",
  displayName: "Dev User",
  color: "#3b82f6",
};

const MOCK_USER_MAP = MOCK_USER_ROWS.reduce<Record<string, UserRow>>((acc, user) => {
  acc[user.id] = user;
  return acc;
}, {});

function invokeMock(action: () => void) {
  action();
}

function buildLongMarkdownReply(): string {
  const chunk =
    "## Hydroponics check-in\n\n" +
    "- nutrient loops stay closed\n" +
    "- water recovery stays above 98%\n" +
    "- leaf crops buffer morale\n\n" +
    "The habitat keeps learning from each harvest cycle. ";

  return chunk.repeat(Math.ceil(5000 / chunk.length)).slice(0, 5000);
}

async function streamLongReply() {
  const api = window.__chatMock;
  if (!api) return;

  const text = buildLongMarkdownReply();
  const chunkCount = 30;
  const chunkSize = Math.ceil(text.length / chunkCount);

  api.assistantStart();

  for (let index = 0; index < text.length; index += chunkSize) {
    api.chunk(text.slice(index, index + chunkSize));
    await new Promise((resolve) => window.setTimeout(resolve, 100));
  }

  api.assistantDone();
}

function MockUsersSeed() {
  const session = useChatSessionCtx();
  const { mutate } = useSWRConfig();
  const authorIds = useMemo(() => {
    return Array.from(
      new Set(
        session.messages
          .map((message) => message.author_id)
          .filter((authorId): authorId is string => Boolean(authorId))
          .concat(DEV_IDENTITY.clientId)
      )
    ).sort();
  }, [session.messages]);

  useEffect(() => {
    // Mock-only seam: seed the SWR users cache so `useUsers()` can stay
    // identical between the dev playground and the real Supabase-backed UI.
    const seedSubset = (subset: string[]) => {
      const seededUsers = subset.reduce<Record<string, UserRow>>((acc, authorId) => {
        if (MOCK_USER_MAP[authorId]) {
          acc[authorId] = MOCK_USER_MAP[authorId];
        }
        return acc;
      }, {});

      void mutate(["users", subset.join(",")], seededUsers, { revalidate: false });
    };

    seedSubset(authorIds);

    for (const authorId of authorIds) {
      seedSubset([authorId]);
    }
  }, [authorIds, mutate]);

  return null;
}

export default function DevChatPage() {
  return (
    <MockChatDriver>
      <MockUsersSeed />

      <main className="flex min-h-screen flex-col bg-muted/30">
        <div className="border-b border-border bg-background px-4 py-3">
          <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-2">
            <Button
              variant="outline"
              onClick={() =>
                invokeMock(() => window.__chatMock?.userMsg("user-2", "hello"))
              }
            >
              Push user msg
            </Button>
            <Button
              variant="outline"
              onClick={() => invokeMock(() => window.__chatMock?.assistantStart())}
            >
              Start AI stream
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                invokeMock(() => window.__chatMock?.chunk("lorem ipsum "))
              }
            >
              Push chunk
            </Button>
            <Button
              variant="outline"
              onClick={() => invokeMock(() => window.__chatMock?.assistantDone())}
            >
              End AI stream
            </Button>
            <Button variant="outline" onClick={() => void streamLongReply()}>
              Long AI reply
            </Button>
          </div>
        </div>

        <section className="flex flex-1 min-h-0 px-4 py-6">
          <div className="mx-auto grid w-full max-w-6xl min-h-0 grid-cols-[minmax(0,1fr)_320px] gap-4">
            <div className="min-h-0 overflow-hidden rounded-lg border border-border bg-background shadow-sm">
              <ChatSession
                sessionId="mock"
                projectId="mock"
                identity={DEV_IDENTITY}
              />
            </div>
            <div className="min-h-0 overflow-hidden rounded-lg border border-border bg-background shadow-sm">
              <Backboard projectId="mock" />
            </div>
          </div>
        </section>
      </main>
    </MockChatDriver>
  );
}
