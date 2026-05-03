"use client";

import {
  CLIENT_ID_HEADER,
  loadIdentity,
  type Identity,
} from "@/lib/identity";
import type { HighlightRow, ProjectRow, SessionRow, UserRow } from "@/types/db";

/** Thrown by `postJSON` when the server returns a non-2xx. */
export class ApiError extends Error {
  status: number;
  payload: unknown;
  constructor(status: number, message: string, payload?: unknown) {
    super(message);
    this.status = status;
    this.payload = payload;
    this.name = "ApiError";
  }
}

/**
 * POST a JSON body and parse a JSON response. Automatically injects
 * the `x-client-id` header from the locally-stored identity so the
 * server can populate `created_by`. AGENTS.md don't-forget list:
 * "Always pass the clientId header on writes."
 */
async function postJSON<TRes, TBody = unknown>(
  url: string,
  body: TBody,
  identity?: Identity | null
): Promise<TRes> {
  const id = identity ?? loadIdentity();
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(id ? { [CLIENT_ID_HEADER]: id.clientId } : {}),
    },
    body: JSON.stringify(body),
  });

  let payload: unknown = null;
  try {
    payload = await res.json();
  } catch {
    // empty / non-JSON body
  }

  if (!res.ok) {
    const message =
      (payload && typeof payload === "object" && "error" in payload
        ? String((payload as { error: unknown }).error)
        : null) ?? `Request to ${url} failed with ${res.status}`;
    throw new ApiError(res.status, message, payload);
  }

  return payload as TRes;
}

// --- Typed wrappers ---------------------------------------------------------

export type UpsertUserBody = {
  displayName: string;
  color: string;
};

export type UpsertUserResponse = {
  user: UserRow;
};

export function upsertUser(
  body: UpsertUserBody,
  identity: Identity
): Promise<UpsertUserResponse> {
  return postJSON<UpsertUserResponse>("/api/users/upsert", body, identity);
}

export type CreateProjectBody = {
  name: string;
  initialSessionTarget: string;
};

export type CreateProjectResponse = {
  project: ProjectRow;
  session: SessionRow;
};

export function createProject(
  body: CreateProjectBody
): Promise<CreateProjectResponse> {
  return postJSON<CreateProjectResponse>("/api/projects", body);
}

export type SearchProjectBody = {
  projectId: string;
  query: string;
};

export type SearchProjectResponse = {
  answer: string;
  selectedSessionIds: string[];
  searchPlan: string;
};

export function searchProject(
  body: SearchProjectBody
): Promise<SearchProjectResponse> {
  return postJSON<SearchProjectResponse>("/api/search", body);
}

// --- Sessions / chat -------------------------------------------------------

export type CreateSessionBody = {
  projectId: string;
  label?: string;
  sessionTarget?: string;
};

export type CreateSessionResponse = { session: SessionRow };

/** Plant a brand-new tree (a session with no parent). */
export function createSession(
  body: CreateSessionBody
): Promise<CreateSessionResponse> {
  return postJSON<CreateSessionResponse>("/api/sessions", body);
}

export type ForkSessionBody = {
  /** Optional. Omit to fork from the latest message in the parent. */
  forkPointMessageId?: string;
  label?: string;
  sessionTarget?: string;
};

export type ForkSessionResponse = {
  session: SessionRow;
};

/** Branch off from an existing session (no message duplication). */
export function forkSession(
  parentId: string,
  body: ForkSessionBody = {}
): Promise<ForkSessionResponse> {
  return postJSON<ForkSessionResponse>(
    `/api/sessions/${encodeURIComponent(parentId)}/fork`,
    body
  );
}

export type SendMessageBody = { content: string };

export type SendMessageOptions = {
  /** Fires as assistant tokens arrive (`text/plain` stream body). */
  onAssistantDelta?: (accumulatedText: string) => void;
  /** Abort to cancel the stream (e.g. user closed chat); server clears session lock. */
  signal?: AbortSignal;
};

/**
 * Send one message in a session. The assistant reply streams as UTF-8 text;
 * optional `onAssistantDelta` receives the growing string. The final message
 * is still saved by the server and appears via Realtime. This throws an
 * `ApiError` with `status === 409` if someone else is mid-turn.
 */
export async function sendMessage(
  sessionId: string,
  body: SendMessageBody,
  options?: SendMessageOptions
): Promise<void> {
  const id = loadIdentity();
  const res = await fetch(
    `/api/sessions/${encodeURIComponent(sessionId)}/messages`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(id ? { [CLIENT_ID_HEADER]: id.clientId } : {}),
      },
      body: JSON.stringify(body),
      signal: options?.signal,
    }
  );

  if (!res.ok) {
    let payload: unknown = null;
    try {
      payload = await res.json();
    } catch {
      /* empty or non-json */
    }
    const message =
      payload && typeof payload === "object" && "error" in payload
        ? String((payload as { error: unknown }).error)
        : `Request failed with ${res.status}`;
    throw new ApiError(res.status, message, payload);
  }

  if (!res.body) {
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let accumulated = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      accumulated += decoder.decode(value, { stream: true });
      options?.onAssistantDelta?.(accumulated);
    }
  } finally {
    reader.releaseLock();
  }
}

// --- Highlights --------------------------------------------------------------

export type CreateHighlightBody = {
  sessionId: string;
  messageId: string;
  /** Selected substring — must appear in the persisted message `content`. */
  content: string;
};

export type CreateHighlightResponse = { highlight: HighlightRow };

export function createHighlight(
  body: CreateHighlightBody
): Promise<CreateHighlightResponse> {
  return postJSON<CreateHighlightResponse>("/api/highlights", body);
}

export async function deleteHighlight(highlightId: string): Promise<void> {
  const id = loadIdentity();
  const res = await fetch(
    `/api/highlights/${encodeURIComponent(highlightId)}`,
    {
      method: "DELETE",
      headers: {
        ...(id ? { [CLIENT_ID_HEADER]: id.clientId } : {}),
      },
    }
  );

  if (res.status === 204) return;

  let payload: unknown = null;
  try {
    payload = await res.json();
  } catch {
    /* empty */
  }

  const message =
    payload && typeof payload === "object" && "error" in payload
      ? String((payload as { error: unknown }).error)
      : `Request failed with ${res.status}`;
  throw new ApiError(res.status, message, payload);
}

export type CombineContextsBody = {
  /** Parent session ids (no message copy; links only). */
  parentIds: string[];
  label?: string;
};

export type CombineContextsResponse = {
  session: SessionRow;
  parentIds: string[];
  copiedMessages: number;
};

/**
 * Create a new session from selected parent(s) (toolbar: "New chat with context").
 * Each id in `parentIds` gets a row in `session_parents`.
 */
export function combineContexts(
  body: CombineContextsBody
): Promise<CombineContextsResponse> {
  return postJSON<CombineContextsResponse>("/api/sessions/combine", body);
}
