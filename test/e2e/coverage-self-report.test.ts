import { execFileSync } from "node:child_process";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

/**
 * EW-3. Drift must say what it cannot see, before anyone trusts a verdict.
 *
 * Every measurement this project has comes from seven Next.js/TypeScript monorepos it chose itself.
 * Open beta means Remix, Nx, Vite, Deno - and every new repo shape encountered so far has exposed a
 * specific resolver gap. That cannot be pre-fixed. What it can do is report the gap as a number, in
 * the surface a stranger consults first, so a clean-looking check is never mistaken for full
 * coverage.
 *
 * The fixture is deliberately partial in two different ways, because the two must be reported
 * differently: one import that should resolve and does not (a gap, lowering the rate), and one
 * namespace import whose member-level resolution is conservative by design (a named limitation,
 * with remediation). A report that flattened those into one warning count would tell a stranger
 * "Drift is broken on my repo" when the truth is "Drift does not resolve this one construct".
 */

const REPO_ROOT = resolve(dirname(new URL(import.meta.url).pathname), "../..");
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

interface CoverageBucket {
  code: string;
  count: number;
  counts_as_parser_gap: boolean;
  limitation: string | null;
  by_directory: Array<{ directory: string; count: number }>;
  top_specifiers: Array<{ specifier: string; count: number }>;
}

interface CoverageReport {
  local_import_resolution_rate: number | null;
  resolved_local_imports: number;
  unresolved_local_imports: number;
  parser_gap_count: number;
  reconciles: boolean;
  by_code: CoverageBucket[];
}

async function onboarded(): Promise<{
  run: (args: string[]) => { code: number; stdout: string };
  repoRoot: string;
}> {
  const repoRoot = await mkdtemp(join(tmpdir(), "drift-coverage-repo-"));
  const home = await mkdtemp(join(tmpdir(), "drift-coverage-home-"));
  dirs.push(repoRoot, home);
  await cp(join(REPO_ROOT, "test/fixtures/coverage-report-repo"), repoRoot, { recursive: true });

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
    run: (args) => exec(args[0] === "doctor" ? args : ["--db", db, "--repo", repoId, ...args])
  };
}

describe("coverage self-report", () => {
  it("reports an import-resolution rate with a breakdown that reconciles", async () => {
    const { run } = await onboarded();

    const result = run(["doctor", "--repo-root", ".", "--json"]);
    const payload = JSON.parse(result.stdout) as { import_coverage?: CoverageReport };
    const coverage = payload.import_coverage;

    expect(coverage, "doctor must report coverage once a scan exists").toBeDefined();
    expect(
      coverage!.local_import_resolution_rate,
      "a rate, not a count: 'some imports did not resolve' is not something a stranger can judge"
    ).toBeGreaterThan(0);
    expect(coverage!.local_import_resolution_rate).toBeLessThan(1);
    expect(coverage!.resolved_local_imports).toBeGreaterThan(0);
    expect(coverage!.unresolved_local_imports).toBe(1);

    // The reconciliation requirement: a breakdown that does not add up is worse than none.
    expect(coverage!.reconciles).toBe(true);
    const bucketedGaps = coverage!.by_code
      .filter((bucket) => bucket.counts_as_parser_gap)
      .reduce((total, bucket) => total + bucket.count, 0);
    expect(bucketedGaps).toBe(coverage!.parser_gap_count);

    // Bucketed by code, by top-level directory, with the top offending specifiers.
    const unresolved = coverage!.by_code.find((bucket) => bucket.code === "unresolved_import");
    expect(unresolved).toBeDefined();
    expect(unresolved!.by_directory.map((entry) => entry.directory)).toContain("src");
    expect(unresolved!.top_specifiers.map((entry) => entry.specifier)).toContain(
      "@/lib/not-written-yet"
    );
  }, 240_000);

  it("names an unsupported shape as a limitation with remediation, not a generic warning", async () => {
    const { run } = await onboarded();

    const text = run(["doctor", "--repo-root", "."]).stdout;

    expect(text, "the limitation is named in the surface a stranger actually reads").toContain(
      "Known limitations on this repo:"
    );
    expect(text).toContain("unsupported_namespace_import_symbol");
    // Remediation, not just a label. A boundary a user can work around beats a warning they cannot.
    expect(text).toMatch(/Import the symbols you use by name/);
    expect(text, "and it says which specifier is affected").toContain("@acme/util");
  }, 240_000);

  it("carries the resolution rate in check output, so a verdict is never read without it", async () => {
    const { run } = await onboarded();

    const payload = JSON.parse(
      run(["check", "--diff", "HEAD", "--scope", "full", "--json"]).stdout
    ) as { summary?: { import_coverage?: CoverageReport } };
    const coverage = payload.summary?.import_coverage;

    expect(coverage, "the verdict and the coverage it rests on travel together").toBeDefined();
    expect(coverage!.local_import_resolution_rate).toBeGreaterThan(0);
    expect(coverage!.local_import_resolution_rate).toBeLessThan(1);
    expect(coverage!.reconciles).toBe(true);
  }, 240_000);
});
