import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  ENVELOPE_BAND_EDGES,
  envelopeBudgetBand,
  mergeBaselineRows,
  PACKET_ENVELOPE_BUDGET,
  repoVerdict,
  unsafeBaselineMoves,
  updateGate
} from "./external-eval-predicate.mjs";

/**
 * T05: tests for the evaluation harness itself.
 *
 * The harness produced a false negative once: `git clean` does not remove *staged* files,
 * and the injection step stages the routes it writes so they appear in `git diff HEAD`.
 * Cleaning without resetting the index leaked injected routes between runs, which then
 * became part of the base tree, so a *detected* injection looked undetected. A harness that
 * can silently under-report is worse than no harness, so its own invariants are pinned here.
 */

const dirs = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function repoWithCommit() {
  const dir = mkdtempSync(join(tmpdir(), "drift-harness-"));
  dirs.push(dir);
  writeFileSync(join(dir, "seed.txt"), "seed\n");
  git(dir, "init", "-q");
  git(dir, "add", "-A");
  git(dir, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init");
  return dir;
}

// Mirrors resetTree in external-eval.mjs. Kept in step deliberately: if that changes, this
// test is where the divergence should be caught.
function resetTree(root) {
  git(root, "reset", "-q", "--hard", "HEAD");
  git(root, "clean", "-qfd");
}

describe("resetTree removes staged files", () => {
  it("clears a staged new file, which git clean alone does not", () => {
    const root = repoWithCommit();
    mkdirSync(join(root, "app/api/injected"), { recursive: true });
    writeFileSync(join(root, "app/api/injected/route.ts"), "export const x = 1;\n");
    git(root, "add", "-A");

    expect(git(root, "status", "--porcelain").trim()).not.toBe("");

    // clean alone leaves it: this is the original defect.
    git(root, "clean", "-qfd");
    expect(git(root, "status", "--porcelain")).toContain("route.ts");

    resetTree(root);
    expect(git(root, "status", "--porcelain").trim()).toBe("");
  });

  it("leaves the commit history untouched", () => {
    const root = repoWithCommit();
    const before = git(root, "rev-parse", "HEAD").trim();
    writeFileSync(join(root, "extra.ts"), "export const y = 2;\n");
    git(root, "add", "-A");
    resetTree(root);
    expect(git(root, "rev-parse", "HEAD").trim()).toBe(before);
    // The harness must never create a commit in an evaluation repo.
    expect(git(root, "log", "--oneline").trim().split("\n")).toHaveLength(1);
  });
});

describe("added files appear in git diff HEAD once staged", () => {
  it("reports the new file with a /dev/null old path", () => {
    const root = repoWithCommit();
    mkdirSync(join(root, "app/api/bad"), { recursive: true });
    writeFileSync(join(root, "app/api/bad/route.ts"), "export const x = 1;\n");
    git(root, "add", "-A");

    const diff = git(root, "diff", "HEAD", "--unified=0");
    // Both are load-bearing: the harness relies on staged additions being visible to
    // `git diff HEAD`, and Drift relies on `--- /dev/null` to classify the file as added
    // (finding F7).
    expect(diff).toContain("app/api/bad/route.ts");
    expect(diff).toContain("--- /dev/null");
  });
});

/**
 * O-1 (S1-03): the PASS predicate itself. B-4 was a suite that could not fail: it never
 * asserted the check's exit code, treated a null enforcement measurement as agreement
 * (`!== false`), and never asserted the finding was attributed to the injected file rather
 * than an intermediate barrel. Each synthetic result below is a shape that historically
 * read as a pass and must now be a FAIL.
 */
describe("repoVerdict", () => {
  // A result that satisfies every assertion. Each test perturbs exactly one field, so a
  // failure isolates the assertion under test and this base guards against a predicate
  // that fails everything.
  const goodCfg = () => ({
    name: "synthetic",
    expectedExitCode: 2
  });
  const goodResult = () => ({
    onboarded: true,
    contract_names_real_data_layer: true,
    forbidden_imports_exact_match: true,
    check_exit_code: 2,
    check_status: "fail",
    expected_exit_code: 2,
    engine_source: "rust",
    fallback_used: false,
    injection_caught: true,
    injection_evidence_correct: true,
    injected_route: "app/api/drift-eval-bad/route.ts",
    injection_evidence_file: "app/api/drift-eval-bad/route.ts",
    enforcement_matches_mode: true,
    clean_control_false_positive: false,
    fp_type_only_import: false,
    fp_lookalike_module: false,
    catches_genuine_subpath: true,
    // BB-5/BB-6: measurements of new behaviour, asserted strictly `=== true` for the same reason
    // enforcement_matches_mode is - an absent measurement must not read as agreement.
    exemplar_integrity: true,
    guidance_within_budget: true,
    packet_within_envelope_budget: true,
    // BB-8: the cell whose death this fixture would not have noticed.
    baselined: 397,
    findings_count: 2
  });

  it("passes a fully healthy result", () => {
    expect(repoVerdict(goodResult(), goodCfg())).toEqual({ status: "PASS", failures: [] });
  });

  it("fails when the enforcement measurement is null rather than true", () => {
    // `!== false` was a recording idiom, not an asserting one: if enforcementInIsolation
    // errors or returns nothing, null must read as "unobserved", never as "agrees".
    const result = { ...goodResult(), enforcement_matches_mode: null };
    const verdict = repoVerdict(result, goodCfg());
    expect(verdict.status).toBe("FAIL");
    expect(verdict.failures).toContain("enforcement_matches_mode");
  });

  it("fails when the enforcement measurement is absent entirely", () => {
    const result = goodResult();
    delete result.enforcement_matches_mode;
    expect(repoVerdict(result, goodCfg()).status).toBe("FAIL");
  });

  it("fails a repo reporting zero baselined alongside open findings", () => {
    // BB-8's liveness assertion. This is the exact shape the dead cell produced on all seven repos:
    // findings present, baselined 0, suite green. It is either a product regression (the decision-C
    // baselining behaviour T121 protects) or a dead measurement, and both must stop the suite.
    const result = { ...goodResult(), baselined: 0 };
    const verdict = repoVerdict(result, goodCfg());
    expect(verdict.status).toBe("FAIL");
    expect(verdict.failures).toContain("baselined_cell_live");
  });

  it("allows zero baselined when the repo has no open findings", () => {
    // Nothing to baseline is not a dead cell.
    const result = { ...goodResult(), baselined: 0, findings_count: 0 };
    expect(repoVerdict(result, goodCfg()).status).toBe("PASS");
  });

  it("allows null baselined - acceptance did not happen", () => {
    // A run without --accept-defaults legitimately baselines nothing. `null` says so; `0` would be a
    // claim about counting.
    const result = { ...goodResult(), baselined: null };
    expect(repoVerdict(result, goodCfg()).status).toBe("PASS");
  });

  it("fails when the exemplar-integrity measurement is absent rather than true", () => {
    // BB-5: an exemplar that violates the convention it exemplifies is what produced the observed
    // agent defection, so an unobserved measurement must fail rather than pass quietly.
    const result = goodResult();
    delete result.exemplar_integrity;
    const verdict = repoVerdict(result, goodCfg());
    expect(verdict.status).toBe("FAIL");
    expect(verdict.failures).toContain("exemplar_integrity");
  });

  it("fails when the guidance budget was not measured", () => {
    // BB-6: same reasoning. A packet whose headline view was never sized is not a packet known to be
    // within budget.
    const result = { ...goodResult(), guidance_within_budget: null };
    const verdict = repoVerdict(result, goodCfg());
    expect(verdict.status).toBe("FAIL");
    expect(verdict.failures).toContain("guidance_within_budget");
  });

  it("fails a check that found the violation but exited 0 when 2 was expected", () => {
    // S1-01's own commit is the proof of this gap: 4 repos' exit codes changed 0 -> 3 and
    // the suite printed ok for all 7.
    const result = { ...goodResult(), check_exit_code: 0 };
    const verdict = repoVerdict(result, goodCfg());
    expect(verdict.status).toBe("FAIL");
    expect(verdict.failures).toContain("check_exit_code_matches_expected");
  });

  it("fails when no exit-code expectation is recorded at all", () => {
    // Fail closed: a repo added to the suite without an expected exit code must not
    // silently skip the assertion.
    const verdict = repoVerdict(goodResult(), { name: "synthetic" });
    expect(verdict.status).toBe("FAIL");
  });

  it("fails when the finding is attributed to a file other than the injected route", () => {
    // The papermark barrel artifact: a finding whose evidence names an intermediate
    // barrel rather than the injected route read as a catch.
    const result = {
      ...goodResult(),
      injection_evidence_file: "app/api/drift-eval-bad/index.ts"
    };
    const verdict = repoVerdict(result, goodCfg());
    expect(verdict.status).toBe("FAIL");
    expect(verdict.failures).toContain("injection_attributed_to_injected_file");
  });

  it("fails when the evidence file is unrecorded", () => {
    const result = { ...goodResult(), injection_evidence_file: null };
    expect(repoVerdict(result, goodCfg()).status).toBe("FAIL");
  });

  // E-1 (S1-02 / B-3): exit code 3 alongside `check_status: "pass"` is the recorded shape
  // of the can_block contradiction - two fields in one payload disagreeing about the
  // outcome. The JSON consumers Drift is built for read check.status, not $?.
  it("fails when a refused check (exit 3) records a passing status", () => {
    const result = {
      ...goodResult(),
      check_exit_code: 3,
      check_status: "pass",
      injection_enforcement: "none"
    };
    const verdict = repoVerdict(result, { ...goodCfg(), expectedExitCode: 3 });
    expect(verdict.status).toBe("FAIL");
    expect(verdict.failures).toContain("check_status_consistent_with_exit");
  });

  it("passes when a refused check records status refused", () => {
    const result = { ...goodResult(), check_exit_code: 3, check_status: "refused" };
    const verdict = repoVerdict(result, { ...goodCfg(), expectedExitCode: 3 });
    expect(verdict.failures).not.toContain("check_status_consistent_with_exit");
  });

  it("fails when a blocked check (exit 2) records a passing status", () => {
    const result = { ...goodResult(), check_status: "pass" };
    const verdict = repoVerdict(result, goodCfg());
    expect(verdict.status).toBe("FAIL");
    expect(verdict.failures).toContain("check_status_consistent_with_exit");
  });
});

/**
 * O-4: `--update` is not a rubber stamp.
 *
 * Three verified failure modes, each RED-first:
 *  (1) `--only X --update` TRUNCATED the baseline to the filtered repos, silently
 *      destroying every other row (live repro this run: 7 rows -> 1, exit 0);
 *  (2) an update that moved a safety-relevant field in the unsafe direction (enforcement
 *      block -> none, blocking_count > 0 -> 0, caught -> uncaught, exit 2/3 -> 0,
 *      fail/refused -> pass) was written silently - `--update` as a rubber stamp is a
 *      named anti-pattern in PLAN.md;
 *  (3) `--update` on a FAILING verdict printed "baseline updated - 0/1 passing" and
 *      exited 0.
 */
describe("mergeBaselineRows", () => {
  const existing = [
    { repo: "taxonomy", check_exit_code: 3 },
    { repo: "dub", check_exit_code: 3 },
    { repo: "openstatus", check_exit_code: 3 }
  ];
  const order = ["taxonomy", "dub", "openstatus"];

  it("keeps rows for repos the filtered run did not touch", () => {
    const merged = mergeBaselineRows(existing, [{ repo: "taxonomy", check_exit_code: 3, fresh: true }], order);
    expect(merged.map((row) => row.repo)).toEqual(["taxonomy", "dub", "openstatus"]);
    expect(merged[0].fresh).toBe(true);
    expect(merged[1]).toEqual({ repo: "dub", check_exit_code: 3 });
  });

  it("replaces every row on an unfiltered run", () => {
    const results = order.map((repo) => ({ repo, check_exit_code: 3, fresh: true }));
    const merged = mergeBaselineRows(existing, results, order);
    expect(merged.every((row) => row.fresh)).toBe(true);
  });

  it("appends a repo that has no baseline row yet", () => {
    const merged = mergeBaselineRows(existing, [{ repo: "newrepo" }], [...order, "newrepo"]);
    expect(merged.map((row) => row.repo)).toEqual(["taxonomy", "dub", "openstatus", "newrepo"]);
  });
});

describe("unsafeBaselineMoves", () => {
  const before = {
    repo: "taxonomy",
    injection_caught: true,
    injection_enforcement: "block",
    blocking_count: 2,
    check_exit_code: 2,
    check_status: "fail"
  };

  it("reports nothing when nothing weakened", () => {
    expect(unsafeBaselineMoves(before, { ...before })).toEqual([]);
    // Strengthening directions are free: refusing (3) where it blocked (2) is fail-closed.
    expect(unsafeBaselineMoves(before, { ...before, check_exit_code: 3, check_status: "refused" })).toEqual([]);
  });

  it("names every safety-relevant field that moved in the unsafe direction", () => {
    const after = {
      ...before,
      injection_caught: false,
      injection_enforcement: "none",
      blocking_count: 0,
      check_exit_code: 0,
      check_status: "pass"
    };
    expect(unsafeBaselineMoves(before, after).sort()).toEqual([
      "blocking_count",
      "check_exit_code",
      "check_status",
      "injection_caught",
      "injection_enforcement"
    ]);
  });

  it("flags enforcement demoted block to warn", () => {
    expect(unsafeBaselineMoves(before, { ...before, injection_enforcement: "warn" })).toEqual([
      "injection_enforcement"
    ]);
  });

  it("flags a refusal that became a silent pass", () => {
    const refused = { ...before, check_exit_code: 3, check_status: "refused", blocking_count: 0, injection_enforcement: "none" };
    const moves = unsafeBaselineMoves(refused, { ...refused, check_exit_code: 0, check_status: "pass" });
    expect(moves.sort()).toEqual(["check_exit_code", "check_status"]);
  });

  it("is silent for a brand-new repo with no baseline row", () => {
    expect(unsafeBaselineMoves(undefined, before)).toEqual([]);
  });

  it("flags an envelope band that widened toward the budget", () => {
    const banded = { ...before, packet_budget_band: "under_60pct" };
    expect(unsafeBaselineMoves(banded, { ...banded, packet_budget_band: "60_to_80pct" })).toEqual([
      "packet_budget_band"
    ]);
  });

  it("lets an envelope band shrink for free", () => {
    const banded = { ...before, packet_budget_band: "80_to_95pct" };
    expect(unsafeBaselineMoves(banded, { ...banded, packet_budget_band: "under_60pct" })).toEqual([]);
  });

  it("is silent when the baseline row predates the band field", () => {
    // The rollout case: every existing row lacks the key until the baseline is rewritten, and a
    // missing baseline value is not evidence of a regression.
    expect(unsafeBaselineMoves(before, { ...before, packet_budget_band: "over_95pct" })).toEqual([]);
  });
});

describe("envelopeBudgetBand", () => {
  it("bands a packet by its share of the budget", () => {
    expect(envelopeBudgetBand(0)).toBe("under_60pct");
    expect(envelopeBudgetBand(299_999)).toBe("under_60pct");
    expect(envelopeBudgetBand(300_000)).toBe("60_to_80pct");
    expect(envelopeBudgetBand(399_999)).toBe("60_to_80pct");
    expect(envelopeBudgetBand(400_000)).toBe("80_to_95pct");
    expect(envelopeBudgetBand(474_999)).toBe("80_to_95pct");
    expect(envelopeBudgetBand(475_000)).toBe("over_95pct");
    expect(envelopeBudgetBand(900_000)).toBe("over_95pct");
  });

  it("returns null rather than a band for an unmeasured packet", () => {
    // `packet_bytes` is absent whenever prepare failed or its output would not parse. A band of
    // "under_60pct" there would read as headroom that was never measured.
    expect(envelopeBudgetBand(undefined)).toBeNull();
    expect(envelopeBudgetBand(NaN)).toBeNull();
    expect(envelopeBudgetBand(100, 0)).toBeNull();
  });

  it("keeps every suite repo clear of a band boundary", () => {
    // The anti-flap requirement, asserted against the committed baseline rather than asserted in
    // prose. `packet_bytes` moves by tens of bytes between runs; if a repo sat within a kilobyte
    // of a boundary this ratchet would flap and get switched off, which is how gates die.
    const rows = JSON.parse(readFileSync(new URL("./external-eval-baseline.json", import.meta.url), "utf8"));
    for (const row of rows) {
      if (typeof row.packet_bytes !== "number") continue;
      const distance = Math.min(
        ...ENVELOPE_BAND_EDGES.map((edge) => Math.abs(row.packet_bytes - edge * PACKET_ENVELOPE_BUDGET))
      );
      expect(distance, `${row.repo} sits ${distance} bytes from a band boundary`).toBeGreaterThan(10_000);
    }
  });

  it("sees the growth the budget boolean cannot", () => {
    // The defect this exists for, stated as a test: BB-6's ceiling is 500,000 and dub's packet is
    // 270,193. A packet that grew to 480,000 - 78% larger, and 96% of the budget - still satisfies
    // `packet_within_envelope_budget`, so repoVerdict passes it and `packet_bytes` is volatile so
    // the diff stays silent. The band is the only field that moves.
    const before = { packet_bytes: 270_193, packet_within_envelope_budget: true };
    const after = { packet_bytes: 480_000, packet_within_envelope_budget: true };
    expect(after.packet_within_envelope_budget).toBe(before.packet_within_envelope_budget);
    expect(envelopeBudgetBand(after.packet_bytes)).not.toBe(envelopeBudgetBand(before.packet_bytes));
    expect(
      unsafeBaselineMoves(
        { ...before, packet_budget_band: envelopeBudgetBand(before.packet_bytes) },
        { ...after, packet_budget_band: envelopeBudgetBand(after.packet_bytes) }
      )
    ).toEqual(["packet_budget_band"]);
  });
});

describe("updateGate", () => {
  const passRow = (repo) => ({
    repo,
    status: "PASS",
    injection_caught: true,
    injection_enforcement: "block",
    blocking_count: 2,
    check_exit_code: 2,
    check_status: "fail"
  });

  it("allows a clean update", () => {
    const gate = updateGate({
      results: [passRow("taxonomy")],
      baselineByRepo: new Map([["taxonomy", passRow("taxonomy")]]),
      acceptedRegressions: new Set(),
      unsafeMovesFor: unsafeBaselineMoves
    });
    expect(gate).toEqual({ ok: true, refusals: [] });
  });

  it("refuses to write a FAILING verdict, naming the repo", () => {
    // (3): 'baseline updated - 0/1 passing' exit 0 is the recorded bug.
    const failing = { ...passRow("taxonomy"), status: "FAIL", failed_assertions: ["check_exit_code_matches_expected"] };
    const gate = updateGate({
      results: [failing],
      baselineByRepo: new Map(),
      acceptedRegressions: new Set(),
      unsafeMovesFor: unsafeBaselineMoves
    });
    expect(gate.ok).toBe(false);
    expect(gate.refusals.join("\n")).toContain("taxonomy");
    expect(gate.refusals.join("\n")).toContain("FAIL");
  });

  it("refuses an unaccepted unsafe move and names the flag that would accept it", () => {
    const weakened = { ...passRow("taxonomy"), blocking_count: 0, check_exit_code: 0, check_status: "pass", injection_enforcement: "none", injection_caught: true };
    const gate = updateGate({
      results: [weakened],
      baselineByRepo: new Map([["taxonomy", passRow("taxonomy")]]),
      acceptedRegressions: new Set(),
      unsafeMovesFor: unsafeBaselineMoves
    });
    expect(gate.ok).toBe(false);
    expect(gate.refusals.join("\n")).toContain("--accept-regression taxonomy:blocking_count");
  });

  it("allows the same move when every regression is named explicitly", () => {
    const weakened = { ...passRow("taxonomy"), blocking_count: 0, check_exit_code: 0, check_status: "pass", injection_enforcement: "none" };
    const gate = updateGate({
      results: [weakened],
      baselineByRepo: new Map([["taxonomy", passRow("taxonomy")]]),
      acceptedRegressions: new Set([
        "taxonomy:blocking_count",
        "taxonomy:check_exit_code",
        "taxonomy:check_status",
        "taxonomy:injection_enforcement"
      ]),
      unsafeMovesFor: unsafeBaselineMoves
    });
    expect(gate).toEqual({ ok: true, refusals: [] });
  });

  it("does not let one accepted regression smuggle a second one through", () => {
    const weakened = { ...passRow("taxonomy"), blocking_count: 0, check_exit_code: 0, check_status: "pass", injection_enforcement: "none" };
    const gate = updateGate({
      results: [weakened],
      baselineByRepo: new Map([["taxonomy", passRow("taxonomy")]]),
      acceptedRegressions: new Set(["taxonomy:blocking_count"]),
      unsafeMovesFor: unsafeBaselineMoves
    });
    expect(gate.ok).toBe(false);
    expect(gate.refusals.join("\n")).toContain("taxonomy:check_exit_code");
    expect(gate.refusals.join("\n")).not.toContain("taxonomy:blocking_count is not");
  });
});

describe("baseline shape", () => {
  it("excludes environment-dependent counts from regression comparison", () => {
    const source = readFileSync(new URL("./external-eval.mjs", import.meta.url), "utf8");
    // Counts that move whenever an upstream repo or the engine's extraction changes; comparing them
    // would produce failures that say nothing about Drift.
    for (const field of ["files", "facts", "candidates", "onboard_seconds"]) {
      expect(source).toMatch(new RegExp(`"${field}"`));
    }
    expect(source).toContain("const VOLATILE");
  });

  it("gates `baselined` rather than treating it as volatile", () => {
    // BB-8: this test previously asserted the opposite, and that assertion is the second half of why
    // the dead cell went unnoticed. Being volatile, `baselined` collapsing 397 -> 0 on every repo was
    // never printed as a "changed vs baseline" line, so the update that recorded the corpse looked like
    // it touched only the three new exemplar fields.
    //
    // It is a deterministic product output on a pinned repo - the decision-C behaviour T121 protects -
    // so a change in it is exactly what this suite exists to report.
    const source = readFileSync(new URL("./external-eval.mjs", import.meta.url), "utf8");
    const volatileBlock = source.slice(source.indexOf("const VOLATILE"), source.indexOf("]);", source.indexOf("const VOLATILE")));
    expect(volatileBlock).not.toContain('"baselined"');
  });

  it("asserts every behavioural field the suite exists to protect", () => {
    const baseline = JSON.parse(
      readFileSync(new URL("./external-eval-baseline.json", import.meta.url), "utf8")
    );
    expect(baseline.length).toBeGreaterThanOrEqual(7);
    for (const row of baseline) {
      expect(row.engine_source).toBe("rust");
      expect(row.fallback_used).toBe(false);
      expect(row.onboarded).toBe(true);
      expect(row.injection_caught).toBe(true);
      expect(row.injection_evidence_correct).toBe(true);
      expect(row.clean_control_false_positive).toBe(false);
      expect(row.fp_type_only_import).toBe(false);
      // BB-8: every suite repo is in the suite because it has pre-existing violations, so every row
      // must record a real baselined count. A committed 0 here means the cell died again.
      expect(row.baselined).toBeGreaterThan(0);
      expect(row.fp_lookalike_module).toBe(false);
      expect(row.catches_genuine_subpath).toBe(true);
      // O-1: exit code asserted against a recorded per-repo expectation; enforcement
      // agreement strictly true (null was a silent pass); evidence attributed to the
      // injected route itself, never an intermediate file.
      expect(Number.isInteger(row.expected_exit_code)).toBe(true);
      expect(row.check_exit_code).toBe(row.expected_exit_code);
      expect(row.enforcement_matches_mode).toBe(true);
      expect(typeof row.injected_route).toBe("string");
      expect(row.injection_evidence_file).toBe(row.injected_route);
      expect(row.status).toBe("PASS");
    }
  });

  it("includes a repo whose data layer defeats the substring whitelist", () => {
    // O-3 moved the repo table to eval-repos.mjs (shared with the evasion matrix).
    const source = readFileSync(new URL("./eval-repos.mjs", import.meta.url), "utf8");
    expect(source).toContain("whitelistIndependent: true");
    const baseline = JSON.parse(
      readFileSync(new URL("./external-eval-baseline.json", import.meta.url), "utf8")
    );
    const independent = baseline.filter((row) => row.discovery_named_data_layer !== undefined);
    expect(independent.length).toBeGreaterThanOrEqual(1);
    for (const row of independent) {
      // The gap must be exercised: inference alone finds nothing, discovery names it.
      expect(row.inference_alone_found_data_layer).toBe(false);
      expect(row.discovery_named_data_layer).toBe(true);
    }
  });
});
