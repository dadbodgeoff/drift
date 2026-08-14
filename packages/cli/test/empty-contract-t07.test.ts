import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { runCli } from "../src/index.js";

/**
 * T-07: a contract with no accepted conventions cannot report a pass.
 *
 * `requiredRepoContract()` throws only when the contract ROW is missing, and `start` writes a row
 * even when it accepts nothing. So a repo with zero accepted conventions produced output
 * indistinguishable from a genuinely enforced clean run: exit 0, no findings, no error.
 *
 * Measured on a fully-conforming repo after T-12 stopped auto-accepting non-blockable kinds:
 *
 *   accepted: NOTHING | contract_ready: true | candidates: 1
 *   contract rows: 1 | accepted_conventions: 0
 *   new route importing the data layer directly -> CHECK EXIT=0, 0 findings, no error
 *
 * Two lies in one onboarding: `contract_ready: true` when nothing is enforceable, and a clean
 * verdict on a real violation. The plan named the second; the first is what tells the user to
 * stop paying attention.
 *
 * T-12 widened who lands here. Before it, a fully-conforming repo auto-accepted a heuristic
 * convention, so a contract always had something in it. Declining to accept something that cannot
 * enforce is right, and it makes closing this path mandatory rather than optional.
 *
 * A refusal is not a failure: exit 3 says no enforcement claim is being made, which is the honest
 * answer and is distinct from 1 (Drift broke) and 2 (the diff violates the contract).
 */

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function git(cwd: string, ...args: string[]): void {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

/** Fully conforming, so onboarding accepts nothing and leaves an empty contract. */
async function onboardWithEmptyContract(): Promise<{
  repoRoot: string;
  databasePath: string;
  repoId: string;
  startStdout: string;
}> {
  const dir = await mkdtemp(join(tmpdir(), "drift-t07-"));
  tempDirs.push(dir);
  const repoRoot = join(dir, "repo");

  await mkdir(join(repoRoot, "lib/store"), { recursive: true });
  await mkdir(join(repoRoot, "services"), { recursive: true });
  await writeFile(
    join(repoRoot, "lib/store/client.ts"),
    "export const store = { things: { findMany: async () => [] } };\n"
  );
  await writeFile(
    join(repoRoot, "services/things.ts"),
    [
      'import { store } from "@/lib/store/client";',
      "export async function listThings() { return store.things.findMany(); }",
      ""
    ].join("\n")
  );
  for (let index = 0; index < 8; index += 1) {
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
  await writeFile(join(repoRoot, "package.json"), '{"name":"t07","version":"1.0.0"}\n');
  git(repoRoot, "init", "-q");
  git(repoRoot, "add", "-A");
  execFileSync(
    "git",
    ["-c", "user.email=t07@drift.test", "-c", "user.name=t07", "commit", "-qm", "clean"],
    { cwd: repoRoot, stdio: "ignore" }
  );

  const started = await runCli([
    "start",
    "--repo-root", repoRoot,
    "--state-root", join(dir, "state"),
    "--accept-defaults",
    "--now", "2026-08-14T00:00:30.000Z",
    "--json"
  ]);
  expect(started.exitCode, started.stdout).toBe(0);
  const payload = JSON.parse(started.stdout);
  // The state this item is about. If something WAS accepted the fixture is not exercising it.
  expect(payload.acceptance, "fixture accepted a convention; nothing to test").toBeUndefined();

  return {
    repoRoot,
    databasePath: payload.state.database_path,
    repoId: payload.repo.id,
    startStdout: started.stdout
  };
}

async function addViolatingRoute(repoRoot: string, databasePath: string): Promise<void> {
  await mkdir(join(repoRoot, "app/api/direct"), { recursive: true });
  await writeFile(
    join(repoRoot, "app/api/direct/route.ts"),
    [
      'import { store } from "@/lib/store/client";',
      "export async function GET() {",
      "  return Response.json(await store.things.findMany());",
      "}",
      ""
    ].join("\n")
  );
  git(repoRoot, "add", "-A");
  execFileSync(
    "git",
    ["-c", "user.email=t07@drift.test", "-c", "user.name=t07", "commit", "-qm", "direct"],
    { cwd: repoRoot, stdio: "ignore" }
  );
  await runCli(["--db", databasePath, "scan", "--repo-root", repoRoot, "--json"]);
}

describe("an empty contract cannot report a pass", () => {
  it("refuses the check instead of reporting a clean run", async () => {
    const { repoRoot, databasePath, repoId } = await onboardWithEmptyContract();
    await addViolatingRoute(repoRoot, databasePath);

    const checked = await runCli([
      "--db", databasePath, "check", "--repo", repoId,
      "--diff", "HEAD~1...HEAD", "--scope", "changed-hunks", "--json"
    ]);

    // Today: exit 0, no findings, no error - identical to a genuinely enforced clean run.
    expect(checked.exitCode).toBe(3);
    expect(JSON.parse(checked.stdout).error.code).toBe("empty_contract");
  }, 120_000);

  it("names how many candidates are waiting and what to run", async () => {
    const { repoRoot, databasePath, repoId } = await onboardWithEmptyContract();
    await addViolatingRoute(repoRoot, databasePath);

    const checked = await runCli([
      "--db", databasePath, "check", "--repo", repoId,
      "--diff", "HEAD~1...HEAD", "--scope", "changed-hunks", "--json"
    ]);
    const payload = JSON.parse(checked.stdout);

    // A refusal a user cannot act on is only marginally better than a false pass.
    expect(payload.failure.user_action).toBeTruthy();
    expect(payload.failure.recovery_commands.length).toBeGreaterThan(0);
    expect(payload.failure.recovery_commands.join(" ")).toContain("conventions");
  }, 120_000);

  it("does not claim the contract is ready when nothing is enforceable", async () => {
    const { startStdout } = await onboardWithEmptyContract();

    // Today: contract_ready is true with zero accepted conventions.
    expect(JSON.parse(startStdout).onboarding.contract_ready).toBe(false);
  }, 120_000);

  it("says at onboarding that check will refuse until something is accepted", async () => {
    const { repoRoot } = await onboardWithEmptyContract();
    const dir = await mkdtemp(join(tmpdir(), "drift-t07-text-"));
    tempDirs.push(dir);

    const text = (await runCli([
      "start", "--repo-root", repoRoot, "--state-root", join(dir, "state"),
      "--accept-defaults", "--now", "2026-08-14T00:00:30.000Z"
    ])).stdout;

    expect(text.toLowerCase()).toContain("refuse");
  }, 120_000);
});
