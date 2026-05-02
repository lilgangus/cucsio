import dagre from "dagre";
import type { Edge, Node } from "reactflow";

/**
 * Lay out a fork tree top-down using dagre. Sessions are nodes,
 * parent_session_id edges are the tree links. Returns nodes with
 * absolute (x, y) populated so React Flow can render them without
 * its own layout pass.
 */

export type LayoutOptions = {
  nodeWidth?: number;
  nodeHeight?: number;
  rankSep?: number;
  nodeSep?: number;
};

const DEFAULTS: Required<LayoutOptions> = {
  nodeWidth: 220,
  nodeHeight: 80,
  rankSep: 80,
  nodeSep: 40,
};

export function layoutForkTree<T>(
  nodes: Node<T>[],
  edges: Edge[],
  options: LayoutOptions = {}
): { nodes: Node<T>[]; edges: Edge[] } {
  const opts = { ...DEFAULTS, ...options };

  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "TB", ranksep: opts.rankSep, nodesep: opts.nodeSep });
  g.setDefaultEdgeLabel(() => ({}));

  for (const node of nodes) {
    g.setNode(node.id, { width: opts.nodeWidth, height: opts.nodeHeight });
  }
  for (const edge of edges) {
    g.setEdge(edge.source, edge.target);
  }

  dagre.layout(g);

  const positioned = nodes.map((node) => {
    const { x, y } = g.node(node.id);
    return {
      ...node,
      position: { x: x - opts.nodeWidth / 2, y: y - opts.nodeHeight / 2 },
    };
  });

  return { nodes: positioned, edges };
}
