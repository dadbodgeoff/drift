import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { shapeVerdict, unsafeShapeMoves } from "./external-eval-predicate.mjs";

/**
 * O-3: the evasion matrix's per-shape verdict, driven synthetically the way O-1 drives
 * repoVerdict. Every record below is a shape that historically read as a pass (or could)
 * and must be a FAIL, plus the two pins this run's discoveries added:
 *
 *   (a) attribution must check EVERY finding's evidence, not just the first - a second
 *       finding attributed to an intermediate barrel must fail the shape (the O-1
 *       predicate only asserted evidence_refs[0] of the FIRST finding);
 *   (b) split scenario semantics - the blocking scenario (real violation alone) must
 *       exit 2 on block repos, and the refusal scenario (non-existent decoy) must exit 3
 *       naming the decoy. Neither may satisfy the other's assertion.
 */

const ROUTE = "app/api/drift-evasion-s01/route.ts";

const caughtRecord = (overrides = {}) => ({
  id: "S01-control-canonical",
  route: ROUTE,
  caught: true,
  findings_count: 1,
  exit: 2,
  check_status: "fail",
  enforcement: "block",
  attributed_files: [ROUTE],
  ...overrides
});

const catchContext = (overrides = {}) => ({
  shapeClass: "catch",
  enforcementMode: "block",
  isBlockingScenario: false,
  knownEvasion: false,
  ...overrides
});

describe("shapeVerdict: catch shapes", () => {
  it("passes a healthy blocked catch", () => {
    expect(shapeVerdict(caughtRecord(), catchContext())).toEqual({
      status: "PASS",
      failures: []
    });
  });

  it("passes a healthy warned catch on a warn-mode repo", () => {
    const record = caughtRecord({ exit: 0, check_status: "pass", enforcement: "warn" });
    expect(shapeVerdict(record, catchContext({ enforcementMode: "warn" }))).toEqual({
      status: "PASS",
      failures: []
    });
  });

  it("fails when a SECOND finding is attributed to a barrel, not just the first", () => {
    // Pin (a). O-1's repo-level predicate asserts only the first finding's leading
    // evidence; a second barrel-attributed finding would sail through it.
    const record = caughtRecord({
      findings_count: 2,
      attributed_files: [ROUTE, "app/api/drift-evasion-s01/data.ts"]
    });
    const verdict = shapeVerdict(record, catchContext());
    expect(verdict.status).toBe("FAIL");
    expect(verdict.failures).toContain("every_finding_attributed_to_route");
  });

  it("fails when the only finding is attributed to a barrel", () => {
    const record = caughtRecord({
      attributed_files: ["app/api/drift-evasion-s01/data.ts"]
    });
    expect(shapeVerdict(record, catchContext()).failures).toContain(
      "every_finding_attributed_to_route"
    );
  });

  it("fails a caught violation that exits 0 under a block-mode convention", () => {
    // The S1-01 invariant at shape level: no path from "a violation was found" to exit 0
    // on a block repo. This is the exact exit-0-with-demotion class G1 forbids.
    const record = caughtRecord({ exit: 0, check_status: "pass", enforcement: "none" });
    const verdict = shapeVerdict(record, catchContext());
    expect(verdict.status).toBe("FAIL");
    expect(verdict.failures).toContain("caught_block_mode_cannot_exit_zero");
  });

  it("fails a warn-repo catch whose enforcement is null rather than warn", () => {
    const record = caughtRecord({ exit: 0, check_status: "pass", enforcement: null });
    const verdict = shapeVerdict(record, catchContext({ enforcementMode: "warn" }));
    expect(verdict.status).toBe("FAIL");
    expect(verdict.failures).toContain("enforcement_matches_mode");
  });

  it("fails an evasion that is not recorded as known", () => {
    const record = caughtRecord({
      caught: false,
      findings_count: 0,
      exit: 0,
      check_status: "pass",
      enforcement: null,
      attributed_files: []
    });
    const verdict = shapeVerdict(record, catchContext());
    expect(verdict.status).toBe("FAIL");
    expect(verdict.failures).toContain("should_catch_shape_evaded");
  });

  it("tolerates a known evasion as KNOWN_EVASION, never PASS", () => {
    // An evasion that still exists is recorded, not hidden - and not celebrated.
    const record = caughtRecord({
      caught: false,
      findings_count: 0,
      exit: 0,
      check_status: "pass",
      enforcement: null,
      attributed_files: []
    });
    const verdict = shapeVerdict(record, catchContext({ knownEvasion: true }));
    expect(verdict.status).toBe("KNOWN_EVASION");
    expect(verdict.failures).toEqual([]);
  });

  it("permits a fail-closed refusal on a catch shape and records nothing as passing silently", () => {
    // exit 3 with status refused is honest (the check declined to claim anything); the
    // baseline pins which shape x repo cells legitimately land here.
    const record = caughtRecord({ exit: 3, check_status: "refused", enforcement: "none" });
    expect(shapeVerdict(record, catchContext()).status).toBe("PASS");
  });

  it("fails the blocking scenario when a block repo does not exit 2", () => {
    // Pin (b), blocking half: the real violation ALONE must block on block repos - a
    // refusal here would mean the product cannot block even its cleanest case.
    const record = caughtRecord({ exit: 3, check_status: "refused", enforcement: "none" });
    const verdict = shapeVerdict(record, catchContext({ isBlockingScenario: true }));
    expect(verdict.status).toBe("FAIL");
    expect(verdict.failures).toContain("blocking_scenario_blocks");
  });

  it("fails on a status/exit contradiction", () => {
    const record = caughtRecord({ exit: 3, check_status: "pass", enforcement: "none" });
    const verdict = shapeVerdict(record, catchContext());
    expect(verdict.status).toBe("FAIL");
    expect(verdict.failures).toContain("check_status_consistent_with_exit");
  });
});

