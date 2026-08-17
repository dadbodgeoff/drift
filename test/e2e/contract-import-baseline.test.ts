import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * The documented CI order, and what it does to the baseline.
 *
 * `drift start` writes `baseline_violations` rows keyed on the convention ids it just derived
 * locally. `drift contract import` installs the imported contract wholesale
 * (`storage.upsertRepoContract({ ...contract, repo_id: expectedRepoId })`) and never touches
 * `baseline_violations`. Those two facts collide whenever the imported contract's convention ids
 * differ from the local ones - and they always do across two checkouts, because a convention id is
 * `hash(repo_id : kind : evidence)` and `repo_id` is `repo_${hash(absolute path)}`
 * (domain/identifiers.ts). T120 made the *portability check* path-independent by moving it to the
 * git remote and root commit; it did not make the storage key path-independent, and the convention
 * ids are still derived from the storage key.
 *
 * This file had no coverage before, and it was written from an audit's reasoning, so it establishes
 * every step against current code rather than assuming it. Two things the reading got wrong, both
 * found by mutating the source and watching these assertions NOT move:
 *
 *   - The operative call is not `deleteAcceptedConventionsExcept`. Removing it changes nothing
 *     here, because `check` reads its conventions from the repo contract
 *     (`storage.getRepoContract(repoId).conventions`, run-check.ts:379) and not from
 *     `accepted_conventions`. The delete is a companion effect on a second table.
 *   - The baseline is dead on BOTH of its keys, not just `convention_id`. `findingFingerprint()`
 *     hashes the convention id into the fingerprint (check/finding-fingerprint.ts:35-43), so a
 *     re-key moves the fingerprint too. Relaxing `isBaselinedFinding` to ignore `convention_id`
 *     does not rescue a single row - measured. Any fix therefore has to re-key or re-derive the
 *     baseline rows; it cannot be a more lenient match.
 *
 * The control arm exists for the same reason: without a `check` run BEFORE the import, "the
 * findings say new" proves nothing, because they might have said `new` all along.
 *
 * **Measured, on this fixture, at the sha in the commit that added this file:**
 *
 *   after `start`            2 baseline rows, 0 orphaned; `check` reports both findings
 *                            `pre_existing`, with `non_blocking_reasons`
 *                            `[{ pre_existing_baseline, count: 2 }]`
 *   after `contract import`  exit 0, `compatible: true`, `repo_fingerprint_matches: true`,
 *                            `repo_id_matches: false`, `removed_convention_count: 1`,
 *                            `added_convention_count: 1`
 *                            2 baseline rows, 2 orphaned; `check` reports the same two findings
 *                            `new`, and the `pre_existing_baseline` reason is gone
 *
 * **Is this intended? No.** A baseline exists to grandfather inherited debt so a team can adopt
 * enforcement without a repo-wide stop-the-world fix, and the only documented way for a second
 * environment to receive a contract is the step that destroys it. The failure is also quiet in the
 * place a CI job looks: the import reports its convention churn (`removed_convention_count: 1`) but
 * says nothing about the baseline, and the check's exit code is identical either side of the
 * import, so nothing in the pipeline's own output distinguishes the two states. What moves is the
 * classification - inherited debt is silently re-reported as work introduced by the change under
 * review - which on a PR touching a baselined file is a spurious block.
 *
 * **This test pins the behaviour; it does not fix it.** The fix is a design decision about who owns
 * baseline identity across a re-key, and the fingerprint finding above rules out the cheapest
 * option: a more forgiving match cannot work, so the live candidates are re-deriving the baseline
 * against the imported contract during the import, keying baseline rows on something that survives
 * a re-key, or refusing an import that would orphan an active baseline. That belongs to the owner of
 * `packages/cli/src/commands/contract.ts`. See the handoff note in the remediation report. When a
 * fix lands, the two `EXPECTED-TO-CHANGE` assertions below fail, and that is this file working:
 * they are written so the fix cannot land silently either.
 *
 * Mutation-proofed by revert: skipping the contract install in `contract import` flips both
 * `EXPECTED-TO-CHANGE` assertions (orphan count 1 -> 0, statuses `new` -> `pre_existing`) and leaves
 * the control and the import-succeeds assertions green.
 */

