// Turning a nested node/edge list into an ELK graph, and running the layout
// in a web worker (or inline where workers are unavailable, e.g. tests).

export interface LayoutNode {
  id: string;
  parent: string | null;
  width: number;
  height: number;
}

export interface LayoutEdge {
  id: string;
  source: string;
  target: string;
}

export interface ElkGraph {
  id: string;
  layoutOptions: Record<string, string>;
  children: ElkGraph[] | { id: string; width: number; height: number; layoutOptions?: Record<string, string>; children?: unknown[] }[];
  edges?: { id: string; sources: string[]; targets: string[] }[];
}

export interface LayoutRequest {
  id: number;
  graph: unknown;
}

export interface Point {
  x: number;
  y: number;
}

export interface LayoutResult {
  id: number;
  /** Node positions relative to the parent node (as React Flow expects for children). */
  positions: Record<string, { x: number; y: number; width: number; height: number }>;
  /** Edge routes in absolute (root) coordinates: start, bends, end. */
  edges: Record<string, Point[]>;
  ms: number;
  error?: string;
}

interface ElkOut {
  id: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  children?: ElkOut[];
  edges?: { id: string; sections?: { startPoint: Point; endPoint: Point; bendPoints?: Point[] }[] }[];
}

/** Positions and edge routes from an ELK result. */
export function collect(out: unknown): Pick<LayoutResult, "positions" | "edges"> {
  const positions: LayoutResult["positions"] = {};
  const edges: LayoutResult["edges"] = {};
  const walk = (n: ElkOut) => {
    for (const e of n.edges ?? []) {
      const s = e.sections?.[0];
      if (s) edges[e.id] = [s.startPoint, ...(s.bendPoints ?? []), s.endPoint];
    }
    for (const c of n.children ?? []) {
      positions[c.id] = { x: c.x ?? 0, y: c.y ?? 0, width: c.width ?? 0, height: c.height ?? 0 };
      walk(c);
    }
  };
  walk(out as ElkOut);
  return { positions, edges };
}

export type Direction = "RIGHT" | "DOWN";

/** Build the ELK graph: children nested under their parents, edges at the root. */
export function toElk(nodes: LayoutNode[], edges: LayoutEdge[], direction: Direction = "RIGHT"): unknown {
  const kids = new Map<string | null, LayoutNode[]>();
  for (const n of nodes) kids.set(n.parent, [...(kids.get(n.parent) ?? []), n]);
  const ids = new Set(nodes.map((n) => n.id));
  const nested = nodes.some((n) => n.parent);
  const opts: Record<string, string> = {
    "elk.algorithm": "layered",
    "elk.direction": direction,
    "elk.layered.spacing.nodeNodeBetweenLayers": "88",
    "elk.aspectRatio": "1.3",
    "elk.separateConnectedComponents": "true",
    "elk.spacing.componentComponent": "28",
    "elk.spacing.nodeNode": "18",
    "elk.spacing.edgeNode": "12",
    "elk.layered.nodePlacement.strategy": "BRANDES_KOEPF",
    "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
    "elk.edgeRouting": "ORTHOGONAL",
    "elk.layered.spacing.edgeEdgeBetweenLayers": "8",
    "elk.layered.spacing.edgeNodeBetweenLayers": "16",
  };
  // Model order keeps flat layouts stable between runs, but ELK's hierarchical
  // mode fails with it, so it is used only without nesting.
  if (!nested) opts["elk.layered.considerModelOrder.strategy"] = "NODES_AND_EDGES";
  const build = (n: LayoutNode): unknown => {
    const c = kids.get(n.id);
    if (!c?.length) return { id: n.id, width: n.width, height: n.height };
    return {
      id: n.id,
      layoutOptions: { ...opts, "elk.padding": "[top=36,left=12,bottom=12,right=12]" },
      children: c.map(build),
    };
  };
  return {
    id: "root",
    // Nested layouts need edges across levels (INCLUDE_CHILDREN); flat ones can pack
    // disconnected components side by side, which INCLUDE_CHILDREN disables.
    layoutOptions: { ...opts, ...(nested ? { "elk.hierarchyHandling": "INCLUDE_CHILDREN" } : {}), "elk.json.edgeCoords": "ROOT" },
    children: (kids.get(null) ?? []).map(build),
    edges: edges.filter((e) => ids.has(e.source) && ids.has(e.target)).map((e) => ({ id: e.id, sources: [e.source], targets: [e.target] })),
  };
}

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, (r: LayoutResult) => void>();

function getWorker(): Worker | null {
  if (worker || typeof Worker === "undefined") return worker;
  try {
    worker = new Worker(new URL("./layout.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e: MessageEvent<LayoutResult>) => {
      pending.get(e.data.id)?.(e.data);
      pending.delete(e.data.id);
    };
  } catch {
    worker = null;
  }
  return worker;
}

/** Lay out a graph; only the latest request per caller matters, so callers compare ids. */
export function layout(nodes: LayoutNode[], edges: LayoutEdge[], direction: Direction = "RIGHT"): Promise<LayoutResult> {
  const id = ++seq;
  const graph = toElk(nodes, edges, direction);
  const w = getWorker();
  if (!w) {
    return import("elkjs/lib/elk.bundled.js").then(async ({ default: ELK }) => {
      const t0 = performance.now();
      const out = await new ELK().layout(graph as never);
      return { id, ...collect(out), ms: performance.now() - t0 };
    });
  }
  return new Promise((resolve) => {
    pending.set(id, resolve);
    w.postMessage({ id, graph } satisfies LayoutRequest);
  });
}