describe("shapeVerdict: negative controls", () => {
  const silentRecord = (overrides = {}) => ({
    id: "S09-type-only-decoy",
    route: "app/api/drift-evasion-s09/route.ts",
    caught: false,
    findings_count: 0,
    exit: 0,
    check_status: "pass",
    enforcement: null,
    attributed_files: [],
    ...overrides
  });

  it("passes a silent negative control", () => {
    expect(shapeVerdict(silentRecord(), catchContext({ shapeClass: "silent" }))).toEqual({
      status: "PASS",
      failures: []
    });
  });

  it("fails a negative control that produced a finding", () => {
    const record = silentRecord({
      caught: true,
      findings_count: 1,
      attributed_files: ["app/api/drift-evasion-s09/route.ts"]
    });
    const verdict = shapeVerdict(record, catchContext({ shapeClass: "silent" }));
    expect(verdict.status).toBe("FAIL");
    expect(verdict.failures).toContain("negative_control_silent");
  });
});

describe("shapeVerdict: refusal scenario", () => {
  const refusalRecord = (overrides = {}) => ({
    id: "S13-refusal-decoy",
    route: "app/api/drift-evasion-s13/route.ts",
    caught: true,
    findings_count: 1,
    exit: 3,
    check_status: "refused",
    enforcement: "none",
    attributed_files: ["app/api/drift-evasion-s13/route.ts"],
    refusal_names_decoy: true,
    ...overrides
  });

  it("passes a refusal that exits 3 naming the decoy", () => {
    expect(shapeVerdict(refusalRecord(), catchContext({ shapeClass: "refuse" }))).toEqual({
      status: "PASS",
      failures: []
    });
  });

  it("fails a refusal scenario that does not exit 3", () => {
    // Pin (b), refusal half: a non-existent decoy must refuse, never block or pass - an
    // exit 2 here would mean the product claims to enforce what it cannot resolve.
    const record = refusalRecord({ exit: 2, check_status: "fail", enforcement: "block" });
    const verdict = shapeVerdict(record, catchContext({ shapeClass: "refuse" }));
    expect(verdict.status).toBe("FAIL");
    expect(verdict.failures).toContain("refusal_exits_3");
  });

  it("fails a refusal whose blocked_reasons do not name the decoy", () => {
    const record = refusalRecord({ refusal_names_decoy: false });
    const verdict = shapeVerdict(record, catchContext({ shapeClass: "refuse" }));
    expect(verdict.status).toBe("FAIL");
    expect(verdict.failures).toContain("refusal_names_decoy");
  });
});

/**
 * O-4, applied to the evasion baseline: an `--update` that weakens a shape cell must be
 * refused unless each regression is named with `--accept-regression <repo>:<shape>.<field>`.
 */
