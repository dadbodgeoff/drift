import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { runCli } from "../src/index.js";

/**
 * BB-9: a diff naming files absent from the working tree must not claim complete coverage.
 *
 * Reproduced at `30e2e036`: a `--diff-file` patch naming a file that does not exist produced
 * `changed_file_count: 1`, `partial_coverage: {complete: true}`, zero findings, exit 0 — and the output
 * never mentioned the file. This is BB-1's bug one level up: the scope is non-empty, nothing in it was
 * examinable, and completeness is claimed anyway. Real shapes: CI applying a patch to the wrong
 * checkout, a hook racing a branch switch, a stale patch file.
 *
 * The negative controls come first, and the deletion-only one is the trap: deleted files are absent
 * from the working tree by definition, and counting them as "missing" would break the BB-1 path.
 */

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const VIOLATING = [
  'import { prisma } from "@/lib/prisma";',
  "export async function POST() {",
  "  return Response.json(await prisma.user.findMany());",
  "}",
  ""
].join("\n");

const CLEAN = [
  'import { NextResponse } from "next/server";',
  "export async function GET() {",
  "  return NextResponse.json({ ok: true });",
  "}",
  ""
].join("\n");

function git(cwd: string, ...args: string[]): void {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

/**
 * One violating route among three clean ones, so `baseline_coverage_direction` accepts the data-access
 * convention in **block** mode — required by red #4, which asserts a violation on a present file still
 * blocks even though coverage degraded.
 */
async function onboard(): Promise<{
  repoId: string;
  databasePath: string;
  repoRoot: string;
  dir: string;
}> {
  const dir = await mkdtemp(join(tmpdir(), "drift-bb9-"));
  tempDirs.push(dir);
  const repoRoot = join(dir, "repo");
  const stateRoot = join(dir, "state");

  await mkdir(join(repoRoot, "lib"), { recursive: true });
  await writeFile(join(repoRoot, "lib/prisma.ts"), "export const prisma = {} as never;\n");
  for (const [path, source] of [
    ["app/api/legacy/route.ts", VIOLATING],
    ["app/api/health/route.ts", CLEAN],
    ["app/api/status/route.ts", CLEAN],
    ["app/api/ping/route.ts", CLEAN]
  ] as const) {
    await mkdir(join(repoRoot, path, ".."), { recursive: true });
    await writeFile(join(repoRoot, path), source);
  }
  await writeFile(
    join(repoRoot, "tsconfig.json"),
    JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@/*": ["./*"] } } })
  );
  git(repoRoot, "init", "-q");
  git(repoRoot, "add", "-A");
  execFileSync("git", ["-c", "user.email=bb9@drift.test", "-c", "user.name=bb9", "commit", "-qm", "fixture"], {
    cwd: repoRoot,
    stdio: "ignore"
  });

  const started = await runCli([
    "start",
    "--repo-root", repoRoot,
    "--state-root", stateRoot,
    "--accept-defaults",
    "--now", "2026-08-04T00:00:30.000Z",
    "--json"
  ]);
  expect(started.exitCode).toBe(0);
  const payload = JSON.parse(started.stdout);
  // Pin the precondition: without a block-mode data-access convention, red #4 would assert nothing.
  expect(payload.accepted?.kind).toBe("api_route_no_direct_data_access");
  expect(payload.accepted?.enforcement_mode).toBe("block");
  return {
    repoId: payload.repo.id,
    databasePath: payload.state.database_path,
    repoRoot,
    dir
  };
}

const addedFileDiff = (path: string) => [
  "--- /dev/null",
  `+++ b/${path}`,
  "@@ -0,0 +1,2 @@",
  '+import { prisma } from "@/lib/prisma";',
  "+export async function POST() { return Response.json(await prisma.user.findMany()); }",
  ""
].join("\n");

async function diffFile(dir: string, name: string, contents: string): Promise<string> {
  const path = join(dir, name);
  await writeFile(path, contents);
  return path;
}

const check = (databasePath: string, repoId: string, diffPath: string, ...extra: string[]) =>
  runCli(["--db", databasePath, "check", "--repo", repoId, "--diff-file", diffPath, "--json", ...extra]);

describe("BB-9 stale diff scope", () => {
  describe("negative controls", () => {
    it("is byte-identical to today for a diff naming only present files - blocking case", async () => {
      const { repoId, databasePath, repoRoot, dir } = await onboard();
      await mkdir(join(repoRoot, "app/api/new"), { recursive: true });
      await writeFile(join(repoRoot, "app/api/new/route.ts"), VIOLATING);
      const path = await diffFile(dir, "present-violating.diff", addedFileDiff("app/api/new/route.ts"));

      const result = await check(databasePath, repoId, path);
      const payload = JSON.parse(result.stdout);

      expect(result.exitCode).toBe(2);
      expect(payload.summary.blocking_count).toBeGreaterThan(0);
      expect(payload.summary.partial_coverage.complete).toBe(true);
      expect(payload.summary.affected_scope.missing_file_count).toBe(0);
    }, 60_000);

    it("is byte-identical to today for a diff naming only present files - passing case", async () => {
      const { repoId, databasePath, repoRoot, dir } = await onboard();
      await mkdir(join(repoRoot, "app/api/fresh"), { recursive: true });
      await writeFile(join(repoRoot, "app/api/fresh/route.ts"), CLEAN);
      const path = await diffFile(dir, "present-clean.diff", [
        "--- /dev/null",
        "+++ b/app/api/fresh/route.ts",
        "@@ -0,0 +1,2 @@",
        '+import { NextResponse } from "next/server";',
        "+export async function GET() { return NextResponse.json({ ok: true }); }",
        ""
      ].join("\n"));

      const result = await check(databasePath, repoId, path);
      const payload = JSON.parse(result.stdout);

      expect(result.exitCode).toBe(0);
      expect(payload.check.status).toBe("pass");
      expect(payload.summary.partial_coverage.complete).toBe(true);
      expect(payload.summary.affected_scope.missing_file_count).toBe(0);
    }, 60_000);

    it("does NOT treat a deletion-only diff as missing files - the trap", async () => {
      // Deleted files are absent from the working tree by definition. Counting them as "missing" would
      // turn BB-1's deletion-only pass into a BB-9 refusal, which is why this test is written first.
      const { repoId, databasePath, repoRoot, dir } = await onboard();
      git(repoRoot, "rm", "-q", "app/api/status/route.ts");
      const path = await diffFile(dir, "deletion-only.diff", [
        "--- a/app/api/status/route.ts",
        "+++ /dev/null",
        "@@ -1,2 +0,0 @@",
        '-import { NextResponse } from "next/server";',
        "-export async function GET() { return NextResponse.json({ ok: true }); }",
        ""
      ].join("\n"));

      const result = await check(databasePath, repoId, path);
      const payload = JSON.parse(result.stdout);

      expect(result.exitCode).toBe(0);
      expect(payload.check.status).toBe("pass");
      expect(payload.summary.affected_scope.missing_file_count).toBe(0);
      expect(payload.summary.partial_coverage.reasons).not.toContainEqual(
        expect.stringContaining("changed_file_missing_from_worktree")
      );
    }, 60_000);

    it("does NOT treat a renamed-away path as missing - BB-1b stays intact", async () => {
      const { repoId, databasePath, repoRoot } = await onboard();
      await mkdir(join(repoRoot, "app/api/moved"), { recursive: true });
      git(repoRoot, "mv", "app/api/status/route.ts", "app/api/moved/route.ts");

      const result = await runCli([
        "--db", databasePath, "check", "--repo", repoId, "--diff", "HEAD", "--json"
      ]);
      const payload = JSON.parse(result.stdout);

      expect(result.exitCode).toBe(0);
      expect(payload.check.status).toBe("pass");
      expect(payload.summary.affected_scope.missing_file_count).toBe(0);
    }, 60_000);
  });

  describe("the reconciliation", () => {
    it("refuses with stale_diff_scope when every named file is absent", async () => {
      const { repoId, databasePath, dir } = await onboard();
      const path = await diffFile(dir, "all-absent.diff", addedFileDiff("app/api/ghost/route.ts"));

      const result = await check(databasePath, repoId, path);
      const payload = JSON.parse(result.stdout);

      expect(result.exitCode).toBe(3);
      expect(payload.error.type).toBe("refusal");
      // A distinct cause from an empty diff: there the range is wrong, here the diff and the checkout
      // disagree about what exists, and the remediation differs.
      expect(payload.error.code).toBe("stale_diff_scope");
      expect(payload.error.code).not.toBe("empty_diff_scope");
      expect(payload.failure.code).toBe("stale_diff_scope");
      // The file is named, which the silent pass never did.
      expect(payload.error.message).toContain("app/api/ghost/route.ts");
      expect(payload.failure.user_action).toMatch(/Regenerate|checkout/);
    }, 60_000);

    it("keeps enforcing the present file while reporting the absent one", async () => {
      // Red #4: enforcement must not weaken because coverage degraded. A violation Drift did prove
      // stays proven.
      const { repoId, databasePath, repoRoot, dir } = await onboard();
      await mkdir(join(repoRoot, "app/api/new"), { recursive: true });
      await writeFile(join(repoRoot, "app/api/new/route.ts"), VIOLATING);
      const path = await diffFile(
        dir,
        "mixed.diff",
        `${addedFileDiff("app/api/new/route.ts")}${addedFileDiff("app/api/ghost/route.ts")}`
      );

      const result = await check(databasePath, repoId, path);
      const payload = JSON.parse(result.stdout);

      // 2 = blocked. The refusal must not have swallowed the violation.
      expect(result.exitCode).toBe(2);
      expect(payload.summary.blocking_count).toBeGreaterThan(0);
      // And coverage is honest about what it could not see.
      expect(payload.summary.partial_coverage.complete).toBe(false);
      expect(payload.summary.partial_coverage.reasons).toContain(
        "changed_file_missing_from_worktree:app/api/ghost/route.ts"
      );
      expect(payload.summary.affected_scope.missing_file_count).toBe(1);
      expect(payload.summary.affected_scope.changed_file_count).toBe(1);
    }, 60_000);

    it("names the missing file in the human output", async () => {
      const { repoId, databasePath, repoRoot, dir } = await onboard();
      await mkdir(join(repoRoot, "app/api/new"), { recursive: true });
      await writeFile(join(repoRoot, "app/api/new/route.ts"), CLEAN);
      const path = await diffFile(
        dir,
        "mixed-text.diff",
        `${addedFileDiff("app/api/new/route.ts")}${addedFileDiff("app/api/ghost/route.ts")}`
      );

      const result = await runCli([
        "--db", databasePath, "check", "--repo", repoId, "--diff-file", path
      ]);

      expect(result.stdout).toContain("Checked 1 file (1 file missing from working tree)");
    }, 60_000);
  });
});
