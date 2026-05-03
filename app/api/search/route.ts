import { NextResponse } from "next/server";

import { encodeAgentEvent, type AgentEvent } from "@/lib/llm/agent-events";
import { makeEmitter, runSearchPipeline } from "@/lib/llm/agent-pipeline";
import { getSupabaseServer } from "@/lib/supabase/server";

type Body = {
  projectId?: unknown;
  query?: unknown;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Project-wide search.
 *
 * Streams the same `AgentEvent` NDJSON protocol the chat endpoint uses,
 * so the right-panel results card can render the identical "clinical
 * team" timeline (Differential brainstorming → Evidence retrieval →
 * Attending synthesis). The final `synthesis` phase text IS the answer;
 * we don't persist anything for search.
 *
 * The endpoint accepts either an Accept: application/x-ndjson hint or
 * just streams by default. Callers that want the legacy JSON shape can
 * pass `?format=json` — but our UI uses streaming.
 */
export async function POST(req: Request) {
  if (!process.env.OPENROUTER_API_KEY?.trim()) {
    return NextResponse.json(
      {
        error:
          "Server is missing OPENROUTER_API_KEY. Add it to .env.local (see .env.example).",
      },
      { status: 503 }
    );
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const projectId =
    typeof body.projectId === "string" ? body.projectId.trim() : "";
  const query = typeof body.query === "string" ? body.query.trim() : "";

  if (!UUID_RE.test(projectId)) {
    return NextResponse.json(
      { error: "projectId must be a uuid" },
      { status: 400 }
    );
  }
  if (query.length === 0 || query.length > 1000) {
    return NextResponse.json(
      { error: "query must be 1-1000 chars" },
      { status: 400 }
    );
  }

  const supabase = getSupabaseServer();

  const stream = new TransformStream<Uint8Array, Uint8Array>();
  const writer = stream.writable.getWriter();
  const emit = makeEmitter(writer);
  const encoder = new TextEncoder();

  const onClientGone = () => {
    void writer.close().catch(() => {});
  };
  req.signal.addEventListener("abort", onClientGone);

  void (async () => {
    try {
      await runSearchPipeline({
        emit,
        supabase,
        projectId,
        query,
      });
    } catch (err) {
      console.error("[/api/search] pipeline failed", err);
      try {
        const message = err instanceof Error ? err.message : "search failed";
        await writer.write(
          encoder.encode(
            encodeAgentEvent({ type: "error", message } as AgentEvent)
          )
        );
      } catch {
        /* writer closed */
      }
    } finally {
      try {
        await writer.write(
          encoder.encode(
            encodeAgentEvent({ type: "done", assistantMessageId: null })
          )
        );
      } catch {
        /* writer closed */
      }
      try {
        await writer.close();
      } catch {
        /* already closed */
      }
      req.signal.removeEventListener("abort", onClientGone);
    }
  })();

  return new Response(stream.readable, {
    status: 200,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-content-type-options": "nosniff",
      "x-agent-stream": "v1",
    },
  });
}
