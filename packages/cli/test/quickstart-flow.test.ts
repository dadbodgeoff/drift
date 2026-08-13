import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { runCli } from "../src/index.js";

/**
 * The documented quickstart has to run.
 *
 * `drift start --repo-root . --accept-defaults` succeeded and wrote state, and the very next
 * documented command answered:
 *
 *   Missing --db <path> or DRIFT_DB. Run drift --help.        (exit 1)
 *
 * ...while the database it needed sat exactly where the resolver would have looked. The default
 * path was derived only for `init|scan|start`, or when the user happened to pass `--repo-root` or
 * `--state-root` — neither of which the README's own `check` line includes. `prepare`, the
 * quickstart's "give an agent context" step, failed the same way with `missing_database`.
 *
 * This test runs the flow the way the docs write it, without the flags that were accidentally
 * load-bearing.
 */

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function git(cwd: string, ...args: string[]): void {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

describe("the documented quickstart resolves its own database", () => {
  it("runs start, then check and prepare, without --db or DRIFT_DB", async () => {
    const dir = await mkdtemp(join(tmpdir(), "drift-quickstart-"));
    tempDirs.push(dir);
    const repoRoot = join(dir, "repo");
    await mkdir(join(repoRoot, "app/api/users"), { recursive: true });
    await mkdir(join(repoRoot, "lib"), { recursive: true });
    await writeFile(join(repoRoot, "package.json"), '{"name":"quickstart","version":"1.0.0"}\n');
    await writeFile(
      join(repoRoot, "tsconfig.json"),
      '{"compilerOptions":{"baseUrl":".","paths":{"@/*":["./*"]}}}\n'
    );
    await writeFile(join(repoRoot, "lib/prisma.ts"), "export const prisma = {} as any;\n");
    await writeFile(
      join(repoRoot, "app/api/users/route.ts"),
      'import { prisma } from "@/lib/prisma";\nexport async function GET(){return Response.json(await prisma.user.findMany())}\n'
    );
    git(repoRoot, "init");
    git(repoRoot, "add", "-A");
    git(repoRoot, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-m", "init");

    // DRIFT_STATE_ROOT keeps the fixture off the developer's real ~/.drift. It is the right lever
    // rather than redirecting HOME, which would also move cargo's toolchain and break the engine.
    // Both steps then resolve the SAME default, which is the whole point: nothing below passes
    // --state-root, --repo-root or --db.
    const originalCwd = process.cwd();
    const originalStateRoot = process.env.DRIFT_STATE_ROOT;
    try {
      process.env.DRIFT_STATE_ROOT = join(dir, "state");
      process.chdir(repoRoot);

      // Step 1, as documented.
      const started = await runCli(["start", "--accept-defaults", "--json"]);
      expect(started.exitCode ?? 0).toBe(0);

      // Step 2: no --db, no DRIFT_DB, no --repo-root. On main this was
      // "Missing --db <path> or DRIFT_DB", exit 1.
      const checked = await runCli(["check", "--scope", "full", "--json"]);
      const payload = JSON.parse(checked.stdout);
      expect(payload.error?.message ?? "").not.toContain("Missing --db");
      expect(payload.findings.length).toBeGreaterThan(0);

      const prepared = await runCli(["prepare", "add an endpoint", "--json"]);
      expect(JSON.parse(prepared.stdout).response_schema).toBe("drift.task.preflight.v1");
    } finally {
      process.chdir(originalCwd);
      if (originalStateRoot === undefined) {
        delete process.env.DRIFT_STATE_ROOT;
      } else {
        process.env.DRIFT_STATE_ROOT = originalStateRoot;
      }
    }
  });
});
