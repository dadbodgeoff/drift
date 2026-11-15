// A graph canvas: React Flow for rendering and interaction, ELK (in a web
// worker) for layout. Callers pass nodes with sizes and parents; positions
// come from the layout.
import {
  Background,
  BackgroundVariant,
  Controls,
  type Edge,
  type EdgeTypes,
  MiniMap,
  type Node,
  type NodeTypes,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useStore,
} from "@xyflow/react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Spinner } from "../components/controls";
import { type Direction, type LayoutEdge, type LayoutNode, layout } from "./layout";

export interface GraphNode<D extends Record<string, unknown> = Record<string, unknown>> extends LayoutNode {
  type?: string;
  data: D;
  selectable?: boolean;
}

export interface GraphEdge<D extends Record<string, unknown> = Record<string, unknown>> extends LayoutEdge {
  type?: string;
  data?: D;
  /** Drawn above other edges. */
  emphasis?: boolean;
  className?: string;
}

export interface GraphCanvasProps {
  nodes: GraphNode[];
  edges: GraphEdge[];
  nodeTypes?: NodeTypes;
  edgeTypes?: EdgeTypes;
  direction?: Direction;
  label: string;
  selected?: string | null;
  onNodeClick?(id: string): void;
  onNodeDoubleClick?(id: string): void;
  onEdgeClick?(id: string): void;
  onPaneClick?(): void;
  onLayout?(ms: number, nodes: number, edges: number): void;
  /** Shown only when the graph does not fit on screen. */
  minimap?: boolean;
  /** Fill for a node in the minimap (token colours); defaults to the border colour. */
  minimapColor?(id: string, data: unknown): string;
  /** Overlay content (legend, toolbar) positioned by the caller. */
  children?: ReactNode;
  /** Change to re-fit the view (e.g. on a new repository). */
  fitKey?: string;
  /** Node to keep in view when the whole graph cannot fit at a legible zoom. */
  focusId?: string | null;
  /** Lowest zoom an automatic fit may use, so labels stay legible (default 0.9). */
  minFitZoom?: number;
}

