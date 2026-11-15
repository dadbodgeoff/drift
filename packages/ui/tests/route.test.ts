import { describe, expect, it } from "vitest";
import { clearLabelPoint, labelPoint } from "../src/graph/route";

const boxHit = (p: { x: number; y: number }, w: number, h: number, r: { x: number; y: number; width: number; height: number }) =>
  p.x - w / 2 < r.x + r.width && p.x + w / 2 > r.x && p.y - h / 2 < r.y + r.height && p.y + h / 2 > r.y;

describe("clearLabelPoint", () => {
  it("is the route's middle when nothing is in the way", () => {
    const pts = [{ x: 0, y: 0 }, { x: 400, y: 0 }];
    expect(clearLabelPoint(pts, [], 100, 20)).toEqual({ x: 200, y: 0 });
    // Off the line, it says where it belongs.
    const a = { x: -10, y: -10, width: 420, height: 20 };
    const q = clearLabelPoint(pts, [a], 100, 20);
    expect(q.anchor).toBeDefined();
  });
  it("never covers a node, even between two close nodes", () => {
    // Two nodes 70 px apart; the label is wider than the gap.
    const a = { x: 0, y: 0, width: 200, height: 70 };
    const b = { x: 270, y: 0, width: 300, height: 90 };
    const pts = [{ x: 200, y: 35 }, { x: 270, y: 35 }];
    const p = clearLabelPoint(pts, [a, b], 260, 26);
    expect(boxHit(p, 260, 26, a) || boxHit(p, 260, 26, b)).toBe(false);
  });
  it("falls back to the longest segment's middle when nothing fits", () => {
    const pts = [{ x: 0, y: 0 }, { x: 10, y: 0 }];
    const wall = { x: -1000, y: -1000, width: 2000, height: 2000 };
    expect(clearLabelPoint(pts, [wall], 50, 20)).toEqual(labelPoint(pts));
  });
});
