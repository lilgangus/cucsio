"use client";

import {
  CLIENT_ID_HEADER,
  loadIdentity,
  type Identity,
} from "@/lib/identity";
import type {
  MessageRow,
  ProjectRow,
  SessionRow,
  UserRow,
} from "@/types/db";

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

export type SendMessageResponse = {
  user: MessageRow;
  assistant: MessageRow;
};

/**
 * Send one message in a session. The server holds the session-wide
 * "currently sending" lock for the whole roundtrip; this throws an
 * `ApiError` with `status === 409` if someone else is mid-turn.
 */
export function sendMessage(
  sessionId: string,
  body: SendMessageBody
): Promise<SendMessageResponse> {
  return postJSON<SendMessageResponse>(
    `/api/sessions/${encodeURIComponent(sessionId)}/messages`,
    body
  );
}
