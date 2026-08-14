import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { runCli } from "../src/index.js";

/**
 * T-06: a finding's identity does not move when unrelated lines above it do.
 *
 * Three of the engine's six fingerprint producers put a LINE NUMBER in the identity:
 * the auth proof (`sink_line`), request validation and phase 6 (`finding_line`). Measured end to
 * end before the fix, by inserting a single comment line above an untouched handler:
 *
 *   BEFORE edit:  {"pre_existing": 13}
 *   AFTER  edit:  {"pre_existing": 12, "new": 1}
 *
 * The handler's code was byte-identical. Its line moved from 3 to 4, the fingerprint changed, and a
 * grandfathered violation came back as new - so an unrelated edit anywhere above a violation
 * un-baselines it and the next check fails on code nobody touched.
 *
 * The old line-bearing value is still emitted as a legacy fingerprint, so a baseline written by an
 * earlier version keeps matching. Verified across an actual engine upgrade by building both
 * binaries: a 13-row baseline written by the previous engine read 13/13 pre_existing under the new
 * one, with nothing rewritten in the database. That is what makes this a code change rather than a
 * data migration.
 *
 * The other three producers (presence, and both data-access paths) never carried a line and are
 * unaffected.
 */

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const WRAPPED = (wrapper: string) =>
  [
    `import { ${wrapper} } from "@/lib/auth";`,
    `export const POST = ${wrapper}(async () => {`,
    "  return Response.json({ ok: true });",
    "});",
    ""
  ].join("\n");

function git(cwd: string, ...args: string[]): void {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

function statusCounts(stdout: string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const finding of JSON.parse(stdout).findings ?? []) {
    counts[finding.status] = (counts[finding.status] ?? 0) + 1;
  }
  return counts;
}

describe("a finding keeps its identity when lines above it move", () => {
  it("does not un-baseline a handler because an unrelated line was inserted above it", async () => {
    const dir = await mkdtemp(join(tmpdir(), "drift-t06-fp-"));
    tempDirs.push(dir);
    const repoRoot = join(dir, "repo");
    const stateRoot = join(dir, "state");

    await mkdir(join(repoRoot, "lib"), { recursive: true });
    await writeFile(
      join(repoRoot, "lib/auth.ts"),
      [
        "export const withSession = (handler: unknown) => handler;",
        "export const withWorkspace = (handler: unknown) => handler;",
        ""
      ].join("\n")
    );
    for (let index = 0; index < 25; index += 1) {
      const path = join(repoRoot, `app/api/w${index}`);
      await mkdir(path, { recursive: true });
      await writeFile(join(path, "route.ts"), WRAPPED(index % 2 === 0 ? "withSession" : "withWorkspace"));
    }
    await mkdir(join(repoRoot, "app/api/naked"), { recursive: true });
    await writeFile(
      join(repoRoot, "app/api/naked/route.ts"),
      "export async function POST() { return Response.json({ ok: true }); }\n"
    );
    await writeFile(
      join(repoRoot, "tsconfig.json"),
      JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@/*": ["./*"] } } })
    );
    git(repoRoot, "init", "-q");
    git(repoRoot, "add", "-A");
    execFileSync(
      "git",
      ["-c", "user.email=t06@drift.test", "-c", "user.name=t06", "commit", "-qm", "fixture"],
      { cwd: repoRoot, stdio: "ignore" }
    );

    const started = await runCli([
      "start", "--repo-root", repoRoot, "--state-root", stateRoot,
      "--accept-defaults", "--now", "2026-08-14T00:00:30.000Z", "--json"
    ]);
    expect(started.exitCode, started.stdout).toBe(0);
    const { repo, state } = JSON.parse(started.stdout);
    const db = state.database_path;

    // The per-symbol auth candidate, which is the one enforced by the line-bearing proof path.
    // The presence FAMILY (required_calls > 1) takes a different producer that never had a line.
    const listed = JSON.parse(
      (await runCli([
        "--db", db, "conventions", "list", "--repo", repo.id,
        "--include-low-confidence", "--experimental-security", "--json"
      ])).stdout
    );
    const perSymbol = listed.candidates.find(
      (candidate: { kind: string; matcher: { required_calls?: string[] } }) =>
        candidate.kind === "api_route_requires_auth_helper" &&
        (candidate.matcher.required_calls ?? []).length === 1
    );
    expect(perSymbol, "no per-symbol auth candidate was proposed").toBeDefined();

    const accepted = await runCli([
      "--db", db, "conventions", "accept", perSymbol.id, "--repo", repo.id,
      "--mode", "warn", "--severity", "warning", "--experimental-security", "--confirm", "--json"
    ]);
    expect(accepted.exitCode, accepted.stdout).toBe(0);

    // Findings must exist before they can be baselined.
    await runCli(["--db", db, "check", "--repo", repo.id, "--scope", "full", "--json"]);
    const baselined = await runCli([
      "--db", db, "baseline", "create", "--repo", repo.id, "--from", "main", "--confirm", "--json"
    ]);
    expect(baselined.exitCode, baselined.stdout).toBe(0);

    const before = statusCounts(
      (await runCli(["--db", db, "check", "--repo", repo.id, "--scope", "full", "--json"])).stdout
    );
    expect(before.pre_existing).toBeGreaterThan(0);
    expect(before.new ?? 0).toBe(0);

    // The edit: one comment line above an otherwise untouched handler.
    await writeFile(
      join(repoRoot, "app/api/w1/route.ts"),
      `// unrelated comment added above the handler\n${WRAPPED("withWorkspace")}`
    );
    await runCli(["--db", db, "scan", "--repo-root", repoRoot, "--json"]);

    const after = statusCounts(
      (await runCli(["--db", db, "check", "--repo", repo.id, "--scope", "full", "--json"])).stdout
    );

    // Nothing about any violation changed, so nothing may become new.
    expect(after).toEqual(before);
  }, 180_000);
});