const REPO_ROOT = resolve(dirname(new URL(import.meta.url).pathname), "../..");
const CLI = join(REPO_ROOT, "packages/cli/dist/main.js");
const ENGINE = join(REPO_ROOT, "target/release/drift-engine");

const dirs: string[] = [];
afterAll(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@t",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@t"
    }
  }).trim();
}

interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

/** Every CLI call pins the engine binary, so a stray debug build cannot change what is measured. */
function drift(cwd: string, home: string, ...args: string[]): Run {
  try {
    return {
      code: 0,
      stdout: execFileSync(process.execPath, [CLI, ...args], {
        cwd,
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
        env: { ...process.env, HOME: home, DRIFT_HOME: home, DRIFT_ENGINE_BIN: ENGINE }
      }),
      stderr: ""
    };
  } catch (error) {
    const failure = error as { status?: number; stdout?: Buffer; stderr?: Buffer };
    return {
      code: failure.status ?? 1,
      stdout: failure.stdout?.toString() ?? "",
      stderr: failure.stderr?.toString() ?? ""
    };
  }
}

function json<T>(run: Run): T {
  try {
    return JSON.parse(run.stdout) as T;
  } catch {
    throw new Error(`expected JSON, got exit ${run.code}: ${run.stdout.slice(0, 600)}${run.stderr.slice(0, 600)}`);
  }
}

async function write(root: string, relative: string, body: string): Promise<void> {
  const full = join(root, relative);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, body);
}

/**
 * A repository with real history and two violating routes, so `start` has something to baseline.
 *
 * Three commits and a canonical remote, matching identity-round-trip.test.ts: identity is derived
 * from the remote and the root commit, so a one-commit repo with no remote would not exercise the
 * portable-identity path this whole scenario depends on.
 */
async function sourceRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "drift-import-baseline-src-"));
  dirs.push(dir);
  git(dir, "init", "-q");
  await write(dir, "package.json", JSON.stringify({ name: "import-baseline-fixture", private: true }));
  await write(
    dir,
    "tsconfig.json",
    JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@/*": ["src/*"] } } })
  );
  await write(
    dir,
    "src/lib/prisma.ts",
    "import { PrismaClient } from '@prisma/client';\nexport const prisma = new PrismaClient();\n"
  );
  await write(
    dir,
    "src/services/users.ts",
    "import { prisma } from '@/lib/prisma';\nexport async function listUsers() { return prisma.user.findMany(); }\n"
  );
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "one");

  for (const name of ["clean1", "clean2", "clean3"]) {
    await write(
      dir,
      `src/app/api/${name}/route.ts`,
      'import { listUsers } from "@/services/users";\n\nexport async function GET() {\n  return Response.json(await listUsers());\n}\n'
    );
  }
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "two");

  // The inherited debt. Two routes, so an assertion on the count cannot pass by coincidence.
  await write(
    dir,
    "src/app/api/legacy/route.ts",
    'import { prisma } from "@/lib/prisma";\n\nexport async function GET() {\n  return Response.json(await prisma.user.findMany());\n}\n'
  );
  await write(
    dir,
    "src/app/api/legacy2/route.ts",
    'import { prisma } from "@/lib/prisma";\n\nexport async function POST() {\n  return Response.json(await prisma.user.create({ data: {} }));\n}\n'
  );
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "three");
  git(dir, "remote", "add", "origin", "https://example.invalid/acme/import-baseline-fixture.git");
  return dir;
}

/** A checkout at a different absolute path, detached - the shape a CI runner has. */
async function checkout(source: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "drift-import-baseline-co-"));
  dirs.push(dir);
  execFileSync("git", ["clone", "-q", source, dir], { stdio: "ignore" });
  git(dir, "remote", "set-url", "origin", "https://example.invalid/acme/import-baseline-fixture.git");
  git(dir, "checkout", "-q", "--detach", git(dir, "rev-parse", "HEAD"));
  return dir;
}

async function freshHome(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), "drift-import-baseline-home-"));
  dirs.push(home);
  return home;
}

