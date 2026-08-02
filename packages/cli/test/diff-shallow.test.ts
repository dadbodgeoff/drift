import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ParsedArgs } from "../src/app/command-types.js";
import { loadDiff } from "../src/check/diff.js";

/**
 * X-2. A shallow clone whose `--diff` range crosses the shallow boundary used to be diagnosed
 * as "Run from a Git worktree or pass --diff-file" - the bare catch in loadDiff swallowed git's
 * stderr, so the one situation CI hits by default (actions/checkout is depth-1) produced advice
 * that could not help: the user IS in a Git worktree. These tests use a real depth-1 clone, not
 * a mock, because the failure mode lives in git's behaviour at the graft boundary.
 */

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_SYSTEM: "/dev/null",
      GIT_AUTHOR_NAME: "drift-test",
      GIT_AUTHOR_EMAIL: "drift-test@example.invalid",
      GIT_COMMITTER_NAME: "drift-test",
      GIT_COMMITTER_EMAIL: "drift-test@example.invalid"
    }
  });
}

function parsedWithDiff(range: string): ParsedArgs {
  return { positional: ["check"], flags: new Map<string, string | true>([["diff", range]]) };
}

let workDir: string;
let sourceRepo: string;
let shallowClone: string;
let fullClone: string;
let plainDir: string;

beforeAll(() => {
  workDir = mkdtempSync(join(tmpdir(), "drift-diff-shallow-"));
  sourceRepo = join(workDir, "src");
  shallowClone = join(workDir, "shallow");
  fullClone = join(workDir, "full");
  plainDir = mkdtempSync(join(workDir, "plain-"));

  git(workDir, "init", "--initial-branch=main", sourceRepo);
  writeFileSync(join(sourceRepo, "route.ts"), "export const GET = () => new Response('one');\n");
  git(sourceRepo, "add", ".");
  git(sourceRepo, "commit", "-m", "first");
  writeFileSync(join(sourceRepo, "route.ts"), "export const GET = () => new Response('two');\n");
  git(sourceRepo, "add", ".");
  git(sourceRepo, "commit", "-m", "second");

  // file:// is required: a plain local path uses hardlink transport, which ignores --depth.
  git(workDir, "clone", "--depth", "1", `file://${sourceRepo}`, shallowClone);
  git(workDir, "clone", `file://${sourceRepo}`, fullClone);
});

afterAll(() => {
  rmSync(workDir, { recursive: true, force: true });
});

describe("loadDiff shallow-boundary diagnosis (X-2)", () => {
  it("fixture is genuinely shallow", () => {
    expect(git(shallowClone, "rev-parse", "--is-shallow-repository").trim()).toBe("true");
    expect(git(fullClone, "rev-parse", "--is-shallow-repository").trim()).toBe("false");
  });

  it("names the shallow boundary, carries git's stderr, and gives the unshallow remediation", () => {
    let message = "";
    try {
      loadDiff(shallowClone, parsedWithDiff("HEAD~1...HEAD"));
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    // The diagnosis must say what actually happened...
    expect(message).toContain("shallow");
    expect(message).toContain("HEAD~1...HEAD");
    // ...with the same remediation X-1 pre-registered (D-4)...
    expect(message).toContain("git fetch --unshallow");
    expect(message).toContain("fetch-depth: 0");
    // ...and git's own stderr must not be swallowed.
    expect(message).toMatch(/unknown revision|bad revision|Invalid revision/i);
    // The old misdiagnosis told a user inside a worktree to run from a worktree.
    expect(message).not.toContain("Run from a Git worktree");
  });

  it("still says 'not a Git worktree' when that is the actual problem", () => {
    let message = "";
    try {
      loadDiff(plainDir, parsedWithDiff("HEAD~1...HEAD"));
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain("not a Git worktree");
    expect(message).toContain("--diff-file");
    // The fixture path itself contains "shallow", so pin on the diagnosis phrases.
    expect(message).not.toContain("shallow clone");
    expect(message).not.toContain("git fetch --unshallow");
  });

  it("reports a bad range in a full clone as a git failure with stderr, not a worktree problem", () => {
    let message = "";
    try {
      loadDiff(fullClone, parsedWithDiff("no-such-branch...HEAD"));
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain("no-such-branch...HEAD");
    expect(message).toMatch(/unknown revision|bad revision|Invalid revision/i);
    expect(message).not.toContain("Run from a Git worktree");
    expect(message).not.toContain("shallow clone");
  });

  it("keeps working parent-crossing diffs in a full clone", () => {
    const diff = loadDiff(fullClone, parsedWithDiff("HEAD~1...HEAD"));
    expect(diff).toContain("route.ts");
    expect(diff).toContain("+export const GET = () => new Response('two');");
  });
});
