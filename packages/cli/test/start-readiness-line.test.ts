import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runCli } from "../src/index.js";
import { readinessLineForTest } from "../src/commands/start.js";
import { acceptanceDisclosure } from "../src/domain/acceptance-disclosure.js";
import type { AcceptedConvention } from "@drift/core";

/**
 * `Ready for AI-assisted work.` printed after every acceptance, including warn-mode ones.
 *
 * Four lines above it, BB-3's disclosure says `new violations will be reported but will NOT
 * block`. Both sentences printed on the same onboarding, and only one of them was true about what
 * the tool would do next. BB-3 exists because ten agent trials (Q9/Q19, 2026-08-03) showed agents
 * treat warn mode as "not a real rule"; a closing line announcing readiness re-states exactly the
 * belief BB-3 was written to remove.
 *
 * Asserted in both directions. A test that only checked the warn case would pass against a build
 * that had deleted the line outright, which loses a true statement rather than fixing a false one.
 */

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function git(cwd: string, ...args: string[]): void {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

const viaService = [
  'import { listUsers } from "@/services/users";',
  "export async function GET() {",
  "  return Response.json(await listUsers());",
  "}",
  ""
].join("\n");

const viaPrisma = [
  'import { prisma } from "@/lib/prisma";',
  "export async function GET() {",
  "  return Response.json(await prisma.user.findMany());",
  "}",
  ""
].join("\n");

/**
 * @param violatingRoutes how many of `totalRoutes` import the data layer directly. The ratio is
 *   what `baseline_coverage_direction` reads: a minority violating means the convention is real
 *   and lands `block`, a majority means it is an aspiration and lands `warn`.
 */
async function onboard(totalRoutes: number, violatingRoutes: number): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "drift-readiness-"));
  tempDirs.push(dir);
  const repoRoot = join(dir, "repo");
  const stateRoot = join(dir, "state");

  await mkdir(join(repoRoot, "lib"), { recursive: true });
  await mkdir(join(repoRoot, "services"), { recursive: true });
  await writeFile(join(repoRoot, "lib/prisma.ts"), "export const prisma = {} as never;\n");
  await writeFile(join(repoRoot, "services/users.ts"), "export const listUsers = async () => [];\n");
  for (let index = 0; index < totalRoutes; index += 1) {
    await mkdir(join(repoRoot, `app/api/r${index}`), { recursive: true });
    await writeFile(
      join(repoRoot, `app/api/r${index}/route.ts`),
      index < violatingRoutes ? viaPrisma : viaService
    );
  }
  await writeFile(join(repoRoot, "package.json"), '{"name":"readiness","version":"1.0.0"}\n');
  git(repoRoot, "init");
  git(repoRoot, "add", ".");
  git(repoRoot, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-m", "init");

  const started = await runCli([
    "start",
    "--repo-root", repoRoot,
    "--state-root", stateRoot,
    "--accept-defaults",
    "--now", "2026-05-10T00:00:00.000Z"
  ]);
  expect(started.exitCode).toBe(0);
  return started.stdout;
}

describe("the line that closes an acceptance", () => {
  it("does not announce readiness in warn mode", async () => {
    // Every route violates, so the convention is read as an aspiration and lands warn.
    const stdout = await onboard(4, 4);
    expect(stdout).toContain("in WARN mode");
    expect(stdout).toContain("will NOT block");
    expect(stdout).not.toContain("Ready for AI-assisted work.");
    // And says what warn mode means for the thing the user came here for.
    expect(stdout).toContain("Nothing accepted here blocks yet");
    expect(stdout).toContain("exit 0");
  }, 120_000);

  it("announces readiness in block mode", async () => {
    // One route of six violates, so the convention is real and lands block.
    const stdout = await onboard(6, 1);
    expect(stdout).toContain("in BLOCK mode");
    expect(stdout).toContain("Ready for AI-assisted work.");
    expect(stdout).not.toContain("Nothing accepted here blocks yet");
  }, 120_000);
});

describe("readinessLine", () => {
  const convention = (mode: AcceptedConvention["enforcement_mode"], id: string): AcceptedConvention => ({
    id,
    contract_id: "contract_repo_abc",
    kind: id,
    statement: "…",
    scope: { include: [], exclude: [] } as AcceptedConvention["scope"],
    matcher: { kind: "forbidden_imports", forbidden_imports: [] } as AcceptedConvention["matcher"],
    severity: "error",
    enforcement_mode: mode,
    enforcement_capability: "deterministic_check",
    exceptions: [],
    evidence_refs: [],
    counterexample_refs: [],
    accepted_by: "cli",
    accepted_at: "2026-05-10T00:00:00.000Z",
    updated_at: "2026-05-10T00:00:00.000Z"
  });

  it("reads every accepted convention, not just the primary", () => {
    // CV-5 lets onboarding accept several at once. One blocking convention is enough for the
    // check to gate, so a warn primary beside a blocking family is still ready - and reporting
    // "nothing blocks" there would be the same class of error in the other direction.
    const disclosure = acceptanceDisclosure({
      accepted: convention("warn", "api_route_no_direct_data_access"),
      alsoAccepted: [convention("block", "api_route_requires_auth_helper")],
      repoId: "repo_abc",
      baselinedCount: 0
    });
    expect(readinessLineForTest(disclosure)).toBe("Ready for AI-assisted work.");
  });

  it("does not announce readiness when nothing accepted blocks", () => {
    const disclosure = acceptanceDisclosure({
      accepted: convention("warn", "api_route_no_direct_data_access"),
      alsoAccepted: [convention("warn", "api_route_requires_auth_helper")],
      repoId: "repo_abc",
      baselinedCount: 0
    });
    expect(readinessLineForTest(disclosure)).toContain("Nothing accepted here blocks yet");
  });
});
