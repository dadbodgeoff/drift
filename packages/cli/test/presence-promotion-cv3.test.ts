import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { runCli } from "../src/index.js";

/**
 * CV-3 (option B): what promotion out of quarantine actually means.
 *
 * The three kinds CV-3 named are all ENFORCED by control-flow proofs, so promoting them as they stood
 * would have surfaced the quarantined tier as a default-visible blocking convention. Option B adds a
 * presence-only semantics beside the proof path and promotes THAT.
 *
 * The distinction this file exists to pin is that promotion is per CANDIDATE, not per kind. Both
 * shapes come from the same kind:
 *
 *   - a family candidate with `enforcement_semantics: "presence"` -> visible by default;
 *   - the per-symbol candidates, checked by `build_auth_boundary_proof` -> still hidden behind
 *     `--experimental-security`.
 *
 * Asserted in both directions, because a filter that reveals too much is the failure mode here and a
 * test that only checks the promoted side would not notice.
 */

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

/** Two interchangeable wrappers over four routes, so a family forms. */
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

async function onboard(): Promise<{ repoId: string; databasePath: string; repoRoot: string }> {
  const dir = await mkdtemp(join(tmpdir(), "drift-cv3-"));
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
  // One route with no wrapper at all, present at onboarding so it is scanned. It is the violation the
  // accepted family should report, and the four wrapped routes are the control that stays silent.
  await mkdir(join(repoRoot, "app/api/naked"), { recursive: true });
  await writeFile(
    join(repoRoot, "app/api/naked/route.ts"),
    "export async function POST() { return Response.json({ ok: true }); }\n"
  );
  for (const [path, wrapper] of [
    ["app/api/a/route.ts", "withSession"],
    ["app/api/b/route.ts", "withSession"],
    ["app/api/c/route.ts", "withWorkspace"],
    ["app/api/d/route.ts", "withWorkspace"]
  ] as const) {
    await mkdir(join(repoRoot, path, ".."), { recursive: true });
    await writeFile(join(repoRoot, path), WRAPPED(wrapper));
  }
  await writeFile(
    join(repoRoot, "tsconfig.json"),
    JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@/*": ["./*"] } } })
  );
  git(repoRoot, "init", "-q");
  git(repoRoot, "add", "-A");
  execFileSync(
    "git",
    ["-c", "user.email=cv3@drift.test", "-c", "user.name=cv3", "commit", "-qm", "fixture"],
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
  return {
    repoId: payload.repo.id,
    databasePath: payload.state.database_path,
    repoRoot
  };
}

const listCandidates = async (databasePath: string, repoId: string, ...extra: string[]) => {
  const result = await runCli([
    "--db", databasePath, "conventions", "list", "--repo", repoId,
    "--include-low-confidence", "--json", ...extra
  ]);
  expect(result.exitCode).toBe(0);
  return JSON.parse(result.stdout);
};

const isFamily = (candidate: { matcher: { required_calls?: string[] } }) =>
  (candidate.matcher.required_calls ?? []).length > 1;

describe("CV-3 presence promotion", () => {
  it("shows the presence family by default and keeps the proof candidates hidden", async () => {
    const { repoId, databasePath } = await onboard();
    const listed = await listCandidates(databasePath, repoId);
    const auth = listed.candidates.filter(
      (candidate: { kind: string }) => candidate.kind === "api_route_requires_auth_helper"
    );

    // Direction one: the promoted family is visible with no flags.
    expect(auth.length).toBeGreaterThan(0);
    expect(auth.every(isFamily)).toBe(true);
    for (const candidate of auth) {
      expect(candidate.matcher.enforcement_semantics).toBe("presence");
    }

    // Direction two: the per-symbol candidates of the SAME kind are not among them. They carry no
    // presence marker and are checked by the guard-dominance proof, so they stay quarantined.
    const withFlag = await listCandidates(databasePath, repoId, "--experimental-security");
    const perSymbol = withFlag.candidates.filter(
      (candidate: { kind: string; matcher: { required_calls?: string[] } }) =>
        candidate.kind === "api_route_requires_auth_helper" && !isFamily(candidate)
    );
    expect(perSymbol.length).toBeGreaterThan(0);
    for (const candidate of perSymbol) {
      expect(candidate.matcher.enforcement_semantics).toBeUndefined();
    }
    const defaultIds = new Set(auth.map((candidate: { id: string }) => candidate.id));
    for (const candidate of perSymbol) {
      expect(defaultIds.has(candidate.id)).toBe(false);
    }
  }, 60_000);

  it("keeps the flow-claim kinds hidden by default", async () => {
    // The kinds with no presence semantics must not have been swept along. A presence version of any
    // of these would not be a weaker claim, it would be a different one.
    const { repoId, databasePath } = await onboard();
    const listed = await listCandidates(databasePath, repoId);
    const kinds = new Set(listed.candidates.map((candidate: { kind: string }) => candidate.kind));

    for (const hidden of [
      "api_route_forbids_sensitive_response_fields",
      "api_route_cors_must_match_policy",
      "api_route_forbids_raw_sql_without_params",
      "session_object_must_come_from_trusted_helper",
      "api_route_requires_tenant_scope",
      "api_route_requires_authorization"
    ]) {
      expect(kinds.has(hidden)).toBe(false);
    }
  }, 60_000);

  it("still reports how many candidates it withheld", async () => {
    // A7's rule survives promotion: never hide silently. The count must fall (families are now shown)
    // without going to zero (the proof candidates are still withheld).
    const { repoId, databasePath } = await onboard();
    const listed = await listCandidates(databasePath, repoId);
    expect(listed.experimental_security.hidden_count).toBeGreaterThan(0);
    expect(listed.experimental_security.included).toBe(false);
  }, 60_000);

  it("suggests warn, not block, for an auth family", async () => {
    // Geoffrey's condition 2. Public routes are legitimate - a health check, an OG image endpoint, a
    // webhook receiver - and the first intentionally-public route in a repo must not be a false block.
    // Block is available, but only as an explicit upgrade by the author.
    const { repoId, databasePath } = await onboard();
    const listed = await listCandidates(databasePath, repoId);
    const family = listed.candidates.find(
      (candidate: { kind: string; matcher: { required_calls?: string[] } }) =>
        candidate.kind === "api_route_requires_auth_helper" && isFamily(candidate)
    );
    expect(family).toBeDefined();
    expect(family.suggested_enforcement_mode).toBe("warn");
  }, 60_000);

  it("accepts a presence family at warn and enforces it without touching the proof path", async () => {
    // CV-3's red #3, adjusted for option B: acceptance flows through accept -> contract -> enforcement.
    // The handler DID change - that is what option B authorised - so what is asserted here is that the
    // accepted family enforces by presence, and says so.
    const { repoId, databasePath, repoRoot } = await onboard();
    const listed = await listCandidates(databasePath, repoId);
    const family = listed.candidates.find(
      (candidate: { kind: string; matcher: { required_calls?: string[] } }) =>
        candidate.kind === "api_route_requires_auth_helper" && isFamily(candidate)
    );
    expect(family).toBeDefined();

    const accepted = await runCli([
      "--db", databasePath, "conventions", "accept", family.id,
      "--repo", repoId, "--mode", "warn", "--severity", "warning",
      "--actor", "cv3", "--confirm", "--json"
    ]);
    expect(accepted.exitCode).toBe(0);
    expect(JSON.parse(accepted.stdout).accepted.enforcement_mode).toBe("warn");

    const checked = await runCli([
      "--db", databasePath, "check", "--repo", repoId, "--scope", "full", "--json"
    ]);
    const payload = JSON.parse(checked.stdout);
    // Findings are identified by the convention they came from; the CLI payload carries no rule_id.
    const presenceFindings = (payload.findings ?? []).filter(
      (finding: { convention_id: string }) =>
        finding.convention_id === `convention_${family.id.replace(/^candidate_/, "")}`
    );
    expect(presenceFindings.length).toBeGreaterThan(0);
    for (const finding of presenceFindings) {
      // Condition 1, end to end through the CLI: presence, never protection.
      expect(finding.title).toBe("API route calls no accepted auth wrapper");
      expect(finding.message).toContain("does not call any accepted auth wrapper");
      expect(finding.message.toLowerCase()).not.toContain("unprotected");
      expect(finding.message.toLowerCase()).not.toContain("dominate");
      expect(finding.enforcement_result).toBe("warn");
      // Only the unwrapped route. The four wrapped ones satisfy the disjunction.
      expect(finding.evidence_refs[0].file_path).toBe("app/api/naked/route.ts");
    }
    expect(presenceFindings.length).toBe(1);
    // warn mode, so it reports and does not block.
    expect(checked.exitCode).toBe(0);
  }, 90_000);

  it("never reports a file the convention's narrowed globs exclude", async () => {
    // The cross-package invariant the engine's presence path DEPENDS on, now pinned behaviourally.
    //
    // `presence_file_in_scope` deliberately applies no path globs: the CLI has already run
    // @drift/core's `conventionScopeFiles` and passes only the facts of files it selected. Independent
    // verification confirmed the engine WILL flag an out-of-scope file if handed its facts directly,
    // so the CLI's filtering is the only thing making that safe - and nothing pinned it. One caller
    // that forgets `facts.filter(...)` reintroduces a false positive silently.
    //
    // Two earlier versions of this test were unfalsifiable: one passed a `--path-glob` flag that does
    // not exist and took its own skip path, the other edited an accepted convention when
    // `conventions edit` operates on candidates. Narrowing therefore happens BEFORE acceptance, and
    // the narrowing itself is asserted so the test cannot pass by failing to narrow.
    const { repoId, databasePath, repoRoot } = await onboard();
    const listed = await listCandidates(databasePath, repoId);
    const family = listed.candidates.find(
      (candidate: { kind: string; matcher: { required_calls?: string[] } }) =>
        candidate.kind === "api_route_requires_auth_helper" && isFamily(candidate)
    );
    expect(family).toBeDefined();

    const scopePath = join(repoRoot, "..", "narrowed-scope.json");
    await writeFile(
      scopePath,
      JSON.stringify({
        // Only one of the five routes. `app/api/naked` - the sole violation - is outside it.
        path_globs: ["app/api/a/route.ts"],
        file_roles: ["api_route"],
        exclude_path_globs: []
      })
    );
    const narrowed = await runCli([
      "--db", databasePath, "conventions", "edit", family.id,
      "--repo", repoId, "--scope-file", scopePath,
      "--actor", "cv3", "--confirm", "--json"
    ]);
    expect(narrowed.exitCode).toBe(0);
    // The narrowing actually happened, so a green result below means something.
    expect(JSON.parse(narrowed.stdout).candidate.scope.path_globs).toEqual(["app/api/a/route.ts"]);

    const accepted = await runCli([
      "--db", databasePath, "conventions", "accept", family.id,
      "--repo", repoId, "--mode", "warn", "--severity", "warning",
      "--actor", "cv3", "--confirm", "--json"
    ]);
    expect(accepted.exitCode).toBe(0);
    const conventionId = JSON.parse(accepted.stdout).accepted.id;

    for (const scope of ["full", "changed-files"] as const) {
      const checked = await runCli([
        "--db", databasePath, "check", "--repo", repoId, "--scope", scope, "--json"
      ]);
      const payload = JSON.parse(checked.stdout);
      const reported = (payload.findings ?? []).filter(
        (finding: { convention_id: string }) => finding.convention_id === conventionId
      );
      for (const finding of reported) {
        expect(finding.evidence_refs[0].file_path).not.toContain("app/api/naked");
      }
    }
  }, 90_000);

  it("lists exactly the promoted kinds in the capability manifest", async () => {
    // CV-3's red #2. The manifest is a machine-readable claim; the EW-10 validator refuses a promoted
    // kind that lacks a ledger entry stating what its enforcement does not catch.
    const result = await runCli(["capabilities", "--json"]);
    expect(result.exitCode).toBe(0);
    const kinds = JSON.parse(result.stdout).capabilities.supported_wedge.convention_kinds;
    expect(kinds).toEqual([
      "api_route_no_direct_data_access",
      "api_route_requires_auth_helper",
      "api_route_requires_rate_limit",
      "api_route_requires_request_validation"
    ]);
  }, 30_000);
});
