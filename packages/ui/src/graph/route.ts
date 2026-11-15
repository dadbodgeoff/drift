// Draw an ELK orthogonal route with rounded corners.
import type { Point } from "./layout";

export function roundedPath(points: Point[], radius = 8): string {
  if (points.length < 2) return "";
  let d = `M${points[0].x},${points[0].y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i - 1];
    const c = points[i];
    const n = points[i + 1];
    const r = Math.min(radius, Math.hypot(c.x - p.x, c.y - p.y) / 2, Math.hypot(n.x - c.x, n.y - c.y) / 2);
    const a = { x: c.x - Math.sign(c.x - p.x) * r, y: c.y - Math.sign(c.y - p.y) * r };
    const b = { x: c.x + Math.sign(n.x - c.x) * r, y: c.y + Math.sign(n.y - c.y) * r };
    d += ` L${a.x},${a.y} Q${c.x},${c.y} ${b.x},${b.y}`;
  }
  const last = points[points.length - 1];
  return `${d} L${last.x},${last.y}`;
}

/** Midpoint of the longest segment: a calm place for a label. */
export function labelPoint(points: Point[]): Point {
  let best = { x: points[0].x, y: points[0].y };
  let len = -1;
  for (let i = 1; i < points.length; i++) {
    const l = Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
    if (l > len) {
      len = l;
      best = { x: (points[i].x + points[i - 1].x) / 2, y: (points[i].y + points[i - 1].y) / 2 };
    }
  }
  return best;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function hits(cx: number, cy: number, w: number, h: number, r: Rect, margin: number): boolean {
  return cx - w / 2 < r.x + r.width + margin && cx + w / 2 > r.x - margin && cy - h / 2 < r.y + r.height + margin && cy + h / 2 > r.y - margin;
}

/**
 * A place on the route for a label of `w` x `h` that covers no obstacle (node
 * boxes), as close to the route's middle as possible; above or below the line
 * when the line itself is crowded. Falls back to `labelPoint`.
 */
export function clearLabelPoint(points: Point[], obstacles: Rect[], w: number, h: number, step = 8, margin = 4): Point & { anchor?: Point } {
  if (points.length < 2) return points[0] ?? { x: 0, y: 0 };
  const samples: { p: Point; d: number }[] = [];
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    for (let s = 0; s <= len; s += step) samples.push({ p: { x: a.x + ((b.x - a.x) * s) / Math.max(1, len), y: a.y + ((b.y - a.y) * s) / Math.max(1, len) }, d: total + s });
    total += len;
  }
  samples.sort((u, v) => Math.abs(u.d - total / 2) - Math.abs(v.d - total / 2));
  // Off the line in growing steps, above before below, when the line itself is crowded.
  const offsets = [0];
  for (let k = 1; k <= 8; k++) offsets.push(-k * (h * 0.75), k * (h * 0.75));
  for (const dy of offsets) {
    for (const { p } of samples) {
      const c = { x: p.x, y: p.y + dy };
      if (!obstacles.some((r) => hits(c.x, c.y, w, h, r, margin))) return dy ? { ...c, anchor: p } : c;
    }
  }
  return labelPoint(points);
}
