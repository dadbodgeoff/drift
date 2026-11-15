import { describe, expect, it } from "vitest";
import { wilson } from "../src/components/display";

// The evidence gauge draws the 95% Wilson interval. Its lower bound must be the
// number Drift prints (drift census), or the picture and the text disagree.
describe("wilson", () => {
  it.each([
    [23, 24, 0.798], // acme D-be239c (census.json)
    [70, 74, 0.869], // acme D-ed1ec0
    [106, 109, 0.92], // README: dub D-50df58
    [53, 54, 0.9], // README: dub D-83351e
  ])("%i of %i has Drift's lower bound %f", (h, n, lb) => {
    expect(wilson(h, n).low).toBeCloseTo(lb, 2);
  });
  it("brackets the share and stays in [0, 1]", () => {
    for (const [h, n] of [[0, 8], [8, 8], [5, 9], [1204, 1260]]) {
      const { low, high } = wilson(h, n);
      expect(low).toBeGreaterThanOrEqual(0);
      expect(high).toBeLessThanOrEqual(1);
      expect(low).toBeLessThanOrEqual(h / n);
      expect(high).toBeGreaterThanOrEqual(h / n);
    }
    expect(wilson(0, 0)).toEqual({ low: 0, high: 0 });
  });
});
