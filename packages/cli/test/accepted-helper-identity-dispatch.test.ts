import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * B1: the field has to arrive on a run that actually happens.
 *
 * `accepted_helper_module_files` was wired into `runEngineOwnedDirectDataAccessCheck`, whose loop
 * evaluates exactly one kind - `api_route_no_direct_data_access`, which is not a security contract
 * and carries no `requires` helper block at all. The twelve kinds that DO carry `auth_helpers`,
 * `csrf_helpers`, `rate_limit_helpers`, `outbound_url_allowlist_helpers`, `response_serializers`
 * and `validators` are dispatched from `runEngineOwnedAuthCheck`, which never passed the field. So
 * on every real run the field was computed for a convention that has no helpers, and never computed
 * for the conventions that do.
 *
 * The unit test in `engine-bridge.test.ts` could not see this: it hands
 * `acceptedHelperModuleFiles` to `engineCheckRequest` directly, on kind
 * `api_route_requires_auth_helper` - the exact kind that in production never received it. It tests
 * the last inch of pipe while the upstream is disconnected.
 *
 * So this test refuses to call `engineCheckRequest`. It onboards a real repo, accepts a real auth
 * convention, runs the real `check` command through the real dispatch loop, and reads the JSON that
 * actually crossed the process boundary to the engine. Nothing about the assertion can be satisfied
 * by a caller that never runs.
 */

const engineInputs: string[] = [];

// Intercept only the transport, and only to record. `check-repo` payloads are captured and then
// handed to the real engine, so this stays an end-to-end run rather than a simulation of one -
// scan, candidate inference and the check itself all execute against the real binary.
vi.mock("../src/engine/rust-engine.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/engine/rust-engine.js")>();
  return {
    ...actual,
    runRustEngineWithInput: async (args: string[], input: string) => {
      if (args.includes("check-repo")) {
        engineInputs.push(input);
      }
      return actual.runRustEngineWithInput(args, input);
    }
  };
});

const { runCli } = await import("../src/index.js");

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  engineInputs.length = 0;
});

const TEST_TIMEOUT_MS = 120_000;

function git(cwd: string, ...args: string[]): void {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

/**
 * A repo where the accepted helper genuinely resolves: `@/lib/auth` is a tsconfig alias onto
 * `lib/auth.ts`, and the routes reach it by two different spellings so the resolved identity is the
 * only thing that unifies them.
 */
async function onboard(): Promise<{ repoId: string; databasePath: string }> {
  const dir = await mkdtemp(join(tmpdir(), "drift-b1-"));
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
  for (const [path, wrapper, specifier] of [
    ["app/api/a/route.ts", "withSession", "@/lib/auth"],
    ["app/api/b/route.ts", "withSession", "@/lib/auth"],
    ["app/api/c/route.ts", "withWorkspace", "@/lib/auth"],
    // The same module by a relative path. Tier 1 calls this a different helper; resolution does not.
    ["app/api/d/route.ts", "withWorkspace", "../../../lib/auth"]
  ] as const) {
    await mkdir(join(repoRoot, path, ".."), { recursive: true });
    await writeFile(
      join(repoRoot, path),
      [
        `import { ${wrapper} } from "${specifier}";`,
        `export const POST = ${wrapper}(async () => {`,
        "  return Response.json({ ok: true });",
        "});",
        ""
      ].join("\n")
    );
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
    ["-c", "user.email=b1@drift.test", "-c", "user.name=b1", "commit", "-qm", "fixture"],
    { cwd: repoRoot, stdio: "ignore" }
  );

  const started = await runCli([
    "start",
    "--repo-root", repoRoot,
    "--state-root", stateRoot,
    "--accept-defaults",
    "--now", "2026-08-04T00:00:30.000Z",
    "--json"
  ]);
  expect(started.exitCode).toBe(0);
  const payload = JSON.parse(started.stdout);
  return { repoId: payload.repo.id, databasePath: payload.state.database_path };
}

/** Every convention as it was actually sent to the engine, across every check-repo call. */
function sentConventions(): Array<{ kind: string; matcher: Record<string, unknown> }> {
  return engineInputs.flatMap((input) => JSON.parse(input).contract.conventions);
}

describe("accepted helper identity reaches the engine on a real run", () => {
  it("arrives in the request built by the auth dispatch loop, for a convention that has helpers", async () => {
    const { repoId, databasePath } = await onboard();

    const { openDriftStorage } = await import("@drift/storage");
    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    const contract = storage.getRepoContract(repoId)!;
    storage.upsertAcceptedConvention(repoId, {
      id: "convention_auth_helper_b1",
      contract_id: contract.id,
      kind: "api_route_requires_auth_helper",
      statement: "API routes must call an accepted auth helper.",
      rationale: "accepted for test",
      scope: { path_globs: ["app/api/**/route.ts"], file_roles: ["api_route"] },
      matcher: {
        kind: "api_route_requires_auth_helper",
        required_calls: ["withSession", "withWorkspace"],
        applies_to_file_roles: ["api_route"],
        enforcement_semantics: "presence"
      },
      requires: {
        auth_helpers: [
          { guard_id: "auth:withSession", symbol: "withSession", import: "@/lib/auth" },
          { guard_id: "auth:withWorkspace", symbol: "withWorkspace", import: "@/lib/auth" }
        ]
      },
      severity: "warning",
      enforcement_mode: "warn",
      enforcement_capability: "deterministic_check",
      exceptions: [],
      evidence_refs: [],
      counterexample_refs: [],
      accepted_by: "test",
      accepted_at: "2026-08-04T00:00:40.000Z",
      updated_at: "2026-08-04T00:00:40.000Z"
    } as never);
    storage.upsertRepoContract({
      ...contract,
      conventions: storage.listAcceptedConventions(repoId),
      updated_at: "2026-08-04T00:00:40.000Z"
    });
    storage.close();

    const result = await runCli([
      "--db", databasePath, "check", "--repo", repoId, "--scope", "full", "--json"
    ]);
    expect(result.exitCode).not.toBe(1);

    // The auth convention really was dispatched - otherwise the assertion below would be vacuous.
    const auth = sentConventions().filter(
      (convention) => convention.kind === "api_route_requires_auth_helper"
    );
    expect(auth.length).toBeGreaterThan(0);

    // Both accepted helpers resolve to the one file that defines them, computed from the whole
    // graph rather than from the routes in scope. The routes reach that file by two different
    // spellings (`@/lib/auth` and `../../../lib/auth`), which is what Sprint 4 will match against
    // this file identity instead of against the specifier strings that disagree.
    expect(auth[0]!.matcher.accepted_helper_module_files).toEqual([
      {
        requires_key: "auth_helpers",
        symbol: "withSession",
        specifier: "@/lib/auth",
        mode: "repo_resolved",
        files: ["lib/auth.ts"]
      },
      {
        requires_key: "auth_helpers",
        symbol: "withWorkspace",
        specifier: "@/lib/auth",
        mode: "repo_resolved",
        files: ["lib/auth.ts"]
      }
    ]);
  }, TEST_TIMEOUT_MS);
});
