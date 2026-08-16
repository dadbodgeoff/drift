import { rm } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { openDriftStorage } from "@drift/storage";
import { runCli } from "../src/index.js";
import { seedDatabase as seedDatabaseShared } from "./support/seed-database.js";

/**
 * W1 / D-CL1. Accept and reject are decisions, and a decision has to stick.
 *
 * The audit found no test in either direction, and both directions were broken:
 *
 *   - accept after reject returned exit 0 and `"changed": true` while the row stayed `rejected`,
 *     because a human accept went through the same upsert as a rescan and the sticky-rejected
 *     clause discarded it;
 *   - reject after accept flipped the candidate but left `accepted_conventions` untouched, so
 *     `contract show` kept enforcing a convention the human had just rejected.
 *
 * Together they let one id be simultaneously rejected and blocking, with five commands each
 * reporting a different, internally consistent story. These assert the full CLI path rather than
 * the storage call, because the contract half of the fix lives in the command layer.
 */

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const CANDIDATE = "candidate_no_direct_db";
const CONVENTION = "convention_no_direct_db";
const REPO = "repo_abc";

const seedDatabase = () => seedDatabaseShared(tempDirs);

async function accept(databasePath: string) {
  return runCli([
    "--db", databasePath,
    "conventions", "accept", CANDIDATE,
    "--repo", REPO,
    "--severity", "error",
    "--mode", "block",
    "--confirm",
    "--json"
  ]);
}

async function reject(databasePath: string) {
  return runCli([
    "--db", databasePath,
    "conventions", "reject", CANDIDATE,
    "--repo", REPO,
    "--reason", "false inference",
    "--confirm",
    "--json"
  ]);
}

async function contractConventionIds(databasePath: string): Promise<string[]> {
  const shown = await runCli(["--db", databasePath, "contract", "show", "--repo", REPO, "--json"]);
  expect(shown.exitCode).toBe(0);
  const payload = JSON.parse(shown.stdout);
  return (payload.contract?.conventions ?? []).map((convention: { id: string }) => convention.id);
}

function candidateStatus(databasePath: string): string | undefined {
  const storage = openDriftStorage({ databasePath });
  try {
    return storage.getConventionCandidate(CANDIDATE)?.status;
  } finally {
    storage.close?.();
  }
}

describe("convention decision round trip", () => {
  it("withdraws the convention from the contract when a previously accepted candidate is rejected", async () => {
    const databasePath = await seedDatabase();

    expect((await accept(databasePath)).exitCode).toBe(0);
    expect(await contractConventionIds(databasePath)).toContain(CONVENTION);
    expect(candidateStatus(databasePath)).toBe("accepted");

    expect((await reject(databasePath)).exitCode).toBe(0);
    expect(candidateStatus(databasePath)).toBe("rejected");
    // The half that was missing: the derived row survived, so the contract kept enforcing a rule
    // the human had just rejected.
    expect(await contractConventionIds(databasePath)).not.toContain(CONVENTION);
  });

  it("really accepts a previously rejected candidate rather than reporting success over a no-op", async () => {
    const databasePath = await seedDatabase();

    expect((await accept(databasePath)).exitCode).toBe(0);
    expect((await reject(databasePath)).exitCode).toBe(0);
    expect(candidateStatus(databasePath)).toBe("rejected");

    const reaccepted = await accept(databasePath);
    expect(reaccepted.exitCode).toBe(0);
    expect(JSON.parse(reaccepted.stdout).changed).toBe(true);

    // Both of these were false before: the row stayed "rejected" and the contract stayed empty,
    // while the command reported a full accepted-convention payload and changed: true.
    expect(candidateStatus(databasePath)).toBe("accepted");
    expect(await contractConventionIds(databasePath)).toContain(CONVENTION);
  });

  it("leaves no standing rejection behind once the candidate is accepted", async () => {
    const databasePath = await seedDatabase();

    expect((await accept(databasePath)).exitCode).toBe(0);
    expect((await reject(databasePath)).exitCode).toBe(0);
    expect((await accept(databasePath)).exitCode).toBe(0);

    const shown = await runCli(["--db", databasePath, "contract", "show", "--repo", REPO, "--json"]);
    const rejections = JSON.parse(shown.stdout).contract?.rejected_inferences ?? [];
    expect(
      rejections.map((entry: { candidate_id: string }) => entry.candidate_id)
    ).not.toContain(CANDIDATE);
  });
});
