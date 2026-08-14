import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { PRESENCE_AUTO_ACCEPT_MIN_EVIDENCE_FILES } from "@drift/core";
import { acceptanceDisclosureLines } from "../src/domain/acceptance-disclosure.js";
import { runCli } from "../src/index.js";

/**
 * T-04: a family held back because a FLAG was not passed must not be reported as below a floor.
 *
 * `--accept-families` gates auto-acceptance, and everything not accepted is listed as deferred. The
 * disclosure then described every deferral with the same sentence, so a family that cleared both
 * floors was told it had failed them:
 *
 *   1 candidate awaiting review: api_route_requires_auth_helper, 77.4% coverage
 *     — below the auto-accept floor.
 *
 * Measured on dub, whose auth family sits at coverage 0.774 against a floor of 0.6 and 365 evidence
 * refs against a floor of 20. It cleared both. The number in the sentence was real, and the
 * explanation attached to it was false - which is worse than saying nothing, because a user who
 * reads it goes looking for coverage to improve instead of passing the flag.
 */

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const WRAPPED = (wrapper: string) =>
  [
    `import { ${wrapper} } from "@/lib/auth";`,
    `export const POST = ${wrapper}(async () => {`,
    "  return Response.json({ ok: true });",
    "});",
    ""
  ].join("\n");

// The unwrapped routes also import the data layer directly. That gives inference a
// `no_direct_data_access` candidate to accept, which is what makes an acceptance disclosure exist
// at all - a disclosure that never renders cannot be wrong about anything.
const NAKED = [
  'import { prisma } from "@/lib/db";',
  "export async function POST() { const u = await prisma.user.findMany(); return Response.json(u); }",
  ""
].join("\n");

function git(cwd: string, ...args: string[]): void {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

/**
 * `wrapped` routes call an accepted helper and `naked` routes call none, so coverage is
 * wrapped/(wrapped+naked) and the evidence-file count is `wrapped`. Both floors are addressable
 * independently, which is what lets each deferral reason be provoked on its own.
 */
async function onboardWith(
  wrapped: number,
  naked: number,
  extraArgs: string[] = []
): Promise<{ stdout: string; exitCode: number }> {
  const dir = await mkdtemp(join(tmpdir(), "drift-t04-"));
  tempDirs.push(dir);
  const repoRoot = join(dir, "repo");
  const stateRoot = join(dir, "state");

  await mkdir(join(repoRoot, "lib"), { recursive: true });
  // A real data layer, imported directly by the unwrapped routes below.
  await writeFile(
    join(repoRoot, "lib/db.ts"),
    "export const prisma = { user: { findMany: async () => [] } };\n"
  );
  await writeFile(
    join(repoRoot, "lib/auth.ts"),
    [
      "export const withSession = (handler: unknown) => handler;",
      "export const withWorkspace = (handler: unknown) => handler;",
      ""
    ].join("\n")
  );
  for (let index = 0; index < wrapped; index += 1) {
    const path = join(repoRoot, `app/api/w${index}`);
    await mkdir(path, { recursive: true });
    await writeFile(join(path, "route.ts"), WRAPPED(index % 2 === 0 ? "withSession" : "withWorkspace"));
  }
  for (let index = 0; index < naked; index += 1) {
    const path = join(repoRoot, `app/api/n${index}`);
    await mkdir(path, { recursive: true });
    await writeFile(join(path, "route.ts"), NAKED);
  }
  await writeFile(
    join(repoRoot, "tsconfig.json"),
    JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@/*": ["./*"] } } })
  );
  git(repoRoot, "init", "-q");
  git(repoRoot, "add", "-A");
  execFileSync(
    "git",
    ["-c", "user.email=t04@drift.test", "-c", "user.name=t04", "commit", "-qm", "fixture"],
    { cwd: repoRoot, stdio: "ignore" }
  );

  return runCli([
    "start",
    "--repo-root", repoRoot,
    "--state-root", stateRoot,
    "--accept-defaults",
    "--now", "2026-08-14T00:00:30.000Z",
    "--json",
    ...extraArgs
  ]);
}

interface Deferred {
  convention_kind: string;
  deferred_reason?: string;
  coverage_ratio: number;
  evidence_file_count: number;
}

function authDeferral(stdout: string): Deferred {
  const payload = JSON.parse(stdout);
  const deferred = (payload.acceptance?.deferred_candidates ?? []).find(
    (entry: Deferred) => entry.convention_kind === "api_route_requires_auth_helper"
  );
  expect(deferred, `no deferred auth family in: ${stdout.slice(0, 4000)}`).toBeDefined();
  return deferred;
}

/** Enough wrapped routes to clear the evidence-file floor with margin. */
const ABOVE_EVIDENCE_FLOOR = PRESENCE_AUTO_ACCEPT_MIN_EVIDENCE_FILES + 5;

describe("a deferral says which of the four reasons it was", () => {
  it("reports a flag-gated family as flag-gated, not as below a floor", async () => {
    // Clears both floors: coverage 25/26 = 0.96 against 0.6, and 25 evidence files against 20.
    const result = await onboardWith(ABOVE_EVIDENCE_FLOOR, 1);
    expect(result.exitCode, result.stdout).toBe(0);
    const deferred = authDeferral(result.stdout);

    expect(deferred.deferred_reason).toBe("families_flag_not_set");
  }, 120_000);

  it("does not tell a user to fix coverage that is already above the floor", async () => {
    const result = await onboardWith(ABOVE_EVIDENCE_FLOOR, 1);
    // The human rendering, taken from the same disclosure the text output is built from.
    const text = acceptanceDisclosureLines(JSON.parse(result.stdout).acceptance).join("\n");

    expect(text).not.toContain("below the auto-accept floor");
    // It must say what WOULD accept it, since the remedy is a flag rather than better coverage.
    expect(text).toContain("--accept-families");
  }, 120_000);

  it("still reports a genuinely below-coverage family as below coverage", async () => {
    // 20 wrapped / 20 naked: evidence files clear the floor, coverage (0.5) does not.
    const result = await onboardWith(
      PRESENCE_AUTO_ACCEPT_MIN_EVIDENCE_FILES,
      PRESENCE_AUTO_ACCEPT_MIN_EVIDENCE_FILES
    );
    expect(result.exitCode, result.stdout).toBe(0);

    expect(authDeferral(result.stdout).deferred_reason).toBe("below_coverage_floor");
  }, 120_000);
});