describe("unsafeShapeMoves", () => {
  const blocked = {
    id: "S06-namespace-import",
    caught: true,
    exit: 2,
    check_status: "fail",
    enforcement: "block"
  };

  it("reports nothing when nothing weakened", () => {
    expect(unsafeShapeMoves(blocked, { ...blocked })).toEqual([]);
    // Refusing where it blocked is fail-closed, not a weakening.
    expect(
      unsafeShapeMoves(blocked, { ...blocked, exit: 3, check_status: "refused", enforcement: "none" })
    ).toEqual(["S06-namespace-import.enforcement"]);
  });

  it("names a shape whose catch regressed to an evasion", () => {
    const evaded = {
      ...blocked,
      caught: false,
      exit: 0,
      check_status: "pass",
      enforcement: null,
      known_evasion: true
    };
    expect(unsafeShapeMoves(blocked, evaded).sort()).toEqual([
      "S06-namespace-import.caught",
      "S06-namespace-import.check_status",
      "S06-namespace-import.enforcement",
      "S06-namespace-import.exit",
      "S06-namespace-import.known_evasion"
    ]);
  });

  it("names a block that silently became a pass", () => {
    const moves = unsafeShapeMoves(blocked, {
      ...blocked,
      exit: 0,
      check_status: "pass",
      enforcement: "none"
    });
    expect(moves.sort()).toEqual([
      "S06-namespace-import.check_status",
      "S06-namespace-import.enforcement",
      "S06-namespace-import.exit"
    ]);
  });

  it("is silent for a cell with no baseline", () => {
    expect(unsafeShapeMoves(undefined, blocked)).toEqual([]);
  });
});

describe("evasion baseline shape", () => {
  const baselinePath = new URL("./evasion-baseline.json", import.meta.url);

  it("exists and covers every suite repo", () => {
    expect(existsSync(baselinePath)).toBe(true);
    const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
    expect(baseline.length).toBeGreaterThanOrEqual(7);
    for (const row of baseline) {
      expect(row.onboarded).toBe(true);
      expect(Array.isArray(row.shapes)).toBe(true);
      expect(row.shapes.length).toBeGreaterThanOrEqual(13);
      for (const shape of row.shapes) {
        // Honest truth: every cell carries a settled verdict; evasions are recorded as
        // known_evasion, never hidden; nothing is committed in a FAIL state.
        expect(["PASS", "KNOWN_EVASION", "UNTESTABLE"]).toContain(shape.verdict);
        if (shape.verdict === "KNOWN_EVASION") {
          expect(shape.known_evasion).toBe(true);
        }
      }
    }
  });

  it("records the side-effect-import miss as a known evasion, never hides it", () => {
    // `import "<data module>"` executes the module - a real runtime dependency - and is
    // currently a silent miss everywhere. The bench matrix classed it "observe", which
    // filed the miss where no one looks. It is an evasion and the baseline must say so.
    const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
    for (const row of baseline) {
      const sideEffect = row.shapes.find((shape) => shape.id === "S10-side-effect-import");
      expect(sideEffect, `${row.repo} missing S10`).toBeTruthy();
      if (sideEffect.outcome === "evaded") {
        expect(sideEffect.known_evasion, `${row.repo} S10 evasion must be recorded`).toBe(true);
        expect(sideEffect.verdict).toBe("KNOWN_EVASION");
      }
    }
  });

  it("pins the blocking and refusal scenarios on every repo", () => {
    const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
    for (const row of baseline) {
      const control = row.shapes.find((shape) => shape.id === "S01-control-canonical");
      expect(control, `${row.repo} missing blocking scenario`).toBeTruthy();
      if (row.enforcement_mode === "block") {
        expect(control.exit, `${row.repo} blocking scenario must exit 2`).toBe(2);
        expect(control.enforcement).toBe("block");
      }
      const refusal = row.shapes.find((shape) => shape.id === "S13-refusal-decoy");
      expect(refusal, `${row.repo} missing refusal scenario`).toBeTruthy();
      expect(refusal.exit, `${row.repo} refusal scenario must exit 3`).toBe(3);
      expect(refusal.check_status).toBe("refused");
      expect(refusal.refusal_names_decoy).toBe(true);
    }
  });
});
