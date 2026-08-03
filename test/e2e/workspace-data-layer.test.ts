import { execFileSync } from "node:child_process";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

/**
 * EW-5. A repo whose data layer Drift's naming heuristics cannot see must still work end to end.
 *
 * midday is in the evaluation suite for exactly one reason: its Supabase layer defeats the substring
 * whitelist in candidate inference (`prisma` / `database` / `db` / `data-access`). Without it, the
 * suite would pass whether or not structural discovery existed at all, because every other repo
 * names its data layer in that family. It is the cheapest proxy available for "does this work on a
 * repo we did not pick", which is precisely what open beta asks.
 *
 * Two mechanisms have to work, and they are separate:
 *
 *  1. **Discovery** must name the wrapper - reached from the declared `@supabase/supabase-js`
 *     dependency in package.json, not from any naming convention. That requires resolving the
 *     workspace package name to its directory *before* matching, because `@acme/supabase/server`
 *     and `packages/supabase/src/server.ts` share no path tail. Tail-matching alone cannot connect
 *     them, and a suggestion list that misses the wrapper leaves the user with nothing to declare.
 *  2. A violating route must then yield an **evidenced** finding. Discovery naming a module that
 *     goes on to produce nothing is a worse failure than not finding it, because it looks like it
 *     worked.
 *
 * Measured while writing this: both already hold, on this fixture and on midday itself (the
 * external-eval baseline records `discovery_named_data_layer: true` and two findings). The
 * workspace-directory resolution landed with the pnpm-workspace reader. This test exists because
 * neither half was pinned anywhere - the external suite measures midday, but a fixture is what
 * makes a regression fail in seconds with a named cause instead of as one repo's changed row.
 */

const REPO_ROOT = resolve(dirname(new URL(import.meta.url).pathname), "../..");
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const WRAPPER = "packages/supabase/src/server.ts";
const ROUTE = "apps/dashboard/src/app/api/teams/route.ts";
const SPECIFIER = "@acme/supabase/server";

interface Session {
  run: (args: string[]) => { code: number; stdout: string };
  db: (args: string[]) => { code: number; stdout: string };
}

async function fixtureRepo(): Promise<{ run: Session["run"]; home: string; repoRoot: string }> {
  const repoRoot = await mkdtemp(join(tmpdir(), "drift-workspace-layer-repo-"));
  const home = await mkdtemp(join(tmpdir(), "drift-workspace-layer-home-"));
  dirs.push(repoRoot, home);
  await cp(join(REPO_ROOT, "test/fixtures/workspace-supabase-layer"), repoRoot, { recursive: true });

  const git = (...args: string[]) => execFileSync("git", args, { cwd: repoRoot, stdio: "ignore" });
  git("init", "-q");
  git("add", "-A");
  git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init");

  const cli = join(REPO_ROOT, "packages/cli/dist/main.js");
  const run = (args: string[]) => {
    try {
      return {
        code: 0,
        stdout: execFileSync(process.execPath, [cli, ...args], {
          cwd: repoRoot,
          encoding: "utf8",
          maxBuffer: 64 * 1024 * 1024,
          env: {
            ...process.env,
            HOME: home,
            DRIFT_HOME: home,
            DRIFT_ENGINE_BIN: join(REPO_ROOT, "target/release/drift-engine")
          }
        })
      };
    } catch (error) {
      const failure = error as { status?: number; stdout?: string };
      return { code: failure.status ?? 1, stdout: failure.stdout ?? "" };
    }
  };
  return { run, home, repoRoot };
}

describe("workspace data layer", () => {
  it("names a wrapper whose package name shares no path tail with it", async () => {
    const { run } = await fixtureRepo();

    const started = run(["start", "--repo-root", ".", "--accept-defaults", "--json"]);
    expect(started.code, started.stdout.slice(0, 600)).toBe(0);
    const payload = JSON.parse(started.stdout) as {
      data_layer_discovery?: {
        inferred_data_access_convention?: boolean;
        declared_packages?: string[];
        reason?: string;
        suggestions?: Array<{ filePath: string; importedAs: string[]; routeImporterCount: number }>;
      };
    };
    const discovery = payload.data_layer_discovery;

    expect(
      discovery?.inferred_data_access_convention,
      "the whitelist must genuinely fail here, or this fixture proves nothing about discovery"
    ).toBe(false);
    expect(discovery?.declared_packages).toContain("@supabase/supabase-js");

    const suggestion = discovery?.suggestions?.find((entry) => entry.filePath === WRAPPER);
    expect(
      suggestion,
      `discovery must name ${WRAPPER}; reached from the declared dependency, not from its name`
    ).toBeDefined();
    expect(
      suggestion!.importedAs,
      "and it must say how routes refer to it, which is what the user then declares"
    ).toContain(SPECIFIER);
    expect(suggestion!.routeImporterCount).toBeGreaterThan(0);
  }, 240_000);

  it("yields an evidenced finding on the violating route once that module is declared", async () => {
    const { run, home } = await fixtureRepo();

    const started = run([
      "start", "--repo-root", ".", "--accept-defaults", "--data-modules", SPECIFIER, "--json"
    ]);
    expect(started.code, started.stdout.slice(0, 600)).toBe(0);
    const repoId = JSON.parse(started.stdout).repo.id as string;

    const checked = run([
      "--db", join(home, ".drift/repos", repoId, "drift.sqlite"),
      "check", "--repo", repoId, "--diff", "HEAD", "--scope", "full", "--json"
    ]);
    const payload = JSON.parse(checked.stdout) as {
      findings?: Array<{
        enforcement_result?: string;
        evidence_refs?: Array<{
          file_path?: string;
          start_line?: number;
          import_source?: string;
          symbol?: string;
        }>;
      }>;
      summary?: { import_coverage?: { local_import_resolution_rate?: number | null } };
    };

    const finding = (payload.findings ?? []).find(
      (candidate) => candidate.evidence_refs?.[0]?.file_path === ROUTE
    );
    expect(
      finding,
      "discovery naming a module that then produces nothing looks like success and is not"
    ).toBeDefined();

    // Evidenced, not merely counted: the file, the line, the specifier and the symbol.
    const evidence = finding!.evidence_refs![0];
    expect(evidence.import_source).toBe(SPECIFIER);
    expect(evidence.symbol).toBe("createClient");
    expect(evidence.start_line).toBeGreaterThan(0);
    expect(finding!.enforcement_result).toBe("block");

    // A repo Drift understands completely should say so, and this one it does: every local import
    // resolves. If this ever drops below 1 the finding above is resting on partial coverage.
    expect(payload.summary?.import_coverage?.local_import_resolution_rate).toBe(1);
  }, 240_000);
});
