import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

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
