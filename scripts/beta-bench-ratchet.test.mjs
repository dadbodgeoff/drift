import { describe, expect, it } from "vitest";

import { ratchetRegressions } from "./beta-bench-ratchet.mjs";

/**
 * EW-4: the ratchet.
 *
 * Parser-gap counts rose sharply after the resolver work - formbricks 99 -> 1,104, openstatus
 * 340 -> 750, cal.com 2,429 -> 2,535 - because the resolver began recognising far more specifiers as
 * should-be-local and honestly reporting what it could not place. The reporting was correct. The
 * volume was the problem, and it rose *unnoticed*, which is the part a test can prevent.
 *
 * The asymmetry is the design. Counts may fall freely: requiring a baseline update to record an
 * improvement is friction, and friction on the good direction gets routed around. A rise fails, and
 * names the delta, because "gaps went up by 1,005" is actionable and "the suite is red" is not.
 */

const clean = {
  repo: "calcom",
  onboarded: true,
  parser_gap_count: 1705,
  refused: 0,
  applicable: 8,
  fact_counts_agree: true
};

describe("beta bench ratchet", () => {
  it("accepts an unchanged run", () => {
    expect(ratchetRegressions(clean, clean)).toEqual([]);
  });

  it("accepts a fall in parser gaps without demanding a baseline update", () => {
    const improved = { ...clean, parser_gap_count: 900 };
    expect(
      ratchetRegressions(improved, clean),
      "friction on the improving direction is friction that gets routed around"
    ).toEqual([]);
  });

  it("fails a rise in parser gaps and names the delta", () => {
    const worse = { ...clean, parser_gap_count: 2710 };
    const regressions = ratchetRegressions(worse, clean);

    expect(regressions).toHaveLength(1);
    expect(regressions[0]).toContain("1705 -> 2710");
    expect(regressions[0], "the delta is the actionable part").toContain("+1005");
  });

  it("accepts a fall in ordinary-edit refusals", () => {
    const improved = { ...clean, refused: 0 };
    const before = { ...clean, refused: 4 };
    expect(ratchetRegressions(improved, before)).toEqual([]);
  });

  it("fails a rise in ordinary-edit refusals, as a fraction so the denominator is visible", () => {
    const worse = { ...clean, refused: 3 };
    const regressions = ratchetRegressions(worse, clean);

    expect(regressions).toHaveLength(1);
    expect(regressions[0]).toContain("0/8 -> 3/8");
  });

  it("fails fact-count disagreement outright, not as a regression", () => {
    // EW-6: a baseline that recorded disagreement would be a baseline that blesses it. Determinism
    // is either true or the claim is false, so there is nothing here to ratchet against.
    const disagreeing = {
      ...clean,
      fact_counts_agree: false,
      fact_count_manifest: 46,
      fact_count_stored: 40
    };
    const regressions = ratchetRegressions(disagreeing, disagreeing);

    expect(regressions).toHaveLength(1);
    expect(regressions[0]).toContain("manifest 46");
    expect(regressions[0]).toContain("stored 40");
  });

  it("reports every regression in one run rather than stopping at the first", () => {
    const worse = { ...clean, parser_gap_count: 2000, refused: 2 };
    expect(ratchetRegressions(worse, clean)).toHaveLength(2);
  });

  it("demands a baseline row rather than silently passing a repo it has never measured", () => {
    const regressions = ratchetRegressions(clean, undefined);

    expect(
      regressions,
      "a new repo with no baseline must not pass by default - that is how a repo joins the suite " +
        "and tests nothing"
    ).toHaveLength(1);
    expect(regressions[0]).toMatch(/no baseline row/);
  });

  it("fails an onboarding regression before looking at any count", () => {
    const broken = { repo: "calcom", onboarded: false, error: "ONBOARD_FAILED" };
    const regressions = ratchetRegressions(broken, clean);

    expect(regressions).toEqual(["calcom: onboarding regressed (ONBOARD_FAILED)"]);
  });
});