interface Finding {
  convention_id: string;
  status: string;
  evidence_refs?: Array<{ file_path?: string }>;
}
interface CheckPayload {
  findings?: Finding[];
  summary?: { outcome?: { non_blocking_reasons?: Array<{ reason: string; count: number }> } };
}
interface BaselinePayload {
  active_count: number;
  by_convention: Array<{ convention_id: string; active_count: number }>;
}
interface ImportPayload {
  imported?: boolean;
  removed_convention_count?: number;
  added_convention_count?: number;
  compatibility?: { compatible?: boolean; repo_id_matches?: boolean; repo_fingerprint_matches?: boolean };
}

/**
 * The conventions the check is actually enforcing, read from the findings it produced.
 *
 * Taken from the check rather than from `conventions list` deliberately: a baseline row is orphaned
 * when nothing the *enforcement path* uses shares its convention id, and the enforcement path is the
 * only witness that cannot disagree with itself.
 */
function enforcedConventions(payload: CheckPayload): Set<string> {
  return new Set((payload.findings ?? []).map((finding) => finding.convention_id));
}

interface Observed {
  ciCheckBefore: { run: Run; payload: CheckPayload };
  ciBaselineBefore: BaselinePayload;
  importRun: Run;
  importPayload: ImportPayload;
  ciCheckAfter: { run: Run; payload: CheckPayload };
  ciBaselineAfter: BaselinePayload;
}

let observed: Observed;

// One run of the whole flow, shared by every assertion: it clones twice, onboards twice and runs
// four checks, and repeating that per-`it` would triple the cost to re-measure the same state.
beforeAll(async () => {
  const source = await sourceRepo();

  // The author's checkout: onboard, then export the contract that gets committed.
  const author = await checkout(source);
  const authorHome = await freshHome();
  const authorStart = drift(author, authorHome, "start", "--repo-root", ".", "--accept-defaults", "--json");
  expect(authorStart.code, authorStart.stdout.slice(0, 600)).toBe(0);
  const authorRepoId = json<{ repo: { id: string } }>(authorStart).repo.id;
  const authorDb = join(authorHome, ".drift/repos", authorRepoId, "drift.sqlite");
  const contractPath = join(author, "drift.lock.json");
  const exported = drift(
    author, authorHome, "--db", authorDb,
    "contract", "export", "--repo", authorRepoId, "--output", contractPath, "--confirm", "--json"
  );
  expect(exported.code, exported.stdout.slice(0, 600)).toBe(0);

  // The CI checkout: a different absolute path, so a different repo_id and different convention ids.
  const ci = await checkout(source);
  writeFileSync(join(ci, "drift.lock.json"), readFileSync(contractPath, "utf8"));
  const ciHome = await freshHome();
  const ciStart = drift(ci, ciHome, "start", "--repo-root", ".", "--accept-defaults", "--json");
  expect(ciStart.code, ciStart.stdout.slice(0, 600)).toBe(0);
  const ciRepoId = json<{ repo: { id: string } }>(ciStart).repo.id;
  const ciDb = join(ciHome, ".drift/repos", ciRepoId, "drift.sqlite");
  expect(
    ciRepoId,
    "the two checkouts must derive different storage keys, or this scenario cannot arise at all"
  ).not.toBe(authorRepoId);

  const checkArgs = ["check", "--repo", ciRepoId, "--scope", "full", "--json"];
  const beforeRun = drift(ci, ciHome, "--db", ciDb, ...checkArgs);
  const beforeBaseline = json<BaselinePayload>(
    drift(ci, ciHome, "--db", ciDb, "baseline", "status", "--repo", ciRepoId, "--json")
  );

  const importRun = drift(
    ci, ciHome, "--db", ciDb,
    "contract", "import", join(ci, "drift.lock.json"), "--repo", ciRepoId, "--confirm", "--json"
  );

  const afterRun = drift(ci, ciHome, "--db", ciDb, ...checkArgs);
  const afterBaseline = json<BaselinePayload>(
    drift(ci, ciHome, "--db", ciDb, "baseline", "status", "--repo", ciRepoId, "--json")
  );

  observed = {
    ciCheckBefore: { run: beforeRun, payload: json<CheckPayload>(beforeRun) },
    ciBaselineBefore: beforeBaseline,
    importRun,
    importPayload: json<ImportPayload>(importRun),
    ciCheckAfter: { run: afterRun, payload: json<CheckPayload>(afterRun) },
    ciBaselineAfter: afterBaseline
  };
}, 600_000);

