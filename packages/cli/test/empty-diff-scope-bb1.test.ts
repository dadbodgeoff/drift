import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { runCli } from "../src/index.js";

/**
 * BB-1: a check that checked nothing must be distinguishable from a clean check.
 *
 * Verified at b5c3c230: a clean tree with `--diff HEAD` returned `status: "pass"` and exit 0. The
 * file count was reported (`changed_file_count: 0`, `Affected: 0 files`) but the status and exit code
 * were identical to a real pass, so a CI job or hook wired with a wrong diff spec stays green
 * forever - the same silent-green class the EW sprint spent itself killing elsewhere.
 *
 * The negative control comes first on purpose, because it is the trap: a deletion-only diff also has
 * an empty check scope, and it is a completely legitimate change.
 */

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const VIOLATING_ROUTE = [
  'import { prisma } from "@/lib/prisma";',
  "export async function POST() {",
  "  return Response.json(await prisma.user.findMany());",
  "}",
  ""
].join("\n");

const CLEAN_ROUTE = [
  'import { NextResponse } from "next/server";',
  "export async function GET() {",
  "  return NextResponse.json({ ok: true });",
  "}",
  ""
].join("\n");

async function onboardRepo(): Promise<{ repoId: string; databasePath: string; dir: string }> {
  const dir = await mkdtemp(join(tmpdir(), "drift-bb1-"));
  tempDirs.push(dir);
  const repoRoot = join(dir, "repo");
  const stateRoot = join(dir, "state");
  for (const [name, source] of [
    ["users", VIOLATING_ROUTE],
    ["health", CLEAN_ROUTE],
    ["status", CLEAN_ROUTE]
  ] as const) {
    await mkdir(join(repoRoot, "apps/web/app/api", name), { recursive: true });
    await writeFile(join(repoRoot, "apps/web/app/api", name, "route.ts"), source);
  }

  const started = await runCli([
    "start",
    "--repo-root", repoRoot,
    "--state-root", stateRoot,
    "--accept-defaults",
    "--now", "2026-08-03T00:00:30.000Z",
    "--json"
  ]);
  expect(started.exitCode).toBe(0);
  const payload = JSON.parse(started.stdout);
  expect(payload.accepted?.enforcement_mode).toBe("block");
  return { repoId: payload.repo.id, databasePath: payload.state.database_path, dir };
}

