import { execFileSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { runCli } from "../src/index.js";

/**
 * T-08: `audit verify` must fail the process when the chain is broken.
 *
 * Measured on a real 4-event chain, tampering the database directly:
 *
 *   untampered       exit 0   valid=true
 *   actor edited     exit 0   valid=false  event_hash_mismatch
 *   middle deleted   exit 0   valid=false  previous_event_hash_mismatch
 *   action off-enum  exit 1   (Zod throw, unparseable output)
 *
 * The asymmetry is inverted. Detection - the thing the hash chain exists to do - exits 0, so any
 * CI step running `drift audit verify` passes while the audit log is provably forged. Meanwhile
 * data that merely fails to parse exits 1 and looks like a Drift bug.
 *
 * Exit 2 for a broken chain: this is not Drift failing (1) and not a refusal (3), it is Drift
 * successfully detecting a violation - the same meaning exit 2 already carries for a diff that
 * violates the contract.
 *
 * Schema-invalid rows are detection too, not a crash. A row whose `action` is outside the enum did
 * not get there by accident; reporting `schema_invalid` says so, where a Zod stack trace does not.
 */

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function git(cwd: string, ...args: string[]): void {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

function sqlite(databasePath: string, statement: string): void {
  execFileSync("sqlite3", [databasePath, statement], { stdio: "ignore" });
}

async function chainFixture(): Promise<{ databasePath: string; repoId: string; dir: string }> {
  const dir = await mkdtemp(join(tmpdir(), "drift-t08-"));
  tempDirs.push(dir);
  const repoRoot = join(dir, "repo");

  await mkdir(join(repoRoot, "lib"), { recursive: true });
  await writeFile(
    join(repoRoot, "lib/prisma.ts"),
    "export const prisma = { t: { findMany: async () => [] } };\n"
  );
  for (let index = 0; index < 4; index += 1) {
    const path = join(repoRoot, `app/api/r${index}`);
    await mkdir(path, { recursive: true });
    await writeFile(
      join(path, "route.ts"),
      [
        'import { prisma } from "@/lib/prisma";',
        "export async function GET() { return Response.json(await prisma.t.findMany()); }",
        ""
      ].join("\n")
    );
  }
  await writeFile(
    join(repoRoot, "tsconfig.json"),
    JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@/*": ["./*"] } } })
  );
  await writeFile(join(repoRoot, "package.json"), '{"name":"t08","version":"1.0.0"}\n');
  git(repoRoot, "init", "-q");
  git(repoRoot, "add", "-A");
  execFileSync(
    "git",
    ["-c", "user.email=t08@drift.test", "-c", "user.name=t08", "commit", "-qm", "fixture"],
    { cwd: repoRoot, stdio: "ignore" }
  );

  const started = await runCli([
    "start", "--repo-root", repoRoot, "--state-root", join(dir, "state"),
    "--accept-defaults", "--now", "2026-08-14T00:00:30.000Z", "--json"
  ]);
  expect(started.exitCode, started.stdout).toBe(0);
  const payload = JSON.parse(started.stdout);
  return { databasePath: payload.state.database_path, repoId: payload.repo.id, dir };
}

/** A copy of the chain database with one tamper applied, so each case starts from a valid chain. */
async function tampered(statement: string | null): Promise<{ exitCode: number; stdout: string }> {
  const { databasePath, repoId, dir } = await chainFixture();
  const copy = join(dir, "tampered.db");
  await copyFile(databasePath, copy);
  if (statement) {
    sqlite(copy, statement);
  }
  return runCli(["--db", copy, "audit", "verify", "--repo", repoId, "--json"]);
}

const FIRST_EVENT = "(select min(sequence) from audit_events)";

describe("a broken audit chain fails the process", () => {
  it("still passes an untampered chain", async () => {
    const result = await tampered(null);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout).verification.valid).toBe(true);
  }, 120_000);

  it("exits 2 when an event field was edited", async () => {
    const result = await tampered(
      `update audit_events set actor='mallory' where sequence=${FIRST_EVENT};`
    );
    const payload = JSON.parse(result.stdout);

    // Today: exit 0. The chain says forged and the process says fine.
    expect(result.exitCode).toBe(2);
    expect(payload.verification.valid).toBe(false);
    expect(payload.verification.reasons).toContain("event_hash_mismatch");
  }, 120_000);

  it("exits 2 when an event was removed from the middle", async () => {
    const result = await tampered(
      `delete from audit_events where sequence=${FIRST_EVENT}+1;`
    );
    const payload = JSON.parse(result.stdout);

    expect(result.exitCode).toBe(2);
    expect(payload.verification.valid).toBe(false);
    expect(payload.verification.reasons).toContain("previous_event_hash_mismatch");
  }, 120_000);

  it("reports a schema-invalid row as detection rather than a crash", async () => {
    const result = await tampered(
      `update audit_events set action='not_a_real_action' where sequence=${FIRST_EVENT};`
    );

    // Today: exit 1 and an unparseable Zod stack trace on stderr.
    expect(result.exitCode).toBe(2);
    const payload = JSON.parse(result.stdout);
    expect(payload.verification.valid).toBe(false);
    expect(payload.verification.reasons).toContain("schema_invalid");
  }, 120_000);
});
