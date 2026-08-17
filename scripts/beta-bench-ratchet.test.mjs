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
  findings_count: 42,
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

  /**
   * The floor.
   *
   * Every term above fires on a rise, because on those axes a rise is the regression. That left the
   * ratchet unable to see the one direction that matters most here: a build where Drift found
   * nothing posts zero parser gaps and zero refusals, and each of those reads as an improvement.
   * The floor is the term that makes a silent check fail instead of scoring perfectly.
   */
  it("fails a drop in full-scope findings and names the delta", () => {
    const quieter = { ...clean, findings_count: 30 };
    const regressions = ratchetRegressions(quieter, clean);

    expect(regressions).toHaveLength(1);
    expect(regressions[0]).toContain("42 -> 30");
    expect(regressions[0]).toContain("-12");
    expect(
      regressions[0],
      "the whole point is that silence must not read as success"
    ).toMatch(/not an improvement/);
  });

  it("fails the check that went completely silent, which every other term scores as perfect", () => {
    // Gaps to zero, refusals to zero, fact counts trivially agreeing at 0 == 0: without the floor
    // this row is a clean sweep of improvements.
    const silent = {
      ...clean,
      parser_gap_count: 0,
      findings_count: 0,
      refused: 0,
      fact_count_manifest: 0,
      fact_count_stored: 0,
      fact_counts_agree: true
    };
    const regressions = ratchetRegressions(silent, clean);

    expect(
      regressions,
      "a build that detected nothing must not pass the bench"
    ).toHaveLength(1);
    expect(regressions[0]).toContain("42 -> 0");
  });

  it("accepts a rise in findings, so detecting more never needs a baseline update to land", () => {
    expect(ratchetRegressions({ ...clean, findings_count: 96 }, clean)).toEqual([]);
  });

  it("fails an unmeasurable findings count rather than skipping the term", () => {
    // An unparseable check payload records null. That is the same event as the count going to
    // zero - Drift reported nothing - and must not be a term the ratchet quietly declines to apply.
    const unreadable = { ...clean, findings_count: null };
    const regressions = ratchetRegressions(unreadable, clean);

    expect(regressions).toHaveLength(1);
    expect(regressions[0]).toMatch(/unmeasured/);
    expect(regressions[0]).toMatch(/not a clean one/);
  });

  it("fails a baseline row carrying no floor rather than passing the term by default", () => {
    // A pre-floor baseline row has no findings_count. Treating that as "nothing to compare" would
    // let every repo skip the term until someone remembered to re-record, which is the same silence
    // one level up.
    const { findings_count: _dropped, ...preFloorBaseline } = clean;
    const regressions = ratchetRegressions(clean, preFloorBaseline);

    expect(regressions).toHaveLength(1);
    expect(regressions[0]).toMatch(/no findings_count in the baseline row/);
    expect(regressions[0], "the message has to say how to fix it").toContain("pnpm eval:bench:update");
  });

  it("fails an onboarding regression before looking at any count", () => {
    const broken = { repo: "calcom", onboarded: false, error: "ONBOARD_FAILED" };
    const regressions = ratchetRegressions(broken, clean);

    expect(regressions).toEqual(["calcom: onboarding regressed (ONBOARD_FAILED)"]);
  });
});