function git(cwd: string, ...args: string[]): void {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

/** The same fixture as `onboardRepo`, committed into a real git worktree. */
async function onboardGitRepo(): Promise<{ repoId: string; databasePath: string; repoRoot: string }> {
  const dir = await mkdtemp(join(tmpdir(), "drift-bb1-git-"));
  tempDirs.push(dir);
  const repoRoot = join(dir, "repo");
  const stateRoot = join(dir, "state");
  for (const [name, source] of [
    ["users", VIOLATING_ROUTE],
    ["health", CLEAN_ROUTE],
    ["status", CLEAN_ROUTE]
  ] as const) {
    await mkdir(join(repoRoot, "apps/web/app/api", name), { recursive: true });
    await writeFile(join(repoRoot, "apps/web/app/api", name, "route.ts"), source);
  }
  git(repoRoot, "init", "-q");
  git(repoRoot, "add", "-A");
  execFileSync(
    "git",
    ["-c", "user.email=bb1@drift.test", "-c", "user.name=bb1", "commit", "-qm", "fixture"],
    { cwd: repoRoot, stdio: "ignore" }
  );

  const started = await runCli([
    "start",
    "--repo-root", repoRoot,
    "--state-root", stateRoot,
    "--accept-defaults",
    "--now", "2026-08-03T00:00:30.000Z",
    "--json"
  ]);
  expect(started.exitCode).toBe(0);
  const payload = JSON.parse(started.stdout);
  return { repoId: payload.repo.id, databasePath: payload.state.database_path, repoRoot };
}

async function diffFile(dir: string, name: string, contents: string): Promise<string> {
  const path = join(dir, name);
  await writeFile(path, contents);
  return path;
}

const DELETION_ONLY_DIFF = [
  "--- a/apps/web/app/api/status/route.ts",
  "+++ /dev/null",
  "@@ -1,5 +0,0 @@",
  '-import { NextResponse } from "next/server";',
  "-export async function GET() {",
  "-  return NextResponse.json({ ok: true });",
  "-}",
  "-",
  ""
].join("\n");

const EMPTY_DIFF = "";

const ONE_FILE_VIOLATING_DIFF = [
  "--- /dev/null",
  "+++ b/apps/web/app/api/invites/route.ts",
  "@@ -0,0 +1,4 @@",
  '+import { prisma } from "@/lib/prisma";',
  "+export async function POST() {",
  "+  return Response.json(await prisma.user.findMany());",
  "+}",
  ""
].join("\n");

describe("BB-1 empty diff scope", () => {
  it("does NOT refuse a deletion-only diff - deleting code is a legitimate change", async () => {
    const { repoId, databasePath, dir } = await onboardRepo();
    const path = await diffFile(dir, "deletion-only.diff", DELETION_ONLY_DIFF);

    const result = await runCli([
      "--db", databasePath,
      "check",
      "--repo", repoId,
      "--diff-file", path,
      "--json"
    ]);

    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout);
    expect(payload.check.status).toBe("pass");
    expect(payload.summary.skipped_deleted_files).toEqual(["apps/web/app/api/status/route.ts"]);
  });

  it("says why the scope was empty when it was empty for a good reason", async () => {
    const { repoId, databasePath, dir } = await onboardRepo();
    const path = await diffFile(dir, "deletion-only-text.diff", DELETION_ONLY_DIFF);

    const result = await runCli([
      "--db", databasePath,
      "check",
      "--repo", repoId,
      "--diff-file", path
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Checked 0 files (1 deleted file skipped)");
  });

  it("refuses an entirely empty diff with exit 3 and a named cause", async () => {
    const { repoId, databasePath, dir } = await onboardRepo();
    const path = await diffFile(dir, "empty.diff", EMPTY_DIFF);

    const result = await runCli([
      "--db", databasePath,
      "check",
      "--repo", repoId,
      "--diff-file", path,
      "--json"
    ]);

    // 3, not 0: nothing was examined, so there is no verdict to report.
    expect(result.exitCode).toBe(3);
    const payload = JSON.parse(result.stdout);
    expect(payload.error.type).toBe("refusal");
    expect(payload.error.code).toBe("empty_diff_scope");
    expect(payload.failure.code).toBe("empty_diff_scope");
    // Remediation to the same standard as the shallow-clone refusal: name what to do next.
    expect(payload.failure.user_action).toMatch(/staged|--diff-file|range/);
    expect(payload.failure.recovery_commands.length).toBeGreaterThan(0);
    expect(payload.error.message).toContain("no file was examined");
  });

  it("refuses `--diff HEAD` on a clean tree and names the range", async () => {
    // The headline scenario, and the one a CI job hits: a committed, clean worktree checked against
    // HEAD. `git diff HEAD` is empty, so before BB-1 this was exit 0 / status pass on every run,
    // forever, no matter what the repo contained.
    const { repoId, databasePath, repoRoot } = await onboardGitRepo();

    const result = await runCli([
      "--db", databasePath,
      "check",
      "--repo", repoId,
      "--diff", "HEAD",
      "--json"
    ]);

    expect(result.exitCode).toBe(3);
    const payload = JSON.parse(result.stdout);
    expect(payload.error.type).toBe("refusal");
    expect(payload.error.code).toBe("empty_diff_scope");
    // The range itself, so the user can see what Drift was told to look at.
    expect(payload.error.message).toContain("HEAD");
    expect(payload.error.message).toContain("git diff --unified=0 HEAD");
    expect(repoRoot).toBeTruthy();
  });

  it("passes with a real verdict once that same tree has a staged change", async () => {
    // The other half of the previous test: the refusal must be about the empty scope, not about the
    // repo. Stage a clean file and the same command produces an ordinary verdict.
    const { repoId, databasePath, repoRoot } = await onboardGitRepo();
    await mkdir(join(repoRoot, "apps/web/app/api/ping"), { recursive: true });
    await writeFile(join(repoRoot, "apps/web/app/api/ping/route.ts"), CLEAN_ROUTE);
    git(repoRoot, "add", "-A");

    const result = await runCli([
      "--db", databasePath,
      "check",
      "--repo", repoId,
      "--diff", "HEAD",
      "--json"
    ]);

    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout);
    expect(payload.check.status).toBe("pass");
    expect(payload.summary.affected_scope.changed_file_count).toBe(1);
  });

  it("still blocks on a violating one-file diff - existing behaviour must not wobble", async () => {
    const { repoId, databasePath, dir } = await onboardRepo();
    const path = await diffFile(dir, "one-file.diff", ONE_FILE_VIOLATING_DIFF);
    await mkdir(join(dir, "repo/apps/web/app/api/invites"), { recursive: true });
    await writeFile(join(dir, "repo/apps/web/app/api/invites/route.ts"), VIOLATING_ROUTE);

    const result = await runCli([
      "--db", databasePath,
      "check",
      "--repo", repoId,
      "--diff-file", path,
      "--json"
    ]);

    // 2 = blocked. The refusal must not have swallowed the one case the product exists for.
    expect(result.exitCode).toBe(2);
    const payload = JSON.parse(result.stdout);
    expect(payload.summary.blocking_count).toBeGreaterThan(0);
  });

  it("prints Checked N files on an ordinary non-empty check, not only on empty ones", async () => {
    const { repoId, databasePath, dir } = await onboardRepo();
    const path = await diffFile(dir, "one-file-text.diff", ONE_FILE_VIOLATING_DIFF);
    await mkdir(join(dir, "repo/apps/web/app/api/invites"), { recursive: true });
    await writeFile(join(dir, "repo/apps/web/app/api/invites/route.ts"), VIOLATING_ROUTE);

    const result = await runCli([
      "--db", databasePath,
      "check",
      "--repo", repoId,
      "--diff-file", path
    ]);

    expect(result.stdout).toContain("Checked 1 file");
    expect(result.stdout).not.toContain("deleted file skipped");
  });
});
