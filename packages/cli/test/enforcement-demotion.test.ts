import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { openDriftStorage } from "@drift/storage";
import { runCli } from "../src/index.js";

/**
 * E-6 (decision D-2, TDD S1-06): a block -> warn transition of an accepted convention is
 * never silent.
 *
 * T100's recall improvement demoted taxonomy block -> warn with nothing in any output
 * saying so - the same defect class as the silent enforcement zeroing S1-01 closed. Any
 * demotion of an accepted convention must (1) append an explicit `enforcement_demoted`
 * audit event and (2) be surfaced in the check JSON while the weaker mode is in effect.
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

async function onboardRepo(): Promise<{
  repoId: string;
  databasePath: string;
  candidateId: string;
  conventionId: string;
}> {
  const dir = await mkdtemp(join(tmpdir(), "drift-demotion-"));
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
    "--now", "2026-05-10T00:00:30.000Z",
    "--json"
  ]);
  expect(started.exitCode).toBe(0);
  const payload = JSON.parse(started.stdout);
  const candidate = payload.candidates.find(
    (entry: { kind: string }) => entry.kind === "api_route_no_direct_data_access"
  );
  expect(candidate).toBeTruthy();
  // 1 violating file of 3 scope files: the baseline direction is block.
  expect(payload.accepted?.enforcement_mode).toBe("block");
  return {
    repoId: payload.repo.id,
    databasePath: payload.state.database_path,
    candidateId: candidate.id,
    conventionId: payload.accepted.id
  };
}

describe("enforcement demotion is explicit", () => {
  it("re-accepting at warn appends enforcement_demoted and the check JSON surfaces it", async () => {
    const { repoId, databasePath, candidateId, conventionId } = await onboardRepo();

    const demoted = await runCli([
      "--db", databasePath,
      "conventions", "accept", candidateId,
      "--repo", repoId,
      "--mode", "warn",
      "--confirm",
      "--now", "2026-05-10T00:01:00.000Z",
      "--json"
    ]);
    expect(demoted.exitCode).toBe(0);

    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    const events = storage
      .listAuditEvents(repoId)
      .filter((event) => event.action === "enforcement_demoted");
    storage.close();
    expect(events, "block -> warn must append an explicit audit event").toHaveLength(1);
    expect(events[0]).toMatchObject({
      target_type: "convention",
      target_id: conventionId,
      metadata: expect.objectContaining({ from: "block", to: "warn" })
    });

    const checked = await runCli([
      "--db", databasePath,
      "check",
      "--repo", repoId,
      "--scope", "full",
      "--json"
    ]);
    const checkPayload = JSON.parse(checked.stdout);
    expect(
      checkPayload.summary.enforcement_demotions,
      "the check JSON must say the convention was demoted"
    ).toMatchObject([
      expect.objectContaining({ convention_id: conventionId, from: "block", to: "warn" })
    ]);
  }, 240_000);

  it("re-promoting to block emits no demotion event and clears the check surface", async () => {
    const { repoId, databasePath, candidateId } = await onboardRepo();

    for (const mode of ["warn", "block"]) {
      const result = await runCli([
        "--db", databasePath,
        "conventions", "accept", candidateId,
        "--repo", repoId,
        "--mode", mode,
        "--confirm",
        "--now", `2026-05-10T00:0${mode === "warn" ? 1 : 2}:00.000Z`,
        "--json"
      ]);
      expect(result.exitCode).toBe(0);
    }

    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    const events = storage
      .listAuditEvents(repoId)
      .filter((event) => event.action === "enforcement_demoted");
    storage.close();
    // The warn hop is still an explicit event; the promotion back is not a demotion.
    expect(events).toHaveLength(1);

    const checked = await runCli([
      "--db", databasePath,
      "check",
      "--repo", repoId,
      "--scope", "full",
      "--json"
    ]);
    const checkPayload = JSON.parse(checked.stdout);
    expect(
      checkPayload.summary.enforcement_demotions,
      "a convention back at block must not keep reporting a demotion"
    ).toBeUndefined();
  }, 240_000);
});
