import type { SessionRow } from "@/types/db";

import type {
  Forest,
  ForestNode,
  ForestTree,
  LaidOutEdge,
  LaidOutForest,
  LaidOutTree,
  NodePosition,
} from "./types";

/**
 * Project a flat list of `sessions` rows (plus the full parent-edges
 * map from `useProjectParents`) into the visual `Forest` shape.
 *
 * DAG layout strategy:
 *   - A node's "primary" parent (`sessions.parent_session_id`) is the
 *     one used for the column-positioning layout pass.  We still draw
 *     edges for ALL parents from `parentIds`.
 *   - Multi-parent (combined-context) nodes are placed in the tree of
 *     their primary parent; secondary parent edges become dashed
 *     cross-tree connectors in the SVG layer.
 *   - Root nodes have no parents; they each start their own tree.
 */
export function buildForestFromSessions(
  sessions: SessionRow[],
  /**
   * Map of session_id → parent_id[] from `useProjectParents`.
   * When omitted (e.g. before the hook resolves) we fall back to
   * reading `parent_session_id` from the session row only.
   */
  parentsBySession: Record<string, string[]> = {}
): Forest {
  const byId = new Map(sessions.map((s) => [s.id, s] as const));

  const treeIdFor = (sessionId: string, seen = new Set<string>()): string | null => {
    let cursor: SessionRow | undefined = byId.get(sessionId);
    while (cursor) {
      if (seen.has(cursor.id)) return null; // cycle guard
      seen.add(cursor.id);
      if (!cursor.parent_session_id) return cursor.id;
      const parent = byId.get(cursor.parent_session_id);
      if (!parent) return null;
      cursor = parent;
    }
    return null;
  };

  const trees: ForestTree[] = [];
  const nodes: Record<string, ForestNode> = {};

  for (const row of sessions) {
    const treeId = treeIdFor(row.id);
    if (!treeId) {
      console.warn("[forest] dropping orphan session", row.id);
      continue;
    }
    if (!row.parent_session_id) {
      trees.push({
        id: row.id,
        rootId: row.id,
        createdAt: Date.parse(row.created_at) || 0,
      });
    }

    // parentIds: prefer the live table over what the sessions row says,
    // because it includes all edges (single + multi-parent).
    const parentIds: string[] =
      parentsBySession[row.id] ??
      (row.parent_session_id ? [row.parent_session_id] : []);

    nodes[row.id] = {
      id: row.id,
      treeId,
      parentId: row.parent_session_id,
      parentIds,
      label:
        row.session_target?.trim() ||
        row.label?.trim() ||
        (row.parent_session_id ? "Fork" : "Main"),
      summary: row.summary,
      messageCount: row.message_count,
      createdAt: Date.parse(row.created_at) || 0,
      pendingUserId: row.pending_user_id,
    };
  }

  trees.sort((a, b) => a.createdAt - b.createdAt);
  return { trees, nodes };
}

/**
 * Pure tree/forest layout. Linear today, n-ary tomorrow.
 *
 * Strategy:
 *   1. For each tree, recursively compute a subtree width: leaves use one
 *      "slot" (NODE_W), parents use the sum of their childrens' slots.
 *   2. Place each parent horizontally centered above the span of its
 *      children. With one child (linear case) the parent sits directly
 *      above; with N children, the parent splits the difference.
 *   3. Trees in the forest are laid out side-by-side with TREE_GAP
 *      between them. The whole forest's width/height is the bounding box.
 *
 * All numbers are coordinate-space pixels. The renderer scales /
 * translates as needed.
 */

export const NODE_W = 220;
export const NODE_H = 88;
const H_GAP = 36;
const V_GAP = 56;
const TREE_GAP = 64;

export function layoutForest(forest: Forest): LaidOutForest {
  const trees: LaidOutTree[] = [];
  let cursorX = 0;
  let maxHeight = 0;

  for (const tree of forest.trees) {
    const laid = layoutOneTree(forest, tree.id, tree.rootId, cursorX);
    trees.push(laid);
    cursorX += laid.width + TREE_GAP;
    if (laid.height > maxHeight) maxHeight = laid.height;
  }

  const positions: Record<string, NodePosition> = {};
  const edges: LaidOutEdge[] = [];
  const edgeKey = (e: LaidOutEdge) => `${e.from}-${e.to}`;
  const seenKeys = new Set<string>();
  for (const t of trees) {
    Object.assign(positions, t.positions);
    for (const e of t.edges) {
      const k = edgeKey(e);
      if (seenKeys.has(k)) continue;
      seenKeys.add(k);
      edges.push(e);
    }
  }

  // Drop the trailing TREE_GAP so the bounding box is tight.
  const width = trees.length === 0 ? 0 : cursorX - TREE_GAP;

  return { trees, positions, edges, width, height: maxHeight };
}

function layoutOneTree(
  forest: Forest,
  treeId: string,
  rootId: string,
  offsetX: number
): LaidOutTree {
  const childMap = new Map<string, string[]>();
  for (const node of Object.values(forest.nodes)) {
    if (node.treeId !== treeId) continue;
    if (node.parentId == null) continue;
    const existing = childMap.get(node.parentId);
    if (existing) existing.push(node.id);
    else childMap.set(node.parentId, [node.id]);
  }
  // Stable ordering so re-renders don't shuffle the tree.
  for (const arr of childMap.values()) {
    arr.sort((a, b) => {
      const na = forest.nodes[a];
      const nb = forest.nodes[b];
      return (na?.createdAt ?? 0) - (nb?.createdAt ?? 0);
    });
  }

  const positions: Record<string, NodePosition> = {};
  let maxDepth = 0;

  const placeSubtree = (nodeId: string, leftEdge: number, depth: number): number => {
    if (depth > maxDepth) maxDepth = depth;
    const children = childMap.get(nodeId) ?? [];
    if (children.length === 0) {
      positions[nodeId] = {
        x: leftEdge + NODE_W / 2,
        y: depth * (NODE_H + V_GAP) + NODE_H / 2,
      };
      return NODE_W;
    }
    let cursor = leftEdge;
    for (let i = 0; i < children.length; i++) {
      const childWidth = placeSubtree(children[i], cursor, depth + 1);
      cursor += childWidth;
      if (i < children.length - 1) cursor += H_GAP;
    }
    const totalWidth = cursor - leftEdge;
    const firstChildPos = positions[children[0]];
    const lastChildPos = positions[children[children.length - 1]];
    const center = (firstChildPos.x + lastChildPos.x) / 2;
    positions[nodeId] = {
      x: center,
      y: depth * (NODE_H + V_GAP) + NODE_H / 2,
    };
    return Math.max(NODE_W, totalWidth);
  };

  const treeWidth = placeSubtree(rootId, 0, 0);

  // Apply forest x-offset to every position.
  for (const id of Object.keys(positions)) {
    positions[id] = { x: positions[id].x + offsetX, y: positions[id].y };
  }

  // Emit edges for ALL parents, not just the primary one. Secondary-
  // parent edges (crossing tree boundaries for combined-context nodes)
  // are flagged so the renderer can style them differently (dashed).
  const edges: LaidOutEdge[] = [];
  for (const node of Object.values(forest.nodes)) {
    if (node.treeId !== treeId) continue;
    const uniqueParents = [...new Set(node.parentIds)];
    for (const pid of uniqueParents) {
      edges.push({ from: pid, to: node.id, secondary: pid !== node.parentId });
    }
  }

  const height = (maxDepth + 1) * NODE_H + maxDepth * V_GAP;

  return { treeId, offsetX, width: treeWidth, height, positions, edges };
}
