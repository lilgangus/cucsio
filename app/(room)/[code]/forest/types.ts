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
  /**
   * The "primary" tree this node belongs to, used for layout column
   * assignment. For multi-parent nodes we assign them to the first
   * parent's tree; for roots it's their own id.
   */
  treeId: string;
  /**
   * Primary parent id — used for column positioning. Null for roots.
   * For single-parent forks this is the only parent; for merged nodes
   * it is `parentIds[0]`.
   */
  parentId: string | null;
  /**
   * All parent ids, including the primary one. Empty for root nodes.
   * Populated from the `session_parents` join table (migration 0004).
   * Multi-parent nodes render edges to each parent.
   */
  parentIds: string[];
  /** Short label shown on the card. */
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
 *   - "session":    an existing session (the common case).
 *   - "new-tree":   "+ new chat" was clicked; session created on first send.
 *   - "new-fork":   "New branch" clicked; fork created on first send.
 *   - "new-combine": "New chat with context" from toolbar (1+ selected);
 *                    multi-parent session created on first send.
 */
export type OverlayTarget =
  | { kind: "session"; sessionId: string }
  | { kind: "new-tree" }
  | { kind: "new-fork"; parentSessionId: string }
  | { kind: "new-combine"; parentSessionIds: string[] };

export type NodePosition = { x: number; y: number };

export type LaidOutEdge = {
  from: string;
  to: string;
  /** True for non-primary parent edges (multi-parent / combined-context nodes). Drawn dashed. */
  secondary?: boolean;
};

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
