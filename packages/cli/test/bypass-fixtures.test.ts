import { execFileSync } from "node:child_process";
import { mkdtemp, rm, cp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

/**
 * T100 / T93. The two enforcement bypasses, pinned end-to-end.
 *
 * Both fixtures deliberately contain a route that violates via the *alias* form, so inference
 * learns `@/lib/prisma` as the forbidden specifier. Without that the contract learns whatever
 * form the sneaky route happens to use and the fixture stops reproducing the bug it exists for -
 * which is exactly what the first version of these fixtures did, passing for the wrong reason.
 *
 * They also carry a tsconfig paths mapping. Without it the resolver produces almost no resolved
 * imports (one edge out of sixty-four on the scenario repo), and resolved-identity matching has
 * nothing to work with.
 */

// vitest runs with cwd at the package, so anchor on this file instead of the process cwd.
const REPO_ROOT = resolve(dirname(new URL(import.meta.url).pathname), "../../..");

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function detectsSneakyRoute(fixture: string): Promise<{ findings: number; sneaky: boolean }> {
  const repoRoot = await mkdtemp(join(tmpdir(), "drift-bypass-repo-"));
  const home = await mkdtemp(join(tmpdir(), "drift-bypass-home-"));
  dirs.push(repoRoot, home);
  await cp(join(REPO_ROOT, "test/fixtures", fixture), repoRoot, { recursive: true });

  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: repoRoot, stdio: "ignore" });
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
  const run = (args: string[]) =>
    execFileSync(process.execPath, [cli, ...args], {
      cwd: repoRoot,
      env,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024
    });

  run(["start", "--repo-root", ".", "--accept-defaults"]);
  const repoId = execFileSync("ls", [join(home, ".drift/repos")], { encoding: "utf8" }).trim();
  const payload = JSON.parse(
    run([
      "--db", join(home, ".drift/repos", repoId, "drift.sqlite"),
      "check", "--repo", repoId, "--diff", "HEAD", "--scope", "full", "--json"
    ])
  ) as { findings?: Array<{ evidence_refs?: Array<{ file_path?: string }> }> };

  const findings = payload.findings ?? [];
  return {
    findings: findings.length,
    sneaky: findings.some((f) => (f.evidence_refs?.[0]?.file_path ?? "").includes("sneaky"))
  };
}

describe("enforcement bypasses stay closed", () => {
  it("catches a relative import of the forbidden module", async () => {
    const result = await detectsSneakyRoute("bypass-relative-import");
    expect(result.sneaky, "`../../../lib/prisma` resolves to the forbidden file").toBe(true);
  }, 180_000);

  it("catches an import laundered through a re-export barrel", async () => {
    const result = await detectsSneakyRoute("bypass-barrel-reexport");
    expect(result.sneaky, "a barrel re-exporting the client is still the client").toBe(true);
  }, 180_000);
});
