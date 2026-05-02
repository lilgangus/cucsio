/**
 * Forest UI data model.
 *
 * Each "node" in the forest is one row in the `sessions` table. A node
 * holds an entire chat (many `messages` rows). A "tree" is the
 * connected component reached from a root session
 * (`parent_session_id IS NULL`) by walking child edges.
 *
 * The visual model is intentionally a thin projection of the DB schema:
 *
 *   sessions row     →   ForestNode
 *   parent_session_id →   ForestNode.parentId
 *   no parent        →   tree root
 *
 * Branching is already n-ary — linear chains are just the
 * `children.length === 1` case of the same layout pass.
 */

export type ForestNode = {
  id: string;
  treeId: string;
  parentId: string | null;
  /** Short label shown on the card. Falls back to "Untitled" if empty. */
  label: string;
  /** Longer line shown beneath the label; from `sessions.summary`. */
  summary: string;
  messageCount: number;
  createdAt: number;
  /**
   * Lock state mirrored from `sessions.pending_user_id`. Null when no
   * one is sending; a clientId when someone is mid-turn.
   */
  pendingUserId: string | null;
};

export type ForestTree = {
  id: string;
  rootId: string;
  createdAt: number;
};

export type Forest = {
  trees: ForestTree[];
  nodes: Record<string, ForestNode>;
};

/**
 * What the overlay is currently focused on:
 *   - "session": an existing session (the common case).
 *   - "new-tree": "+ new chat" was clicked but no session has been
 *     created yet. Sending the first message creates it on the server.
 *   - "new-fork": "Branch off" was clicked from a session. The fork
 *     hasn't been created yet — sending the first message kicks off
 *     POST /sessions/:parent/fork and then sends into the result.
 *
 * Keeping the "pending" intents client-side means we don't litter the
 * DB with empty sessions when someone clicks + and then closes.
 */
export type OverlayTarget =
  | { kind: "session"; sessionId: string }
  | { kind: "new-tree" }
  | { kind: "new-fork"; parentSessionId: string };

export type NodePosition = { x: number; y: number };

export type LaidOutEdge = { from: string; to: string };

export type LaidOutTree = {
  treeId: string;
  offsetX: number;
  width: number;
  height: number;
  positions: Record<string, NodePosition>;
  edges: LaidOutEdge[];
};

export type LaidOutForest = {
  trees: LaidOutTree[];
  positions: Record<string, NodePosition>;
  edges: LaidOutEdge[];
  width: number;
  height: number;
};
