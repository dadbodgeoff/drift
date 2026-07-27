import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { runCli } from "../src/index.js";
import { seedDatabase as seedDatabaseShared } from "./support/seed-database.js";

/**
 * T61. First slice out of cli.test.ts, which had grown to 15,846 lines and 346 tests inside a
 * single describe.
 *
 * Split opportunistically rather than all at once. Most families in that file are scattered
 * across thousands of lines - the 114 "rejects…" tests run from line 612 to 15779 - so a bulk
 * move means 114 individual relocations, and a test dropped in transit looks exactly like a test
 * that passes. This family is contiguous and self-contained, so it moves cleanly.
 */

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const seedDatabase = (): Promise<string> => seedDatabaseShared(tempDirs);

describe("drift CLI positional argument validation", () => {
  it("rejects unexpected init positional arguments", async () => {
    const dir = await mkdtemp(join(tmpdir(), "drift-init-extra-arg-"));
    tempDirs.push(dir);
    const repoRoot = join(dir, "repo");
    await mkdir(repoRoot, { recursive: true });

    const result = await runCli([
      "init",
      "extra",
      "--repo-root", repoRoot,
      "--state-root", join(dir, "state"),
      "--json"
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Unexpected argument for init: extra");
  });

  it("rejects unexpected scan status positional arguments", async () => {
    const databasePath = await seedDatabase();

    const result = await runCli([
      "--db", databasePath,
      "scan", "status", "extra",
      "--repo", "repo_abc",
      "--json"
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Unexpected argument for scan status: extra");
  });

  it("rejects unexpected convention show positional arguments", async () => {
    const databasePath = await seedDatabase();

    const result = await runCli([
      "--db", databasePath,
      "conventions", "show", "candidate_no_direct_db", "extra",
      "--json"
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Unexpected argument for conventions show: extra");
  });

  it("rejects unexpected contract import positional arguments", async () => {
    const databasePath = await seedDatabase();

    const result = await runCli([
      "--db", databasePath,
      "contract", "import", "/tmp/contract.json", "extra",
      "--repo", "repo_abc",
      "--dry-run",
      "--json"
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Unexpected argument for contract import: extra");
  });

  it("rejects unexpected finding resolution positional arguments", async () => {
    const databasePath = await seedDatabase();

    const result = await runCli([
      "--db", databasePath,
      "findings", "mark-fixed", "finding_abc", "extra",
      "--repo", "repo_abc",
      "--evidence", "apps/web/app/api/users/route.ts:12",
      "--json"
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Unexpected argument for findings mark-fixed: extra");
  });
});
