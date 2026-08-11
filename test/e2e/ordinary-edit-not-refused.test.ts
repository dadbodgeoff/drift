import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { cp, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

/**
 * EW-4. An ordinary edit must not be refused.
 *
 * Refusal rate is the single largest determinant of a stranger's first session. Each individual
 * refusal can be perfectly honest and the session still be a failure: a developer who makes eight
 * ordinary edits and is refused on three of them has learned that Drift does not work on their repo.
 *
 * Measured on cal.com at 40dcf44c: 4 of 8 ordinary edits refused. The cause turned out to be a single
 * parser gap - `export default prisma;` in `packages/prisma/index.ts` emitted no export fact, because
 * the extractor recognised default exports only when they wrapped a declaration. That produced 242
 * `unresolved_import_symbol` diagnostics against the data layer itself, so the unresolved symbol
 * landed on exactly the import each finding rests on, so each finding stayed withheld and the check
 * refused - on a comment-only edit.
 *
 * The fixture is that shape. The eval repos measure the rate; this measures the mechanism, and fails
 * in seconds with a named cause rather than as one repo's changed row.
 */

const REPO_ROOT = resolve(dirname(new URL(import.meta.url).pathname), "../..");
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const ROUTE = "apps/web/app/api/legacy/route.ts";

async function onboarded(): Promise<{
  run: (args: string[]) => { code: number; stdout: string };
  repoRoot: string;
}> {
  const repoRoot = await mkdtemp(join(tmpdir(), "drift-ordinary-repo-"));
  const home = await mkdtemp(join(tmpdir(), "drift-ordinary-home-"));
  dirs.push(repoRoot, home);
  await cp(join(REPO_ROOT, "test/fixtures/default-export-data-layer"), repoRoot, { recursive: true });

  const git = (...args: string[]) => execFileSync("git", args, { cwd: repoRoot, stdio: "ignore" });
  git("init", "-q");
  git("add", "-A");
  git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init");

  const cli = join(REPO_ROOT, "packages/cli/dist/main.js");
  const exec = (args: string[]) => {
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

  const started = exec(["start", "--repo-root", ".", "--accept-defaults", "--json"]);
  expect(started.code, started.stdout.slice(0, 600)).toBe(0);
  const repoId = JSON.parse(started.stdout).repo.id as string;
  const db = join(home, ".drift/repos", repoId, "drift.sqlite");
  return { repoRoot, run: (args) => exec(["--db", db, "--repo", repoId, ...args]) };
}

interface CheckPayload {
  check?: { status?: string };
  summary?: {
    partial_coverage?: { complete?: boolean };
    import_coverage?: { local_import_resolution_rate?: number | null };
  };
  findings?: Array<{ enforcement_result?: string; evidence_refs?: Array<{ file_path?: string }> }>;
}

describe("ordinary edits are not refused", () => {
  it("does not refuse a comment-only edit to a route that imports the data layer by default", async () => {
    const { run, repoRoot } = await onboarded();
    // The smallest possible edit, on the shape that used to refuse.
    appendFileSync(join(repoRoot, ROUTE), "\n// a comment\n");
    execFileSync("git", ["add", "-A"], { cwd: repoRoot, stdio: "ignore" });

    const result = run(["check", "--diff", "HEAD", "--scope", "changed-files", "--json"]);
    const payload = JSON.parse(result.stdout) as CheckPayload;

    expect(
      result.code,
      `a comment must not make Drift decline to answer: status ${payload.check?.status}`
    ).not.toBe(3);
    expect(payload.check?.status).not.toBe("refused");
    expect(
      payload.summary?.import_coverage?.local_import_resolution_rate,
      "the default import must resolve, which is the whole mechanism"
    ).toBe(1);
  }, 240_000);

  it("does not refuse a new properly layered route", async () => {
    const { run, repoRoot } = await onboarded();
    await mkdir(join(repoRoot, "apps/web/app/api/added"), { recursive: true });
    await writeFile(
      join(repoRoot, "apps/web/app/api/added/route.ts"),
      'import { widen } from "@acme/lib/constants";\n\n' +
        "export async function GET() {\n  return Response.json({ value: widen(\"new\") });\n}\n"
    );
    execFileSync("git", ["add", "-A"], { cwd: repoRoot, stdio: "ignore" });

    const result = run(["check", "--diff", "HEAD", "--scope", "changed-files", "--json"]);
    const payload = JSON.parse(result.stdout) as CheckPayload;

    expect(result.code, `unexpected refusal: ${result.stdout.slice(0, 400)}`).toBe(0);
    expect(payload.summary?.partial_coverage?.complete).toBe(true);
  }, 240_000);

  it("still blocks a real violation written through the default import", async () => {
    // The other half: not refusing must not mean not enforcing. A default import of the data layer is
    // a violation, and the resolver change is what makes it provable rather than merely suspected.
    const { run, repoRoot } = await onboarded();
    await mkdir(join(repoRoot, "apps/web/app/api/newbad"), { recursive: true });
    await writeFile(
      join(repoRoot, "apps/web/app/api/newbad/route.ts"),
      'import prisma from "@acme/prisma";\n\n' +
        "export async function GET() {\n  return Response.json(await prisma.user.findMany());\n}\n"
    );
    execFileSync("git", ["add", "-A"], { cwd: repoRoot, stdio: "ignore" });

    const result = run(["check", "--diff", "HEAD", "--scope", "changed-files", "--json"]);
    const payload = JSON.parse(result.stdout) as CheckPayload;

    const finding = (payload.findings ?? []).find((candidate) =>
      (candidate.evidence_refs?.[0]?.file_path ?? "").includes("newbad")
    );
    expect(finding, "a default import of the data layer is still a violation").toBeDefined();
    expect(finding?.enforcement_result).toBe("block");
    expect(result.code).toBe(2);
  }, 240_000);
});
