import type {
  HighlightRow,
  MessageRow,
  ProjectRow,
  SessionRow,
} from "@/types/db";

/**
 * Two channels per project (see AGENTS.md):
 *   - project:{projectId}  — broadcast: master context edits, new sessions,
 *                            new highlights, session metadata bumps.
 *   - session:{sessionId}  — broadcast: new messages, assistant chunks;
 *                            presence: who is currently viewing.
 *
 * The DB is the source of truth; broadcast events are eventually-consistent
 * hints. If a client misses a broadcast, the next read from Postgres will
 * reconcile.
 */

export const projectChannel = (projectId: string) => `project:${projectId}`;
export const sessionChannel = (sessionId: string) => `session:${sessionId}`;

export const PROJECT_BROADCAST_EVENT = "project_event";
export const SESSION_BROADCAST_EVENT = "session_event";

export type ProjectEvent =
  | {
      type: "master_context";
      projectId: string;
      masterContext: string;
      authorClientId: string;
    }
  | {
      type: "session_created";
      session: SessionRow;
    }
  | {
      type: "session_updated";
      session: Pick<
        SessionRow,
        "id" | "label" | "summary" | "last_activity_at" | "message_count"
      >;
    }
  | {
      type: "highlight_created";
      highlight: HighlightRow;
    }
  | {
      type: "project_updated";
      project: Pick<ProjectRow, "id" | "name" | "updated_at">;
    };

export type SessionEvent =
  | {
      type: "user_msg";
      message: MessageRow;
    }
  | {
      type: "assistant_chunk";
      sessionId: string;
      tmpId: string;
      delta: string;
    }
  | {
      type: "assistant_done";
      message: MessageRow;
    }
  | {
      type: "stream_error";
      sessionId: string;
      tmpId: string;
      error: string;
    };

export type PresenceState = {
  clientId: string;
  displayName: string;
  color: string;
  joinedAt: string;
  /**
   * For **project-channel** presence: which session node's chat overlay
   * this client currently has focused (ForestCanvas `session` overlay).
   * `null` / omitted means they are only browsing the tree (no chat open).
   *
   * For **session-channel** presence (inside `session:<id>`) this mirrors
   * the channel id implicitly — callers may omit it or set it to the
   * same session id as a sanity check.
   */
  focusedSessionId?: string | null;
};
