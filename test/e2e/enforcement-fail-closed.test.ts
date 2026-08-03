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
 * resolution for namespace imports, so it emits unsupported_namespace_import_symbol; that set
 * can_block=false for the whole check, which zeroed every finding's enforcement_result, which
 * made blockingCount 0, which the CLI reported as exit 0.
 *
 * The engine's demotion is contract-mandated. Reporting *pass* is not, and that is what this pins.
 *
 * ---
 *
 * EW-2 narrowed the demotion from check-wide to per-finding, and the adjacent-route scenario now
 * lands on **exit 2, not 3**. That is a deliberate change to this file's second case, so it is
 * worth being precise about what did and did not move.
 *
 * The S1-01 guarantee is unchanged and is what both cases below still assert: a violation Drift
 * found is never reported as a clean run. What changed is *which* non-clean answer the
 * adjacent-route shape gets. The adjacent route's namespace conservatism is about the adjacent
 * route's import; the violation in `newbad` resolves completely and does not depend on it. Drift
 * established that violation, so it blocks it - exit 2, which has always outranked exit 3
 * precisely so that a refusal cannot mask a violation Drift did manage to establish.
 *
 * The coverage gap is still reported, because the run genuinely did not see everything: the
 * whole-run verdict `capability_completeness.can_block` is still false, and the file that cost
 * the coverage is still named - now under `summary.partial_coverage`, which exists because the
 * exit code can no longer carry that meaning once a real block claims it.
 *
 * The refusal path is not lost, and the third case below pins it: when the violation's *own*
 * dependency chain is what could not be resolved, the finding is withheld and the check still
 * refuses with exit 3. That was always the case S1-01 was really about; the adjacent-route shape
 * was collateral.
 */

const REPO_ROOT = resolve(dirname(new URL(import.meta.url).pathname), "../..");
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

/**
 * A namespace import of a real workspace package whose binding is never used. No violation
 * in it. E-5 (S1-05) made VALUE-USED namespace imports runtime-provable - they no longer
 * degrade coverage - so the degradation scenario this file pins now needs a binding with no
 * usage evidence at all, which stays conservative by design (the unused-binding pin lives in
 * crates/drift-engine/tests/runtime_provable_imports.rs).
 */
const ADJACENT = `import * as util from "@acme/util";

export async function GET() {
  return Response.json({ value: 1 });
}
`;

const VIOLATING = `import { prisma } from "@/lib/prisma";

export async function GET() {
  return Response.json(await prisma.user.findMany());
}
`;

/**
 * The forbidden specifier itself is unresolvable - a subpath of the data layer that does not
 * exist. The matcher still flags it by string, so a finding exists; the resolver cannot place it,
 * so the finding's own chain is uncertain and it must stay withheld.
 */
const UNRESOLVED_OWN_CHAIN = `import { prisma } from "@/lib/prisma/not-a-real-subpath";

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
    // E-1 (S1-02): the payload's status must agree with the exit code.
    const payload = JSON.parse(result.stdout) as { check?: { status?: string } };
    expect(payload.check?.status).toBe("fail");
  }, 240_000);

  it("blocks the violation and reports the coverage gap when an adjacent route degrades coverage", async () => {
    const { run, repoRoot } = await setup();
    // Both in the diff: the gate only considers route files in the checked scope, so a committed
    // adjacent route would not trigger it. This is the PR-touches-two-files case.
    await addRoute(repoRoot, "newbad", VIOLATING);
    await addRoute(repoRoot, "adjacent", ADJACENT);

    const result = run(["check", "--diff", "HEAD", "--scope", "changed-hunks", "--json"]);
    const payload = JSON.parse(result.stdout) as {
      findings?: Array<{ enforcement_result?: string }>;
      summary?: {
        blocked_reasons?: string[];
        partial_coverage?: { complete?: boolean; reasons?: string[] };
      };
      check?: { status?: string; capability_completeness?: { can_block?: boolean } };
    };

    // The whole point, unchanged since a48ac41: not 0.
    expect(result.code, `expected a non-clean answer, got ${result.code}`).not.toBe(0);
    // EW-2: and specifically not a refusal either, because the violation itself is established.
    expect(result.code, "an established violation blocks; adjacency cannot demote it").toBe(2);
    expect(payload.findings?.length ?? 0).toBeGreaterThan(0);
    expect(payload.findings?.[0]?.enforcement_result).toBe("block");
    // It must still say which file cost us the coverage, or it is not actionable. This moved from
    // blocked_reasons (which now means "why enforcement was withheld", and nothing was) to
    // partial_coverage (which means "what Drift could not see").
    expect((payload.summary?.partial_coverage?.reasons ?? []).join(" ")).toMatch(/adjacent/);
    expect(payload.summary?.partial_coverage?.complete).toBe(false);
    // E-1 (S1-02 / B-3): the exit code and the JSON must agree. The payload once read
    // `status: "pass"`, `can_block: true` on this exact shape.
    expect(payload.check?.status, "a blocking check records status fail").toBe("fail");
    expect(
      payload.check?.capability_completeness?.can_block,
      "the whole-run verdict is unchanged: a run with a coverage gap did not see everything, " +
        "even though it could enforce the finding it did establish"
    ).toBe(false);
  }, 240_000);

  it("still refuses when the violation's own dependency chain is what could not be resolved", async () => {
    const { run, repoRoot } = await setup();
    // The forbidden specifier itself does not resolve. String matching still flags it, but the
    // resolver cannot show it reaches the data layer rather than a lookalike - so the finding's
    // own evidence is uncertain, it is withheld, and with nothing enforceable the check refuses.
    // This is the S1-01 refusal path, kept alive after EW-2 narrowed the blast radius.
    await addRoute(repoRoot, "ownchain", UNRESOLVED_OWN_CHAIN);

    const result = run(["check", "--diff", "HEAD", "--scope", "changed-hunks", "--json"]);
    const payload = JSON.parse(result.stdout) as {
      findings?: Array<{ enforcement_result?: string }>;
      summary?: { blocked_reasons?: string[] };
      check?: { status?: string };
    };

    expect(result.code, `expected refusal, got ${result.code}`).toBe(3);
    expect(payload.check?.status).toBe("refused");
    // Withheld means unenforced, not hidden.
    expect(payload.findings?.length ?? 0).toBeGreaterThan(0);
    expect(payload.findings?.[0]?.enforcement_result).toBe("none");
    expect((payload.summary?.blocked_reasons ?? []).join(" ")).toMatch(/ownchain/);
  }, 240_000);
});
