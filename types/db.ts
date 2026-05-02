/**
 * Hand-written TypeScript mirrors of the Postgres schema in
 * `db/migrations/0001_init.sql`. Per AGENTS.md: schema changes ship in
 * the same commit as updates to this file.
 *
 * Timestamps come over the wire from Supabase as ISO-8601 strings.
 */

export type Uuid = string;
export type IsoTimestamp = string;

export type MessageRole = "user" | "assistant" | "system";
export type HighlightSource = "user" | "ai";

export interface UserRow {
  id: Uuid;
  display_name: string;
  color: string;
  created_at: IsoTimestamp;
  last_seen_at: IsoTimestamp;
}

export interface ProjectRow {
  id: Uuid;
  name: string;
  room_code: string;
  master_context: string;
  created_by: Uuid | null;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

export interface SessionRow {
  id: Uuid;
  project_id: Uuid;
  parent_session_id: Uuid | null;
  fork_point_message_id: Uuid | null;
  label: string | null;
  tags: string[];
  summary: string;
  created_by: Uuid | null;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
  last_activity_at: IsoTimestamp;
  message_count: number;
  is_archived: boolean;
}

export interface MessageRow {
  id: Uuid;
  session_id: Uuid;
  role: MessageRole;
  author_id: Uuid | null;
  content: string;
  model: string | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  created_at: IsoTimestamp;
  edited_at: IsoTimestamp | null;
  is_deleted: boolean;
}

export interface SessionParticipantRow {
  session_id: Uuid;
  user_id: Uuid;
  joined_at: IsoTimestamp;
  last_active_at: IsoTimestamp;
  message_count: number;
}

export interface HighlightRow {
  id: Uuid;
  session_id: Uuid;
  message_id: Uuid | null;
  content: string;
  note: string | null;
  source: HighlightSource;
  created_by: Uuid | null;
  created_at: IsoTimestamp;
}