function Canvas(props: GraphCanvasProps) {
  const { nodes, edges, nodeTypes, edgeTypes, direction = "RIGHT", label, selected, onNodeClick, onNodeDoubleClick, onEdgeClick, onPaneClick, onLayout, minimap = true, minimapColor, children, fitKey, focusId, minFitZoom = 0.9 } = props;
  const [pos, setPos] = useState<Record<string, { x: number; y: number; width: number; height: number }>>({});
  const [routes, setRoutes] = useState<Record<string, { x: number; y: number }[]>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(0);
  const flow = useReactFlow();
  const fitted = useRef<string | undefined>(undefined);
  const fitKeyRef = useRef(fitKey);
  fitKeyRef.current = fitKey;
  const focusRef = useRef(focusId);
  focusRef.current = focusId;
  const box = useRef<HTMLDivElement | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const parents = useMemo(() => new Map(nodes.map((n) => [n.id, n.parent])), [nodes]);

  /**
   * Fit the content's bounding box with padding; when that would make labels
   * illegible, stay at the minimum zoom and keep the focus node (or the top
   * left of the content) in view instead.
   */
  const fitTo = (positions: Record<string, { x: number; y: number; width: number; height: number }>) => {
    const el = box.current;
    if (!el) return;
    const W = el.clientWidth;
    const H = el.clientHeight;
    const abs = (id: string): { x: number; y: number } => {
      const p = positions[id];
      const parent = parents.get(id);
      if (!p) return { x: 0, y: 0 };
      if (!parent) return { x: p.x, y: p.y };
      const a = abs(parent);
      return { x: a.x + p.x, y: a.y + p.y };
    };
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const [id, p] of Object.entries(positions)) {
      if (parents.get(id)) continue;
      x0 = Math.min(x0, p.x);
      y0 = Math.min(y0, p.y);
      x1 = Math.max(x1, p.x + p.width);
      y1 = Math.max(y1, p.y + p.height);
    }
    if (!Number.isFinite(x0) || !W || !H) return;
    const pad = 32;
    let z = Math.min(1.1, (W - 2 * pad) / Math.max(1, x1 - x0), (H - 2 * pad) / Math.max(1, y1 - y0));
    let cx = (x0 + x1) / 2;
    let cy = (y0 + y1) / 2;
    if (z < minFitZoom) {
      z = minFitZoom;
      const f = focusRef.current && positions[focusRef.current] ? focusRef.current : null;
      if (f) {
        const a = abs(f);
        const p = positions[f];
        cx = a.x + Math.min(p.width, W / z - 2 * pad) / 2;
        cy = a.y + Math.min(p.height, H / z - 2 * pad) / 2;
        // A focus larger than the view: start from its top left.
        if (p.width > W / z - 2 * pad) cx = a.x + W / (2 * z) - pad / z;
        if (p.height > H / z - 2 * pad) cy = a.y + H / (2 * z) - pad / z;
      } else {
        cx = x0 - pad / z + W / z / 2;
        cy = y0 - pad / z + H / z / 2;
      }
    }
    void flow.setViewport({ x: W / 2 - cx * z, y: H / 2 - cy * z, zoom: z }, { duration: 0 });
  };
  // Re-layout only when structure changes, not when data (colours, badges) does.
  const shape = useMemo(
    () => nodes.map((n) => `${n.id}:${n.parent ?? ""}:${n.width}x${n.height}`).join("|") + "#" + edges.map((e) => e.id).join("|"),
    [nodes, edges],
  );
  useEffect(() => {
    let alive = true;
    setBusy(true);
    const lnodes = nodes.map(({ id, parent, width, height }) => ({ id, parent, width, height }));
    const ledges = edges.map(({ id, source, target }) => ({ id, source, target }));
    const req = layout(lnodes, ledges, direction);
    const mine = ++latest.current;
    req.then((r) => {
      if (!alive || mine !== latest.current) return;
      setBusy(false);
      if (r.error) {
        setError(r.error);
        return;
      }
      setError(null);
      setPos(r.positions);
      setRoutes(r.edges);
      // Fit once per fitKey, after the new positions have rendered.
      if (fitted.current !== (fitKeyRef.current ?? "x")) {
        fitted.current = fitKeyRef.current ?? "x";
        const positions = r.positions;
        requestAnimationFrame(() => requestAnimationFrame(() => fitTo(positions)));
      }
      onLayout?.(r.ms, nodes.length, edges.length);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shape, direction]);

  const rfNodes: Node[] = useMemo(() => {
    const out: Node[] = [];
    for (const n of nodes) {
      const p = pos[n.id];
      if (!p) continue;
      out.push({
        id: n.id,
        type: n.type,
        data: n.data,
        position: { x: p.x, y: p.y },
        parentId: n.parent ?? undefined,
        width: p.width,
        height: p.height,
        style: { width: p.width, height: p.height },
        selected: n.id === selected,
        selectable: n.selectable ?? true,
        draggable: false,
        connectable: false,
        ariaLabel: typeof n.data.ariaLabel === "string" ? n.data.ariaLabel : undefined,
      } as Node);
    }
    return out;
  }, [nodes, pos, selected]);

  const rfEdges: Edge[] = useMemo(
    () =>
      edges
        .filter((e) => pos[e.source] && pos[e.target])
        .map((e) => ({ id: e.id, source: e.source, target: e.target, type: e.type, data: { ...e.data, points: routes[e.id], hovered: e.id === hovered }, zIndex: e.emphasis ? 1 : 0, className: e.className, focusable: true, selected: e.id === selected })),
    [edges, pos, routes, selected, hovered],
  );


  return (
    <div ref={box} className="dui-graph" role="application" aria-label={label} aria-roledescription="graph">
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodeClick={(_, n) => onNodeClick?.(n.id)}
        onNodeDoubleClick={(_, n) => onNodeDoubleClick?.(n.id)}
        onEdgeClick={(_, e) => onEdgeClick?.(e.id)}
        onEdgeMouseEnter={(_, e) => setHovered(e.id)}
        onEdgeMouseLeave={() => setHovered(null)}
        onPaneClick={() => onPaneClick?.()}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
        onlyRenderVisibleElements
        minZoom={0.05}
        maxZoom={2.5}
        proOptions={{ hideAttribution: true }}
        zoomOnDoubleClick={false}
        deleteKeyCode={null}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} className="dui-graph__bg" />
        <Controls showInteractive={false} position="bottom-left" />
        {minimap && <FitAwareMiniMap color={minimapColor} />}
      </ReactFlow>
      {busy && (
        <div className="dui-graph__busy" role="status">
          <Spinner size={14} /> Laying out {nodes.length.toLocaleString()} nodes
        </div>
      )}
      {error && (
        <div className="dui-graph__busy is-error" role="alert">
          Layout failed: {error}
        </div>
      )}
      {children}
    </div>
  );
}

/** The minimap, only when part of the graph is off screen: a map of what you cannot see. */
function FitAwareMiniMap({ color }: { color?(id: string, data: unknown): string }) {
  const allVisible = useStore((s) => {
    const [tx, ty, z] = s.transform;
    if (!s.width || !s.height) return true;
    for (const n of s.nodeLookup.values()) {
      if (n.parentId) continue;
      const p = n.internals.positionAbsolute;
      const w = (n.measured?.width ?? n.width ?? 0) * z;
      const h = (n.measured?.height ?? n.height ?? 0) * z;
      const x = p.x * z + tx;
      const y = p.y * z + ty;
      if (x < 0 || y < 0 || x + w > s.width || y + h > s.height) return false;
    }
    return true;
  });
  if (allVisible) return null;
  return (
    <MiniMap
      pannable
      zoomable
      position="bottom-right"
      className="dui-graph__minimap"
      nodeStrokeWidth={2}
      nodeColor={color ? (n) => color(n.id, n.data) : undefined}
      maskStrokeColor="var(--color-accent)"
      maskStrokeWidth={2}
      style={{ width: 168, height: 112 }}
    />
  );
}

export function GraphCanvas(props: GraphCanvasProps) {
  return (
    <ReactFlowProvider>
      <Canvas {...props} />
    </ReactFlowProvider>
  );
}
