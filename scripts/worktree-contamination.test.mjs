import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import {
  contaminationAllowed,
  contaminationRefusal,
  inspectWorktree
} from "./worktree-contamination.mjs";

/**
 * EW-7 / DET-2: the harness must refuse to measure a contaminated worktree.
 *
 * A cal.com findings count changed between runs once. It did not reproduce in 26 consecutive clean
 * runs, and was attributed to cross-agent harness contamination - something else editing the
 * evaluation repo mid-measurement. That attribution was plausible, and it was unfalsifiable: nothing
 * detected contamination, so "it was contamination" and "determinism is not what we claim" left
 * behind identical evidence.
 *
 * The reason it was undetectable is that every harness opens with `git reset --hard && git clean -fd`.
 * Correct hygiene, and it destroys the only trace that anything was there. So the check runs before
 * the reset and refuses rather than tidying - a number from a repo another process was editing is not
 * a slightly wrong number, it is a number about a different repo.
 */

const dirs = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function repoWithHistory() {
  const dir = mkdtempSync(join(tmpdir(), "drift-contamination-"));
  dirs.push(dir);
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: dir,
      stdio: "ignore",
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "t",
        GIT_AUTHOR_EMAIL: "t@t",
        GIT_COMMITTER_NAME: "t",
        GIT_COMMITTER_EMAIL: "t@t"
      }
    });
  git("init", "-q");
  writeFileSync(join(dir, "package.json"), '{"name":"fixture","private":true}\n');
  writeFileSync(join(dir, "route.ts"), "export async function GET() { return null; }\n");
  git("add", "-A");
  git("commit", "-qm", "init");
  return dir;
}

describe("worktree contamination", () => {
  it("passes a clean worktree, so the guard does not block ordinary measurement", () => {
    const root = repoWithHistory();

    const inspection = inspectWorktree(root);
    expect(inspection.clean).toBe(true);
    expect(inspection.head).toMatch(/^[0-9a-f]{40}$/);

    const refusal = contaminationRefusal(root);
    expect(refusal.refused, "a false positive here disables every measurement").toBe(false);
    expect(refusal.reason).toBeNull();
  });

  it("refuses a worktree with a foreign modification to a tracked file", () => {
    const root = repoWithHistory();
    // What another agent editing the repo mid-run looks like.
    writeFileSync(join(root, "route.ts"), "export async function GET() { return 1; }\n");

    const refusal = contaminationRefusal(root, "calcom");

    expect(refusal.refused).toBe(true);
    expect(
      refusal.entries.map((entry) => entry.path),
      "the injected file list is what makes the next question answerable"
    ).toContain("route.ts");
    expect(refusal.reason).toContain("calcom");
    expect(
      refusal.reason,
      "and the refusal has to be actionable, not just a verdict"
    ).toMatch(/reset --hard/);
  });

  it("refuses a worktree with a stray untracked file, and says it was untracked", () => {
    const root = repoWithHistory();
    // The residue a crashed earlier run leaves behind - which is contamination of exactly the kind
    // that would make the next run's numbers describe a repo nobody chose.
    writeFileSync(join(root, "drift-eval-leftover.ts"), "export const leftover = 1;\n");

    const refusal = contaminationRefusal(root);

    expect(refusal.refused).toBe(true);
    const entry = refusal.entries.find((candidate) => candidate.path === "drift-eval-leftover.ts");
    expect(entry, "an untracked leftover is contamination too").toBeDefined();
    expect(
      entry.status.trim(),
      "the status code distinguishes a stray file from a modified one, and those have different causes"
    ).toBe("??");
  });

  it("reports every contaminated file, not just the first", () => {
    const root = repoWithHistory();
    writeFileSync(join(root, "route.ts"), "export async function GET() { return 1; }\n");
    writeFileSync(join(root, "extra-a.ts"), "export const a = 1;\n");
    writeFileSync(join(root, "extra-b.ts"), "export const b = 1;\n");

    const refusal = contaminationRefusal(root);

    expect(refusal.entries.map((entry) => entry.path).sort()).toEqual([
      "extra-a.ts",
      "extra-b.ts",
      "route.ts"
    ]);
  });

  it("refuses rather than crashing when the path is not a git worktree at all", () => {
    const dir = mkdtempSync(join(tmpdir(), "drift-contamination-nongit-"));
    dirs.push(dir);

    const refusal = contaminationRefusal(dir);

    expect(refusal.refused, "an unmeasurable worktree is not a clean one").toBe(true);
    expect(refusal.reason).toMatch(/could not be inspected/);
  });

  it("takes the escape hatch only from the command line, never silently", () => {
    // Deliberately not an env var: a result recorded on a dirty tree has to be recognisable as one
    // later, and the command line is what gets pasted into a report.
    expect(contaminationAllowed(["node", "scripts/external-eval.mjs"])).toBe(false);
    expect(
      contaminationAllowed(["node", "scripts/external-eval.mjs", "--allow-contaminated"])
    ).toBe(true);
  });

  /**
   * Every measurement harness must actually wire the guard up.
   *
   * This test exists because it was needed: the guard body was inserted into external-eval.mjs while
   * its import was not, since that file imports a different symbol set from the predicate module than
   * the others do and the patch matched nothing. `node --check` passes on that - the reference is only
   * undefined at runtime - so the suite stayed green and `pnpm eval:external` crashed on its first
   * real run with `contaminationRefusal is not defined`.
   *
   * These scripts execute on import, so they cannot be loaded in a test. Reading them is the cheap
   * check that catches a call without its import.
   */
  it("is imported and called by every measurement harness", () => {
    const scriptsDir = dirname(fileURLToPath(import.meta.url));
    for (const harness of [
      "external-eval.mjs",
      "evasion-matrix.mjs",
      "beta-bench.mjs",
      "determinism.mjs"
    ]) {
      const source = readFileSync(resolve(scriptsDir, harness), "utf8");
      expect(
        source,
        `${harness} must import the guard, not just call it - an undefined reference here only ` +
          "surfaces on a real run, which is a 30-minute round trip"
      ).toMatch(/import \{[^}]*contaminationRefusal[^}]*\} from "\.\/worktree-contamination\.mjs"/);
      expect(source, `${harness} must actually call it`).toMatch(/contaminationRefusal\(/);
      expect(
        source,
        `${harness} must honour the explicit escape hatch rather than refusing unconditionally`
      ).toMatch(/contaminationAllowed\(/);
    }
  });
});
