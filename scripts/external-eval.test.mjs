import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { repoVerdict } from "./external-eval-predicate.mjs";

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
    catches_genuine_subpath: true
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

describe("baseline shape", () => {
  it("excludes volatile counts from regression comparison", () => {
    const source = readFileSync(new URL("./external-eval.mjs", import.meta.url), "utf8");
    // Counts move whenever an upstream repo changes; comparing them would produce
    // failures that say nothing about Drift.
    for (const field of ["files", "facts", "candidates", "baselined", "onboard_seconds"]) {
      expect(source).toMatch(new RegExp(`"${field}"`));
    }
    expect(source).toContain("const VOLATILE");
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
    const source = readFileSync(new URL("./external-eval.mjs", import.meta.url), "utf8");
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
