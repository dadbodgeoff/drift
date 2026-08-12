import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { runCli } from "../src/index.js";

/**
 * A file the scan could not read must not be reported as a file the scan read.
 *
 * The scan already worked this out - `repo_completeness` counts skipped files and marks the repo
 * scope incomplete, and that verdict is persisted. The check never consulted it, so a repo with an
 * unreadable file answered `partial_coverage: {complete: true, reasons: []}` and exit 0.
 *
 * The second test is the one that decides the design, and it is here because it nearly went the
 * other way. The reason this reports is repo-wide, while the unresolved-import gaps beside it are
 * diff-scoped, so an obvious "refinement" is to report only skipped files that are themselves in
 * the enforced scope - quieter on repos carrying vendored bundles nothing imports. Measured against
 * this fixture, that refinement is a false negative generator: `lib/secret.ts` is not an API route
 * and would not be reported under it, and it is exactly the file that could be the data layer.
 *
 * The asymmetry is the whole argument. A coverage gap reported for a file nothing imports costs
 * attention. A gap NOT reported for a module a route imports costs the product its claim. Until the
 * reason is scoped by import-reachability rather than by path shape, repo-wide is the answer that
 * fails closed.
 */

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function git(cwd: string, ...args: string[]): void {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

/** Bytes that are not valid UTF-8, so the engine's read fails and the file is skipped. */
const UNREADABLE = Buffer.from([0x65, 0x78, 0x70, 0x6f, 0x72, 0x74, 0x0a, 0xff, 0xfe, 0xfd, 0x0a]);

async function fixture(options: { unreadableAt: string; route: string }): Promise<{
  repoId: string;
  databasePath: string;
}> {
  const dir = await mkdtemp(join(tmpdir(), "drift-coverage-gap-"));
  tempDirs.push(dir);
  const repoRoot = join(dir, "repo");
  const stateRoot = join(dir, "state");

  await mkdir(join(repoRoot, "app/api/reads"), { recursive: true });
  await mkdir(join(repoRoot, "lib"), { recursive: true });
  await writeFile(join(repoRoot, "package.json"), '{"name":"coverage-gap","version":"1.0.0"}\n');
  await writeFile(
    join(repoRoot, "tsconfig.json"),
    '{"compilerOptions":{"baseUrl":".","paths":{"@/*":["./*"]}}}\n'
  );
  await writeFile(join(repoRoot, "app/api/reads/route.ts"), options.route);
  const unreadablePath = join(repoRoot, options.unreadableAt);
  await mkdir(dirname(unreadablePath), { recursive: true });
  await writeFile(unreadablePath, UNREADABLE);

  git(repoRoot, "init");
  git(repoRoot, "add", "-A");
  git(repoRoot, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-m", "init");

  const started = await runCli([
    "start",
    "--repo-root", repoRoot,
    "--state-root", stateRoot,
    "--accept-defaults",
    "--json"
  ]);
  const repoId = JSON.parse(started.stdout).repo.id as string;
  return { repoId, databasePath: join(stateRoot, repoId, "drift.sqlite") };
}

const check = async (databasePath: string, repoId: string) =>
  JSON.parse(
    (await runCli(["--db", databasePath, "check", "--repo", repoId, "--scope", "full", "--json"]))
      .stdout
  );

describe("scan coverage gaps reach the check", () => {
  it("admits an unreadable API route instead of reporting complete coverage", async () => {
    const { repoId, databasePath } = await fixture({
      unreadableAt: "app/api/broken/route.ts",
      route: 'export async function GET() { return Response.json({ ok: true }); }\n'
    });

    const payload = await check(databasePath, repoId);

    expect(payload.summary.partial_coverage.complete).toBe(false);
    expect(payload.summary.partial_coverage.reasons.join(" ")).toContain("could not be read");
  });

  it("admits an unreadable module that an in-scope route imports", async () => {
    // Nothing else catches this one. The specifier still resolves by path, so it does not surface
    // as an unresolved import, and the file is not an API route so a scope-shaped filter would skip
    // it. Measured on main before the fix: `{"complete": true, "reasons": []}`.
    const { repoId, databasePath } = await fixture({
      unreadableAt: "lib/secret.ts",
      route: [
        'import { db } from "@/lib/secret";',
        "export async function GET() { return Response.json(db); }",
        ""
      ].join("\n")
    });

    const payload = await check(databasePath, repoId);

    expect(payload.summary.partial_coverage.complete).toBe(false);
    expect(payload.summary.partial_coverage.reasons.join(" ")).toContain("could not be read");
  });
});
