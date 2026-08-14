import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { runCli } from "../src/index.js";

/**
 * T-23 / B1: a repo that already follows its convention can still obtain a gate, by declaring it.
 *
 * `--data-modules` exists so an author can name the data layer inference could not. But
 * `declaredDataModulesCandidate` returned `undefined` unless at least one API route ALREADY
 * imported the declared module directly (`convention-candidates.ts:460`) - so the declaration only
 * produced a convention on a repo that was already violating it.
 *
 * A clean repo therefore had no path to enforcement at all: inference proposes nothing (there are
 * no direct imports to learn from), and declaring the module is ignored for the same reason. This
 * is the other half of "the gate doesn't gate by default" - after T-12 stopped onboarding from
 * installing a heuristic convention that can never block, a fully-conforming repo accepts nothing,
 * which is honest but leaves the best-behaved projects unprotected.
 *
 * The declaration IS the evidence. A human naming their data layer is a stronger signal than an
 * inference drawn from violations, and it is the one case where zero violations should not count
 * against the convention.
 */

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const DATA_MODULE = "@/lib/store/client";

function git(cwd: string, ...args: string[]): void {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

/** Every route delegates through a service; nothing touches the store directly. */
async function cleanRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "drift-t23-"));
  tempDirs.push(dir);
  const repoRoot = join(dir, "repo");

  await mkdir(join(repoRoot, "lib/store"), { recursive: true });
  await mkdir(join(repoRoot, "services"), { recursive: true });
  await writeFile(
    join(repoRoot, "lib/store/client.ts"),
    "export const store = { things: { findMany: async () => [] } };\n"
  );
  await writeFile(
    join(repoRoot, "services/things.ts"),
    [
      `import { store } from "${DATA_MODULE}";`,
      "export async function listThings() { return store.things.findMany(); }",
      ""
    ].join("\n")
  );
  for (let index = 0; index < 8; index += 1) {
    const path = join(repoRoot, `app/api/ok${index}`);
    await mkdir(path, { recursive: true });
    await writeFile(
      join(path, "route.ts"),
      [
        'import { listThings } from "@/services/things";',
        "export async function GET() {",
        "  return Response.json(await listThings());",
        "}",
        ""
      ].join("\n")
    );
  }
  await writeFile(
    join(repoRoot, "tsconfig.json"),
    JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@/*": ["./*"] } } })
  );
  await writeFile(join(repoRoot, "package.json"), '{"name":"t23","version":"1.0.0"}\n');
  git(repoRoot, "init", "-q");
  git(repoRoot, "add", "-A");
  execFileSync(
    "git",
    ["-c", "user.email=t23@drift.test", "-c", "user.name=t23", "commit", "-qm", "clean"],
    { cwd: repoRoot, stdio: "ignore" }
  );
  return repoRoot;
}

async function onboardDeclared(repoRoot: string) {
  const stateRoot = join(repoRoot, "..", "state");
  const started = await runCli([
    "start",
    "--repo-root", repoRoot,
    "--state-root", stateRoot,
    "--accept-defaults",
    "--data-modules", DATA_MODULE,
    "--now", "2026-08-14T00:00:30.000Z",
    "--json"
  ]);
  expect(started.exitCode, started.stdout).toBe(0);
  return JSON.parse(started.stdout);
}

describe("declaring a data layer arms a gate on a repo with nothing to fix", () => {
  it("accepts a data-access convention from the declaration alone", async () => {
    const repoRoot = await cleanRepo();

    const payload = await onboardDeclared(repoRoot);

    // Today: no candidate at all, because no route violates the declared module yet.
    const acceptedKinds = payload.acceptance
      ? [
          payload.acceptance.convention_kind,
          ...payload.acceptance.also_accepted.map(
            (entry: { convention_kind: string }) => entry.convention_kind
          )
        ]
      : [];
    expect(acceptedKinds).toContain("api_route_no_direct_data_access");
  }, 120_000);

  it("says the convention came from the author, not from inference", async () => {
    const repoRoot = await cleanRepo();

    const payload = await onboardDeclared(repoRoot);
    const declared = (payload.candidates ?? []).find(
      (candidate: { kind: string }) => candidate.kind === "api_route_no_direct_data_access"
    );

    expect(declared, "no data-access candidate was produced").toBeDefined();
    expect(declared.provenance).toBe("declared");
  }, 120_000);

  it("enforces against a route added afterwards", async () => {
    const repoRoot = await cleanRepo();
    const payload = await onboardDeclared(repoRoot);
    const db = payload.state.database_path;

    // The violation the declaration exists to catch.
    await mkdir(join(repoRoot, "app/api/direct"), { recursive: true });
    await writeFile(
      join(repoRoot, "app/api/direct/route.ts"),
      [
        `import { store } from "${DATA_MODULE}";`,
        "export async function GET() {",
        "  return Response.json(await store.things.findMany());",
        "}",
        ""
      ].join("\n")
    );
    git(repoRoot, "add", "-A");
    execFileSync(
      "git",
      ["-c", "user.email=t23@drift.test", "-c", "user.name=t23", "commit", "-qm", "direct"],
      { cwd: repoRoot, stdio: "ignore" }
    );
    await runCli(["--db", db, "scan", "--repo-root", repoRoot, "--json"]);

    const checked = await runCli([
      "--db", db, "check", "--repo", payload.repo.id, "--scope", "full", "--json"
    ]);
    const findings = (JSON.parse(checked.stdout).findings ?? []).filter(
      (finding: { evidence_refs: Array<{ file_path: string }> }) =>
        finding.evidence_refs[0]?.file_path === "app/api/direct/route.ts"
    );

    // Today: 0. The convention never existed, so the new route is unremarkable.
    expect(findings.length).toBe(1);
  }, 120_000);
});
