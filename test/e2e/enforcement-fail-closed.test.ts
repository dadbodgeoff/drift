import { execFileSync } from "node:child_process";
import { cp, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

/**
 * S1-01. A violation that was found must never be reported as a clean run.
 *
 * Verified against this fixture at a48ac41, with no harness involved:
 *
 *   new violating route alone            exit 2, enforcement_result "block"
 *   same route + an adjacent namespace   exit 0, enforcement_result "none"
 *   import of a real workspace module
 *
 * The adjacent route contains no violation. The engine is conservative about member-level symbol
 * resolution for namespace imports, so it emits unsupported_namespace_import_symbol; that sets
 * can_block=false for the whole check (check_command.rs:37), which zeroes every finding's
 * enforcement_result (:276), which makes blockingCount 0, which the CLI reports as exit 0.
 *
 * The engine's demotion is contract-mandated. Reporting *pass* is not, and that is what this pins.
 */

const REPO_ROOT = resolve(dirname(new URL(import.meta.url).pathname), "../..");
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

/** A namespace import of a real workspace package, used at runtime. No violation in it. */
const ADJACENT = `import * as util from "@acme/util";

export async function GET() {
  return Response.json({ value: util.helper(1) });
}
`;

const VIOLATING = `import { prisma } from "@/lib/prisma";

export async function GET() {
  return Response.json(await prisma.user.findMany());
}
`;

async function setup(): Promise<{ run: (args: string[]) => { code: number; stdout: string }; repoRoot: string }> {
  const repoRoot = await mkdtemp(join(tmpdir(), "drift-failclosed-repo-"));
  const home = await mkdtemp(join(tmpdir(), "drift-failclosed-home-"));
  dirs.push(repoRoot, home);
  await cp(join(REPO_ROOT, "test/fixtures/enforcement-gate-adjacent"), repoRoot, { recursive: true });

  const git = (...args: string[]) => execFileSync("git", args, { cwd: repoRoot, stdio: "ignore" });
  git("init", "-q");
  git("add", "-A");
  git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init");

  const env = {
    ...process.env,
    HOME: home,
    DRIFT_HOME: home,
    DRIFT_ENGINE_BIN: join(REPO_ROOT, "target/release/drift-engine")
  };
  const cli = join(REPO_ROOT, "packages/cli/dist/main.js");
  const exec = (args: string[]) => {
    try {
      return {
        code: 0,
        stdout: execFileSync(process.execPath, [cli, ...args], {
          cwd: repoRoot,
          env,
          encoding: "utf8",
          maxBuffer: 64 * 1024 * 1024
        })
      };
    } catch (error) {
      const failure = error as { status?: number; stdout?: string };
      return { code: failure.status ?? 1, stdout: failure.stdout ?? "" };
    }
  };

  exec(["start", "--repo-root", ".", "--accept-defaults"]);
  const repoId = execFileSync("ls", [join(home, ".drift/repos")], { encoding: "utf8" }).trim();
  const db = join(home, ".drift/repos", repoId, "drift.sqlite");

  return {
    repoRoot,
    run: (args: string[]) => exec(["--db", db, "--repo", repoId, ...args])
  };
}

async function addRoute(repoRoot: string, name: string, source: string): Promise<void> {
  await mkdir(join(repoRoot, "src/app/api", name), { recursive: true });
  await writeFile(join(repoRoot, "src/app/api", name, "route.ts"), source);
  execFileSync("git", ["add", "-A"], { cwd: repoRoot, stdio: "ignore" });
}

describe("enforcement fails closed", () => {
  it("blocks a new violation when coverage is complete", async () => {
    const { run, repoRoot } = await setup();
    // Only the violation is in the diff, so coverage is complete. Control against over-refusal.
    await addRoute(repoRoot, "newbad", VIOLATING);

    const result = run(["check", "--diff", "HEAD", "--scope", "changed-hunks", "--json"]);
    expect(result.code, result.stdout.slice(0, 400)).toBe(2);
  }, 240_000);

  it("refuses rather than passing when an adjacent route degrades coverage", async () => {
    const { run, repoRoot } = await setup();
    // Both in the diff: the gate only considers route files in the checked scope, so a committed
    // adjacent route would not trigger it. This is the PR-touches-two-files case.
    await addRoute(repoRoot, "newbad", VIOLATING);
    await addRoute(repoRoot, "adjacent", ADJACENT);

    const result = run(["check", "--diff", "HEAD", "--scope", "changed-hunks", "--json"]);
    const payload = JSON.parse(result.stdout) as {
      findings?: unknown[];
      summary?: { blocked_reasons?: string[] };
    };

    // The whole point: not 0.
    expect(result.code, `expected refusal, got ${result.code}`).toBe(3);
    // A refusal must not hide what was found.
    expect(payload.findings?.length ?? 0).toBeGreaterThan(0);
    // And it must say which file cost us the coverage, or it is not actionable.
    const reasons = (payload.summary?.blocked_reasons ?? []).join(" ");
    expect(reasons).toMatch(/adjacent/);
  }, 240_000);
});
