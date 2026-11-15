// Map node and edge renderers. Repository names are rendered as text only.
import { memo } from "react";
import { BaseEdge, EdgeLabelRenderer, type EdgeProps, Handle, type NodeProps, type Point, Position, type Rect, clearLabelPoint, getBezierPath, labelPoint, roundedPath, useStore } from "@drift/ui/graph";
import { Icon } from "@drift/ui";
import { UNKNOWN_BASE_TITLE, isUnknownBase, shortRef } from "@/entities/convention";
import type { MapNode } from "./model/graph";

export interface NodeData extends Record<string, unknown> {
  node: MapNode;
  color: string;
  /** File-count magnitude, 1..6 (sequential ramp step). */
  depth: number;
  /** Share of the repository's files beneath this node, 0..1. */
  share: number;
  ariaLabel: string;
  dim: boolean;
}

const ENTRY_SHORT: Record<string, string> = { http: "HTTP", page: "page", layout: "layout", server_action: "action", middleware: "mw", graphql: "gql", cron: "cron", job: "job", queue: "queue", trpc: "tRPC" };

function entries(e: Record<string, number>) {
  return Object.entries(e)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);
}

export const MapNodeView = memo(function MapNodeView({ data, selected }: NodeProps) {
  const { node: n, color, dim, depth, share } = data as NodeData;
  const group = n.expanded && n.kind !== "symbol";
  const cls = `mp-node mp-node--${n.kind}${group ? " is-group" : ""}${selected ? " is-selected" : ""}${dim ? " is-dim" : ""}${n.violations ? " has-violations" : ""}`;
  return (
    <div
      className={cls}
      data-depth={depth}
      style={{ ["--node-color" as string]: color, ["--node-depth" as string]: `var(--data-seq-${depth})`, ["--node-share" as string]: `${Math.max(2, Math.sqrt(share) * 100)}%` }}
    >
      <Handle type="target" position={Position.Left} className="mp-handle" isConnectable={false} />
      <Handle type="source" position={Position.Right} className="mp-handle" isConnectable={false} />
      <div className="mp-node__head">
        <span className="mp-node__swatch" aria-hidden="true" />
        <Icon name={n.kind === "area" ? "layers" : n.kind === "dir" ? "folder" : n.kind === "file" ? "file" : n.kind === "more" ? "more" : "code"} size={12} />
        <span className="mp-node__label" title={n.path}>
          {n.label}
        </span>
        {n.expandable && <Icon name={n.expanded ? "minus" : "plus"} size={11} className="mp-node__toggle" />}
      </div>
      {!group && n.kind !== "symbol" && (
        <div className="mp-node__meta">
          <span>
            {n.kind === "file" ? `${n.symbols} sym` : `${n.files.toLocaleString()} files`}
          </span>
          {n.violations > 0 && (
            <span className="mp-node__viol" title={`${n.violations} new violations`}>
              <Icon name="attention" size={10} /> {n.violations}
            </span>
          )}
        </div>
      )}
      {n.kind === "symbol" && n.symbol && (
        <div className="mp-node__meta">
          <span>
            {n.symbol.kind} :{n.symbol.line}
          </span>
          {n.symbol.wraps.slice(0, 2).map((w, i) => (
            <span key={i} className={`mp-chip${isUnknownBase(w.wrapper) ? " is-unknown" : ""}`} title={isUnknownBase(w.wrapper) ? UNKNOWN_BASE_TITLE : w.wrapper}>
              {w.kind === "decorator" ? "@" : ""}
              {isUnknownBase(w.wrapper) ? shortRef(w.wrapper) : w.wrapper.split("#").pop()?.split(".")[0]}
            </span>
          ))}
        </div>
      )}
      {!group && n.kind !== "symbol" && n.kind !== "more" && <span className="mp-node__meter" aria-hidden="true" />}
      {!group && entries(n.entries).length > 0 && (
        <div className="mp-node__entries">
          {entries(n.entries).map(([k, c]) => (
            <span key={k} className="mp-entry" title={`${c} ${k} entry points`}>
              {ENTRY_SHORT[k] ?? k} {n.kind === "symbol" ? "" : c}
            </span>
          ))}
        </div>
      )}
    </div>
  );
});

export interface EdgeData extends Record<string, unknown> {
  weight: number;
  violates: string[];
  forbidden: string[];
  rule?: boolean;
  dim: boolean;
  /** ELK's route (absolute), when the layout produced one. */
  points?: Point[];
  hovered?: boolean;
}

export const MapEdgeView = memo(function MapEdgeView({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, selected }: EdgeProps) {
  const d = data as EdgeData;
  // Labels keep a legible size on screen whatever the zoom.
  const zoom = useStore((s) => s.transform[2]);
  const lookup = useStore((s) => s.nodeLookup);
  const routed = d.points && d.points.length >= 2;
  const [bez, bx, by] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  const path = routed ? roundedPath(d.points!) : bez;
  const showLabel = (d.violates.length > 0 || !!d.rule) && (selected || !!d.hovered);
  // The label must not cover a node's name: place it where its box clears every node
  // (expanded groups excluded: everything sits inside them).
  let lp: Point & { anchor?: Point } = routed ? labelPoint(d.points!) : { x: bx, y: by };
  if (showLabel) {
    const k = Math.max(1, 1 / zoom);
    const text = d.rule ? "rule: must not import" : `violates ${d.violates.join(", ")} · ${d.weight} imports`;
    const obstacles: Rect[] = [];
    for (const n of lookup.values()) {
      const nd = n.data as NodeData | undefined;
      if (!nd || (nd.node.expanded && nd.node.kind !== "symbol")) continue;
      const w = n.measured?.width ?? n.width ?? 0;
      const h = n.measured?.height ?? n.height ?? 0;
      obstacles.push({ x: n.internals.positionAbsolute.x, y: n.internals.positionAbsolute.y, width: w, height: h });
    }
    const path = routed ? d.points! : [{ x: sourceX, y: sourceY }, { x: targetX, y: targetY }];
    lp = clearLabelPoint(path, obstacles, (text.length * 7.4 + 40) * k, 26 * k);
  }
  const lx = lp.x;
  const ly = lp.y;
  const width = d.rule ? 1.5 : Math.min(7, 0.8 + Math.log2(1 + d.weight) * 0.9);
  const cls = d.rule ? "mp-edge is-rule" : d.violates.length ? "mp-edge is-violating" : d.forbidden.length ? "mp-edge is-forbidden" : "mp-edge";
  return (
    <>
      {showLabel && lp.anchor && <path d={`M${lp.anchor.x},${lp.anchor.y} L${lp.x},${lp.y}`} className={`mp-leader${d.rule ? " is-rule" : ""}`} />}
      <BaseEdge id={id} path={path} className={`${cls}${selected ? " is-selected" : ""}${d.dim ? " is-dim" : ""}`} style={{ strokeWidth: selected ? width + 1.5 : width }} interactionWidth={14} />
      {showLabel && (
        <EdgeLabelRenderer>
          <div className={`mp-edgelabel${d.rule ? " is-rule" : ""}`} style={{ transform: `translate(-50%, -50%) translate(${lx}px, ${ly}px) scale(${Math.max(1, 1 / zoom)})` }}>
            {d.rule ? (
              <>
                <Icon name="blocked" size={12} /> rule: must not import
              </>
            ) : (
              <>
                <Icon name="attention" size={12} /> violates {d.violates.join(", ")} · {d.weight} {d.weight === 1 ? "import" : "imports"}
              </>
            )}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
});

export const nodeTypes = { map: MapNodeView };
export const edgeTypes = { map: MapEdgeView };