describe("contract import and the baseline start wrote", () => {
  it("establishes the control: before any import, both violations are grandfathered", () => {
    // Without this the rest proves nothing - findings reading `new` after the import is only
    // evidence if they read `pre_existing` before it.
    const findings = observed.ciCheckBefore.payload.findings ?? [];
    expect(findings).toHaveLength(2);
    expect(findings.map((finding) => finding.status).sort()).toEqual(["pre_existing", "pre_existing"]);
    expect(observed.ciCheckBefore.payload.summary?.outcome?.non_blocking_reasons).toContainEqual({
      reason: "pre_existing_baseline",
      count: 2
    });

    expect(observed.ciBaselineBefore.active_count).toBe(2);
    const orphaned = observed.ciBaselineBefore.by_convention.filter(
      (row) => !enforcedConventions(observed.ciCheckBefore.payload).has(row.convention_id)
    );
    expect(orphaned, "start's own baseline must key on the conventions start accepted").toEqual([]);
  });

  it("imports cleanly: the contract is portable and the import reports success", () => {
    expect(observed.importRun.code, observed.importRun.stdout.slice(0, 900)).toBe(0);
    expect(observed.importPayload.imported).toBe(true);
    expect(observed.importPayload.compatibility?.compatible).toBe(true);
    expect(
      observed.importPayload.compatibility?.repo_fingerprint_matches,
      "T120: two checkouts of one repository agree on the portable fingerprint"
    ).toBe(true);
    expect(
      observed.importPayload.compatibility?.repo_id_matches,
      "...and disagree on the path-derived storage key, which is what re-keys the conventions"
    ).toBe(false);
    expect(observed.importPayload.removed_convention_count).toBe(1);
    expect(observed.importPayload.added_convention_count).toBe(1);
  });

  it(
    "EXPECTED-TO-CHANGE: every baseline row is orphaned by the import, and the rows survive as debris",
    () => {
      // PINNED, NOT ENDORSED. `deleteAcceptedConventionsExcept` removes the local conventions; the
      // baseline rows keyed on them are neither re-keyed nor removed. If a fix re-keys or clears
      // them, this fails - deliberately, so the fix is recorded rather than absorbed.
      expect(
        observed.ciBaselineAfter.active_count,
        "the rows are not deleted; they are simply no longer reachable from any live convention"
      ).toBe(2);

      const live = enforcedConventions(observed.ciCheckAfter.payload);
      const orphaned = observed.ciBaselineAfter.by_convention.filter(
        (row) => !live.has(row.convention_id)
      );
      expect(orphaned).toHaveLength(1);
      expect(orphaned[0]?.active_count).toBe(2);

      // The convention the check now enforces is the imported one, and it is not the one the
      // baseline was written against.
      expect(live.size).toBe(1);
      expect(
        observed.ciBaselineAfter.by_convention.map((row) => row.convention_id),
        "the baseline still names the convention start derived, which no longer exists"
      ).not.toContain([...live][0]);
    }
  );

  it(
    "EXPECTED-TO-CHANGE: inherited debt is re-reported as new work, and nothing in the pipeline says so",
    () => {
      const findings = observed.ciCheckAfter.payload.findings ?? [];
      expect(findings).toHaveLength(2);
      expect(
        findings.map((finding) => finding.status).sort(),
        "the same two untouched legacy routes, reclassified from pre_existing to new"
      ).toEqual(["new", "new"]);
      expect(
        (findings[0]?.evidence_refs?.[0]?.file_path ?? "").startsWith("src/app/api/legacy"),
        "and they are the same files, not a different violation that happens to number two"
      ).toBe(true);

      expect(
        observed.ciCheckAfter.payload.summary?.outcome?.non_blocking_reasons ?? [],
        "the grandfathering reason is gone from the check's own explanation of itself"
      ).not.toContainEqual({ reason: "pre_existing_baseline", count: 2 });

      // The part that makes it a blind spot rather than a visible failure: a CI job branches on the
      // exit code, and the exit code is identical either side of the import.
      expect(observed.ciCheckAfter.run.code).toBe(observed.ciCheckBefore.run.code);
    }
  );
});
