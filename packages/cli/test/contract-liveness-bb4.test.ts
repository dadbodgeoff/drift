import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { runCli } from "../src/index.js";

/**
 * BB-4: a forbidden import that resolves to nothing is a warning, not a silence.
 *
 * `forbiddenModuleFiles_` derives a forbidden module's identity from the repo's own resolved import
 * edges, falling back to specifier-string matching. That design is right - it is what closed the
 * `../../../lib/prisma` and barrel-re-export bypasses (T93) - but it fails silently: rename the data
 * module and update every import, as any refactor would, and the accepted convention matches nothing
 * forever while the check keeps reporting `pass`. The gate reports green with its trigger unplugged.
 *
 * The negative controls come first and are the harder half. This warning must not cry wolf: a healthy
 * repo, and a repo whose rule simply has no current violators, must both stay silent.
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
  'import { listUsers } from "@/lib/services/users";',
  "export async function GET() {",
  "  return Response.json(await listUsers());",
  "}",
  ""
].join("\n");

function git(cwd: string, ...args: string[]): void {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

async function fixture(options: { violatingRoutes: number; cleanRoutes: number }): Promise<{
  repoId: string;
  databasePath: string;
  repoRoot: string;
  conventionId: string;
}> {
  const dir = await mkdtemp(join(tmpdir(), "drift-bb4-"));
  tempDirs.push(dir);
  const repoRoot = join(dir, "repo");
  const stateRoot = join(dir, "state");

  await mkdir(join(repoRoot, "lib/services"), { recursive: true });
  await writeFile(join(repoRoot, "lib/prisma.ts"), "export const prisma = {} as never;\n");
  await writeFile(
    join(repoRoot, "lib/services/users.ts"),
    'import { prisma } from "@/lib/prisma";\nexport async function listUsers() { return prisma; }\n'
  );
  for (let index = 0; index < options.violatingRoutes; index += 1) {
    await mkdir(join(repoRoot, `app/api/bad${index}`), { recursive: true });
    await writeFile(join(repoRoot, `app/api/bad${index}/route.ts`), VIOLATING);
  }
  for (let index = 0; index < options.cleanRoutes; index += 1) {
    await mkdir(join(repoRoot, `app/api/good${index}`), { recursive: true });
    await writeFile(join(repoRoot, `app/api/good${index}/route.ts`), CLEAN);
  }
  await writeFile(
    join(repoRoot, "tsconfig.json"),
    JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@/*": ["./*"] } } })
  );
  git(repoRoot, "init", "-q");
  git(repoRoot, "add", "-A");
  execFileSync("git", ["-c", "user.email=bb4@drift.test", "-c", "user.name=bb4", "commit", "-qm", "fixture"], {
    cwd: repoRoot,
    stdio: "ignore"
  });

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
  expect(payload.accepted).toBeTruthy();
  return {
    repoId: payload.repo.id,
    databasePath: payload.state.database_path,
    repoRoot,
    conventionId: payload.accepted.id
  };
}

const check = (databasePath: string, repoId: string, ...extra: string[]) =>
  runCli(["--db", databasePath, "check", "--repo", repoId, "--scope", "full", "--json", ...extra]);

describe("BB-4 contract liveness", () => {
  describe("negative controls - this warning must not cry wolf", () => {
    it("stays silent on a healthy repo where the specifier resolves and violations exist", async () => {
      const { repoId, databasePath } = await fixture({ violatingRoutes: 1, cleanRoutes: 3 });
      const payload = JSON.parse((await check(databasePath, repoId)).stdout);

      expect(payload.summary.contract_staleness).toBeUndefined();
      expect(payload.summary.contract_staleness_warnings).toBeUndefined();
      expect(payload.findings.length).toBeGreaterThan(0);
    });

    it("stays silent when the specifier resolves but currently has zero violators", async () => {
      // Absence of violations is success, not staleness. `lib/services/users.ts` still imports the
      // forbidden module, so the specifier resolves - there is simply nothing to flag in scope.
      const { repoId, databasePath } = await fixture({ violatingRoutes: 0, cleanRoutes: 3 });
      const result = await check(databasePath, repoId);
      const payload = JSON.parse(result.stdout);

      expect(payload.summary.contract_staleness).toBeUndefined();
      expect(payload.findings).toEqual([]);
      expect(result.exitCode).toBe(0);
    });

    it("stays silent under --strict-contract too, when the contract is alive", async () => {
      const { repoId, databasePath } = await fixture({ violatingRoutes: 0, cleanRoutes: 3 });
      const result = await check(databasePath, repoId, "--strict-contract");
      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout).summary.contract_staleness).toBeUndefined();
    });
  });

  describe("the liveness probe", () => {
    /**
     * Rename the data module and rewrite **every** import, as any refactor would.
     *
     * Rewriting only some of them is a different repo state and a much less interesting one: the old
     * specifier still appears as a string, so the string-match fallback still fires and the contract
     * still flags things. The silent-death case requires the refactor to be complete, which is
     * exactly what makes it plausible.
     */
    async function renameDataLayer(repoRoot: string): Promise<void> {
      execFileSync("git", ["mv", "lib/prisma.ts", "lib/database.ts"], { cwd: repoRoot, stdio: "ignore" });
      await writeFile(
        join(repoRoot, "lib/services/users.ts"),
        'import { prisma } from "@/lib/database";\nexport async function listUsers() { return prisma; }\n'
      );
      // Every pre-existing violating route moves to the new specifier too.
      for (const entry of await readdir(join(repoRoot, "app/api"))) {
        if (!entry.startsWith("bad")) {
          continue;
        }
        await writeFile(
          join(repoRoot, "app/api", entry, "route.ts"),
          VIOLATING.replace("@/lib/prisma", "@/lib/database")
        );
      }
      // And a new route that reaches the *renamed* module directly - a real violation of the rule's
      // intent, which the stale contract cannot see.
      await mkdir(join(repoRoot, "app/api/renamed"), { recursive: true });
      await writeFile(
        join(repoRoot, "app/api/renamed/route.ts"),
        [
          'import { prisma } from "@/lib/database";',
          "export async function POST() {",
          "  return Response.json(await prisma.user.findMany());",
          "}",
          ""
        ].join("\n")
      );
      git(repoRoot, "add", "-A");
    }

    it("reports the dead specifier instead of a silent pass", async () => {
      const { repoId, databasePath, repoRoot, conventionId } = await fixture({
        violatingRoutes: 1,
        cleanRoutes: 3
      });
      await renameDataLayer(repoRoot);
      await runCli(["--db", databasePath, "scan", "--repo-root", repoRoot, "--json"]);

      const result = await check(databasePath, repoId);
      const payload = JSON.parse(result.stdout);

      // What the pre-BB-4 behaviour was, pinned as context: nothing is found, because the contract
      // names a module that no longer exists.
      expect(payload.findings).toEqual([]);

      // What must now be true.
      expect(payload.summary.contract_staleness).toEqual([
        {
          convention_id: conventionId,
          specifier: "@/lib/prisma",
          resolved_modules: 0,
          string_matches: 0,
          remediation: expect.stringContaining("drift conventions list")
        }
      ]);
      const warning = payload.summary.contract_staleness_warnings.join("\n");
      expect(warning).toContain("@/lib/prisma");
      expect(warning).toContain("no longer contains");
      expect(warning).toContain("enforces nothing");
    });

    it("does not change the exit code by itself", async () => {
      // A removed data layer is a legitimate refactor. Blocking it would be a false positive on a
      // repo that did nothing wrong.
      const { repoId, databasePath, repoRoot } = await fixture({ violatingRoutes: 1, cleanRoutes: 3 });
      await renameDataLayer(repoRoot);
      await runCli(["--db", databasePath, "scan", "--repo-root", repoRoot, "--json"]);

      const result = await check(databasePath, repoId);
      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout).check.status).toBe("pass");
    });

    it("refuses under --strict-contract", async () => {
      const { repoId, databasePath, repoRoot } = await fixture({ violatingRoutes: 1, cleanRoutes: 3 });
      await renameDataLayer(repoRoot);
      await runCli(["--db", databasePath, "scan", "--repo-root", repoRoot, "--json"]);

      const result = await check(databasePath, repoId, "--strict-contract");
      // 3 = fail-closed refusal: Drift will not claim this repo is clean using a rule that matches
      // nothing.
      expect(result.exitCode).toBe(3);
      expect(JSON.parse(result.stdout).summary.contract_staleness).toHaveLength(1);
    });

    it("names the dead specifier in the human output too", async () => {
      const { repoId, databasePath, repoRoot } = await fixture({ violatingRoutes: 1, cleanRoutes: 3 });
      await renameDataLayer(repoRoot);
      await runCli(["--db", databasePath, "scan", "--repo-root", repoRoot, "--json"]);

      const result = await runCli([
        "--db", databasePath, "check", "--repo", repoId, "--scope", "full"
      ]);
      expect(result.stdout).toContain("@/lib/prisma");
      expect(result.stdout).toContain("enforces nothing");
    });
  });
});
