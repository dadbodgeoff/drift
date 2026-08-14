import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { runCli } from "../src/index.js";

/**
 * T-12 / B1: onboarding must not install a gate that cannot gate, or print a command that fails.
 *
 * On a repo that already follows its own convention - every route delegating through a service
 * layer, zero violations - the only candidate inference produces is
 * `api_route_requires_service_delegation`, whose `enforcement_capability` is `heuristic_check`.
 * `--accept-defaults` accepted it, at warn, and then printed:
 *
 *   Accepted "api_route_requires_service_delegation" in WARN mode (... will NOT block).
 *   To make this a gate: drift conventions accept <id> --severity error --mode block --confirm
 *
 * Running that command verbatim exits 1: "Only deterministic conventions can use --mode block."
 *
 * So the best-behaved repo in the corpus gets a convention that can never block, and the one
 * instruction offered for fixing that is rejected by the tool that printed it. This is the
 * measured mechanism behind "the gate doesn't gate by default" on a greenfield repo - the gate is
 * not weak, it is incapable, and the output does not say so.
 */

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function git(cwd: string, ...args: string[]): void {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

/** A repo that fully complies: every route delegates, nothing imports the data layer directly. */
async function onboardFullyConforming(): Promise<{ stdout: string; exitCode: number }> {
  const dir = await mkdtemp(join(tmpdir(), "drift-t12-"));
  tempDirs.push(dir);
  const repoRoot = join(dir, "repo");

  await mkdir(join(repoRoot, "lib"), { recursive: true });
  await mkdir(join(repoRoot, "services"), { recursive: true });
  await writeFile(
    join(repoRoot, "lib/prisma.ts"),
    "export const prisma = { thing: { findMany: async () => [] } };\n"
  );
  await writeFile(
    join(repoRoot, "services/things.ts"),
    [
      'import { prisma } from "@/lib/prisma";',
      "export async function listThings() { return prisma.thing.findMany(); }",
      ""
    ].join("\n")
  );
  for (let index = 0; index < 10; index += 1) {
    const path = join(repoRoot, `app/api/ok${index}`);
    await mkdir(path, { recursive: true });
    await writeFile(
      join(path, "route.ts"),
      [
        'import { listThings } from "@/services/things";',
        "export async function GET() {",
        "  return Response.json(await listThings());",
        "}",
        ""
      ].join("\n")
    );
  }
  await writeFile(
    join(repoRoot, "tsconfig.json"),
    JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@/*": ["./*"] } } })
  );
  await writeFile(join(repoRoot, "package.json"), '{"name":"t12","version":"1.0.0"}\n');
  git(repoRoot, "init", "-q");
  git(repoRoot, "add", "-A");
  execFileSync(
    "git",
    ["-c", "user.email=t12@drift.test", "-c", "user.name=t12", "commit", "-qm", "fixture"],
    { cwd: repoRoot, stdio: "ignore" }
  );

  return runCli([
    "start",
    "--repo-root", repoRoot,
    "--state-root", join(dir, "state"),
    "--accept-defaults",
    "--now", "2026-08-14T00:00:30.000Z",
    "--json"
  ]);
}

describe("onboarding never installs a convention that cannot enforce", () => {
  it("does not auto-accept a heuristic kind", async () => {
    const result = await onboardFullyConforming();
    expect(result.exitCode, result.stdout).toBe(0);
    const payload = JSON.parse(result.stdout);

    // Today: `api_route_requires_service_delegation` (heuristic_check) is accepted at warn.
    const acceptedKinds = payload.acceptance
      ? [
          payload.acceptance.convention_kind,
          ...payload.acceptance.also_accepted.map(
            (entry: { convention_kind: string }) => entry.convention_kind
          )
        ]
      : [];
    expect(acceptedKinds).not.toContain("api_route_requires_service_delegation");
  }, 120_000);

  it("prints no upgrade command that the tool itself rejects", async () => {
    const result = await onboardFullyConforming();
    const payload = JSON.parse(result.stdout);
    const upgrade: string | null = payload.acceptance?.upgrade_command ?? null;

    if (!upgrade) {
      // Nothing accepted, or nothing promotable: there is no command to fail.
      return;
    }

    // The command is printed as `drift ...`; run it through the same CLI with the same database.
    const argv = upgrade.split(/\s+/).slice(1);
    const executed = await runCli(["--db", payload.state.database_path, ...argv, "--json"]);

    // Today: exit 1, "Only deterministic conventions can use --mode block."
    expect(executed.exitCode, executed.stdout).toBe(0);
  }, 120_000);
});
