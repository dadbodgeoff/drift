import { execFileSync } from "node:child_process";
import { cp, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

/**
 * EW-2. A complete finding must survive a sibling's unresolved import.
 *
 * S1-01 made incomplete coverage *honest*: a check that could not enforce refuses (exit 3) and
 * names the file that cost the coverage, instead of reporting a clean run. That was the important
 * fix and it stands. What remains is blast radius. The demotion is one boolean for the whole check
 * (`can_block` in check_command.rs), so a single unresolved import anywhere in the diff zeroes
 * *every* finding's enforcement - including violations whose own evidence is complete.
 *
 * Measured at 40dcf44c on taxonomy and openstatus, with no harness decoy involved:
 *
 *   import { db } from "@/lib/db";                  <- real violation, fully evidenced
 *   import { helper } from "@/lib/not-created-yet"; <- does not resolve
 *   -> exit 3, refused; the violation's enforcement_result is "none"
 *
 * The trigger states are ordinary editing: mid-refactor, a typo, an import written before the file
 * exists. So the fix is per-finding: uncertainty about *this* finding's evidence withholds it,
 * uncertainty elsewhere does not - and conflating the two is how the original kill-switch happened.
 *
 * Partial coverage is still reported in both cases. It has to be: a check that enforced some
 * findings and could not judge others has not run cleanly, and the exit code alone cannot say so
 * once a real block claims it (exit 2 wins over exit 3 - a refusal must never mask a violation
 * Drift did establish). The explicit signal is `summary.partial_coverage`, documented in
 * docs/reference/enforcement.md.
 */

const REPO_ROOT = resolve(dirname(new URL(import.meta.url).pathname), "../..");
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

/**
 * A fully evidenced violation and, beside it, an import of a module that does not exist. The
 * violation does not depend on the missing module in any way.
 */
const SIBLING = `import { prisma } from "@/lib/prisma";
import { helper } from "@/lib/not-created-yet";

export async function GET() {
  return Response.json(await prisma.user.findMany({ where: helper }));
}
`;

/**
 * The forbidden specifier is *itself* unresolvable. String matching still flags it, but the
 * resolver cannot show it reaches the data layer rather than a lookalike, so the finding's own
 * chain is uncertain and it must stay withheld.
 */
const OWN_CHAIN = `import { prisma } from "@/lib/prisma/not-a-real-subpath";

export async function GET() {
  return Response.json(await prisma.user.findMany());
}
`;

/** No violation at all - just an unresolved import, in its own file. */
const OTHER_FILE = `import { helper } from "@/lib/also-not-created-yet";

export async function GET() {
  return Response.json({ value: helper });
}
`;

const VIOLATING = `import { prisma } from "@/lib/prisma";

export async function GET() {
  return Response.json(await prisma.user.findMany());
}
`;

interface CheckPayload {
  findings?: Array<{
    enforcement_result?: string;
    evidence_refs?: Array<{ file_path?: string; import_source?: string }>;
  }>;
  summary?: {
    blocked_reasons?: string[];
    partial_coverage?: { complete?: boolean; reasons?: string[] };
  };
  check?: { status?: string; capability_completeness?: { can_block?: boolean } };
}

async function setup(): Promise<{
  run: (args: string[]) => { code: number; stdout: string };
  repoRoot: string;
}> {
  const repoRoot = await mkdtemp(join(tmpdir(), "drift-blast-repo-"));
  const home = await mkdtemp(join(tmpdir(), "drift-blast-home-"));
  dirs.push(repoRoot, home);
  await cp(join(REPO_ROOT, "test/fixtures/sibling-unresolved-import"), repoRoot, { recursive: true });

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

  return { repoRoot, run: (args) => exec(["--db", db, "--repo", repoId, ...args]) };
}

async function addRoute(repoRoot: string, name: string, source: string): Promise<void> {
  await mkdir(join(repoRoot, "src/app/api", name), { recursive: true });
  await writeFile(join(repoRoot, "src/app/api", name, "route.ts"), source);
  execFileSync("git", ["add", "-A"], { cwd: repoRoot, stdio: "ignore" });
}

function findingFor(payload: CheckPayload, route: string) {
  return (payload.findings ?? []).find((finding) =>
    (finding.evidence_refs?.[0]?.file_path ?? "").includes(`/${route}/`)
  );
}

describe("enforcement blast radius", () => {
  it("enforces a complete violation despite a sibling unresolved import in the same file", async () => {
    const { run, repoRoot } = await setup();
    await addRoute(repoRoot, "sibling", SIBLING);

    const result = run(["check", "--diff", "HEAD", "--scope", "changed-hunks", "--json"]);
    const payload = JSON.parse(result.stdout) as CheckPayload;

    const finding = findingFor(payload, "sibling");
    expect(finding, "the violation must be reported").toBeDefined();
    expect(
      finding?.enforcement_result,
      "the violation's own chain resolves; a missing module it does not depend on cannot " +
        "make that evidence uncertain"
    ).toBe("block");
    expect(finding?.evidence_refs?.[0]?.import_source).toBe("@/lib/prisma");
    expect(result.code, "a violation Drift established blocks").toBe(2);
  }, 240_000);

  it("reports the unresolved import as partial coverage rather than as grounds to withhold", async () => {
    const { run, repoRoot } = await setup();
    await addRoute(repoRoot, "sibling", SIBLING);

    const payload = JSON.parse(
      run(["check", "--diff", "HEAD", "--scope", "changed-hunks", "--json"]).stdout
    ) as CheckPayload;

    expect(
      payload.summary?.partial_coverage?.complete,
      "an unresolved import in the diff means Drift did not see everything, and the exit code " +
        "cannot carry that once a real block claims it"
    ).toBe(false);
    expect(
      (payload.summary?.partial_coverage?.reasons ?? []).join(" "),
      "an advisory a user cannot act on is barely better than silence"
    ).toMatch(/sibling/);
  }, 240_000);

  it("still withholds a finding when the unresolved import is in its own dependency chain", async () => {
    const { run, repoRoot } = await setup();
    await addRoute(repoRoot, "ownchain", OWN_CHAIN);

    const result = run(["check", "--diff", "HEAD", "--scope", "changed-hunks", "--json"]);
    const payload = JSON.parse(result.stdout) as CheckPayload;

    const finding = findingFor(payload, "ownchain");
    expect(finding, "the finding is still reported - withheld means unenforced, not hidden")
      .toBeDefined();
    expect(
      finding?.enforcement_result,
      "the forbidden specifier itself did not resolve, so Drift cannot show it reaches the " +
        "data layer rather than a lookalike; blocking on that would be a guess"
    ).toBe("none");
    expect(result.code, "nothing could be enforced and coverage is partial: refuse").toBe(3);
    expect(payload.check?.status).toBe("refused");
  }, 240_000);

  it("leaves a finding in one file unaffected by an unresolved import in another", async () => {
    const { run, repoRoot } = await setup();
    await addRoute(repoRoot, "newbad", VIOLATING);
    await addRoute(repoRoot, "otherfile", OTHER_FILE);

    const result = run(["check", "--diff", "HEAD", "--scope", "changed-hunks", "--json"]);
    const payload = JSON.parse(result.stdout) as CheckPayload;

    expect(findingFor(payload, "newbad")?.enforcement_result).toBe("block");
    expect(result.code).toBe(2);
    expect(
      payload.summary?.partial_coverage?.complete,
      "the other file is still reported as unseen"
    ).toBe(false);
  }, 240_000);
});
