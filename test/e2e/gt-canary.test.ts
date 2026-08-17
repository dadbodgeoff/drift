// Canary tests for the (convention kind × enforcement path) ledger (TDD §4.2, phase 0b).
//
// The ledger at test/canary/convention-cell-ledger.json declares one state per cell. This file is
// the evidence half: every cell the ledger calls `firing`, `unimplemented` or `quarantined` is
// backed by a test here, and the last test in this file asserts that correspondence both ways, so a
// state cannot be edited into the ledger without the artifact its state requires.
//
// THE ONE HARD RULE (§4.1). Nothing here calls `storage.upsertAcceptedConvention`. Every
// convention on the proposer path is obtained from the proposer and accepted through
// `drift conventions accept`, and hand-writes no `requires` block. Three existing tests of D1's
// kind inject their contract, and that is precisely why a P0 shipped under their coverage: a
// hand-built contract is not coverage for a convention kind, so a test that injects its convention
// cannot be evidence for `firing`.
//
// THE ONE EXCEPTION, and it is narrow. Two kinds have no proposer at all —
// `candidate_command.rs` contains zero occurrences of `SessionObjectMustComeFromTrustedHelper` or
// `ApiRouteForbidsSecretExposure` — so there is no candidate to accept and the rule above cannot be
// satisfied for them by any test. For those, and only those, the convention arrives through the
// documented `drift contract import` workflow (docs/agent-integration.md), driven by
// `runGtContractImportWorkflow`, which asserts the proposer emitted nothing of the kind before it
// will import one. That is a different claim from the proposer path and the ledger evidence says so.

import { readFileSync, writeFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runCli } from "../../packages/cli/src/index.js";
import {
  assertNoProposerFor,
  cleanupGtTempDirs,
  DEBUG_ENGINE,
  flaggedPaths,
  readFindings,
  runGtContractImportWorkflow,
  runGtWorkflow
} from "./gt-harness.js";

afterEach(cleanupGtTempDirs);

const LEDGER = JSON.parse(
  readFileSync(resolve("test/canary/convention-cell-ledger.json"), "utf8")
) as {
  cells: Array<{
    id: string;
    state: string;
    canary: string | null;
    missing_evidence: string | null;
    citation: { path?: string } | null;
  }>;
};

const DATA_ACCESS = "api_route_no_direct_data_access";
const AUTH_HELPER = "api_route_requires_auth_helper";
const CORS = "api_route_cors_must_match_policy";
const MIDDLEWARE = "middleware_must_cover_routes";
const SENSITIVE_FIELDS = "api_route_forbids_sensitive_response_fields";
const TENANT_SCOPE = "api_route_requires_tenant_scope";
const REQUEST_VALIDATION = "api_route_requires_request_validation";
const SECRET_EXPOSURE = "api_route_forbids_secret_exposure";
const AUTHORIZATION = "api_route_requires_authorization";
const SESSION_TRUST = "session_object_must_come_from_trusted_helper";

/**
 * The proposer's literal emitted route scope, from `candidate_command.rs:372` (and `:1010`).
 *
 * Copied byte for byte on purpose. The historical D1 bug was that `**\/app/api/**\/route.ts` reduced
 * to `starts_with("**\/app/api")` and matched nothing, so every proposer-scoped security convention
 * accepted cleanly and was structurally unable to fire. A hand-written scope like
 * `app/api/**\/route.ts` sidesteps the `**\/`-prefix entirely and would pass under the broken
 * matcher too — which is exactly how the three pre-existing tests of the phase-5 kinds missed it.
 * The zero-leading-segment case (`app/api/billing/route.ts` against `**\/app/api/**\/route.ts`) is
 * the case that was dead, and it is the case this fixture's layout forces.
 *
 * The zero-leading-segment case is also what the authorization canary turns on: the first glob
 * matching `app/api/projects/route.ts` consumes nothing at all through its leading `**​/`. This is a
 * restatement of what the proposer emits, asserted for equality against a real candidate below — it
 * is not a hand-written scope, and nothing here is fed INTO the workflow.
 *
 * Copied rather than imported because the engine is a separate process with no TypeScript export
 * of it — and pinned against the Rust source by `assertProposerScopeGlobs` below, so a drift
 * between the two fails here rather than quietly turning the import canaries into a test of a scope
 * no candidate ever carries.
 */
const PROPOSER_ROUTE_SCOPE_GLOBS = [
  "**/app/api/**/route.ts",
  "**/app/api/**/route.tsx",
  "**/pages/api/**/*.ts"
];

/** Every route in gt-authorization, violating and conforming alike. */
const ALL_GT_AUTHORIZATION_ROUTES = [
  "app/api/audits/route.ts",
  "app/api/invoices/route.ts",
  "app/api/members/route.ts",
  "app/api/projects/route.ts",
  "app/api/reports/route.ts"
];

/**
 * Pins `PROPOSER_ROUTE_SCOPE_GLOBS` against the Rust source it claims to restate.
 *
 * The import canaries hand the engine a scope they say is the proposer's own. If the proposer's
 * scope ever changes, that claim silently becomes a test of a glob set nothing produces — so the
 * drift fails here rather than downstream, and it must be re-derived, not adjusted.
 */
function assertProposerScopeGlobs(): void {
  const source = readFileSync(resolve("crates/drift-engine/src/candidate_command.rs"), "utf8");
  const literal = `"path_globs": [${PROPOSER_ROUTE_SCOPE_GLOBS.map((glob) => `"${glob}"`).join(", ")}]`;
  expect(
    source.includes(literal),
    `candidate_command.rs no longer emits ${literal}. The imported contract below claims to carry ` +
      `the proposer's own scope; if the proposer's scope has changed, this canary is testing a ` +
      `glob set nothing produces and must be re-derived, not adjusted.`
  ).toBe(true);
}

/**
 * A unified diff that introduces `paths` as new files, read out of the copied fixture so it cannot
 * drift from the files under test.
 *
 * Needed because `blockingCount` only counts `new_in_diff` findings, and `--scope full` classifies
 * everything `touched_existing`. Rather than assert a weaker exit code, the canaries take the
 * verdict over the diff that a pull request adding these routes would actually produce.
 */
function addedFilesPatch(repoRoot: string, paths: readonly string[]): string {
  return paths
    .map((path) => {
      const lines = readFileSync(join(repoRoot, path), "utf8").split("\n");
      // A trailing newline produces a final empty element that is not a line of the file.
      if (lines.at(-1) === "") lines.pop();
      return [
        `diff --git a/${path} b/${path}`,
        "new file mode 100644",
        "--- /dev/null",
        `+++ b/${path}`,
        `@@ -0,0 +1,${lines.length} @@`,
        ...lines.map((line) => `+${line}`)
      ].join("\n");
    })
    .join("\n")
    .concat("\n");
}

/**
 * The documented review surface, asserted for what it ACTUALLY shows.
 *
 * `runGtWorkflow` reads candidates from `start --json`, which emits `result.candidates`
 * unfiltered (`packages/cli/src/commands/start.ts`). `drift conventions list` — the command a
 * human actually runs — does not: `packages/cli/src/commands/conventions.ts:76,86-89` drops every
 * `isExperimentalSecurityKind` candidate unless `--experimental-security` is passed, and
 * `EXPERIMENTAL_SECURITY_CONVENTION_KINDS` is the whole security-contract set
 * (`packages/core/src/capabilities.ts:187`).
 *
 * So every kind this file proves is INVISIBLE on the default review surface. That is a real
 * property of the product, not a harness artifact, and pinning it here is the difference between
 * "the engine can fire" and "a user can get here". If the gate is ever lifted, this fails and the
 * canary must be re-read rather than adjusted.
 */
async function assertListVisibility(
  databasePath: string,
  repoId: string,
  kind: string
): Promise<void> {
  const plain = await runCli(["--db", databasePath, "conventions", "list", "--repo", repoId, "--json"]);
  expect(plain.exitCode, `conventions list stderr:\n${plain.stderr}`).toBe(0);
  expect(
    (JSON.parse(plain.stdout).candidates ?? []).map((candidate: any) => candidate.kind),
    `${kind} must be HIDDEN from the default \`conventions list\` — it is an experimental security ` +
      `kind. If this now appears, the experimental gate moved and the claim that only ` +
      `--experimental-security reaches it is stale.`
  ).not.toContain(kind);

  const gated = await runCli([
    "--db", databasePath, "conventions", "list", "--repo", repoId, "--experimental-security", "--json"
  ]);
  expect(gated.exitCode, `conventions list --experimental-security stderr:\n${gated.stderr}`).toBe(0);
  expect(
    (JSON.parse(gated.stdout).candidates ?? []).map((candidate: any) => candidate.kind),
    `${kind} must be reachable on the documented review surface with --experimental-security`
  ).toContain(kind);
}

/** Cell ids this file claims to be the canary for. Kept beside the tests it names. */
const CELLS_COVERED_HERE: Record<string, string> = {
  "api_route_no_direct_data_access::materialized_and_graph":
    "data-access materialized+graph path fires",
  "api_route_requires_auth_helper::presence_findings":
    "presence path fires and the arm-3 intercept is real",
  "api_route_requires_auth_helper::auth_proof": "per-symbol auth proof path fires",
  "api_route_cors_must_match_policy::phase6_proof": "phase-6 CORS policy path fires",
  "api_route_forbids_secret_exposure::phase5_proof":
    "phase-5 secret-exposure path fires, reached by contract import",
  // Neither of these two is "unimplemented" any more, and the two words are not interchangeable.
  // The proposer still emits nothing of either shape — the test below keeps asserting exactly that,
  // on both of its fixtures — but "no proposer" is not "no reachable enforcement":
  // `drift contract import` reaches the arm, and the arm fires.
  "session_object_must_come_from_trusted_helper::phase4_proof":
    "phase-4 session-trust path fires through contract import",
  "middleware_must_cover_routes::no_dispatch_arm":
    "middleware_must_cover_routes is refused at acceptance, by name",
  "api_route_forbids_sensitive_response_fields::phase5_proof":
    "phase-5 sensitive-response-fields path fires, on both provenance routes",
  "api_route_requires_tenant_scope::phase4_proof":
    "phase-4 tenant-scope path fires, and the helper-scoped siblings pass",
  "api_route_requires_authorization::phase4_proof":
    "phase-4 authorization path fires over the proposer's own route globs",
  "api_route_requires_request_validation::request_validation_proof":
    "request-validation safeParse proof path fires"
};

describe("cell canaries — firing", () => {
  it("data-access materialized+graph path fires", async () => {
    // Violation half. gt-data-access is the audit's own corpus: four genuine data-access routes.
    const violation = await runGtWorkflow({
      fixture: "gt-data-access",
      acceptKinds: [DATA_ACCESS]
    });
    const flagged = flaggedPaths(readFindings(violation.databasePath, violation.repoId), DATA_ACCESS);
    for (const route of [
      "pages/api/route-data-access.ts",
      "pages/api/route-database.ts",
      "pages/api/route-db.ts",
      "pages/api/route-prisma.ts"
    ]) {
      expect(flagged, `${route} is a genuine data-access route`).toContain(route);
    }

    // Conformance half, and the §4.3 near-miss half at the same time: route-prismatic.ts and
    // route-utils.ts carry names that look like the signal and content that is not data access.
    // A recall-only fixture would let the substring heuristic score perfectly here.
    expect(flagged).not.toContain("pages/api/route-prismatic.ts");
    expect(flagged).not.toContain("pages/api/route-utils.ts");

    // A second, independent repo shape: one violating route, flagged exactly once.
    const single = await runGtWorkflow({
      fixture: "next-api-direct-db",
      acceptKinds: [DATA_ACCESS]
    });
    const singleFlagged = flaggedPaths(readFindings(single.databasePath, single.repoId), DATA_ACCESS);
    expect(singleFlagged).toEqual(["apps/web/app/api/users/route.ts"]);
  }, 180000);

  it("presence path fires and the arm-3 intercept is real", async () => {
    // ARM 3 IS THE TRAP. `is_presence_convention` keys on matcher.enforcement_semantics and sits
    // BEFORE the kind arms, so a convention of kind api_route_requires_auth_helper with presence
    // semantics never reaches arm 4. This test exists to hold that pair down as its own cell.
    const run = await runGtWorkflow({
      fixture: "gt-presence-auth",
      acceptKinds: [AUTH_HELPER]
    });

    // The proposer produced the presence candidate; this test did not invent it. Its members are
    // the two real wrappers, and NOT the lookalike.
    const candidates = (run.startPayload.candidates ?? []).filter(
      (candidate: any) => candidate.kind === AUTH_HELPER
    );
    const family = candidates.filter(
      (candidate: any) => candidate.matcher?.enforcement_semantics === "presence"
    );
    expect(family, "the proposer must emit a presence family for this fixture").toHaveLength(1);
    expect(family[0].matcher.required_calls).toEqual(["withAdmin", "withSession"]);

    const presence = readFindings(run.databasePath, run.repoId).filter((finding) =>
      finding.message.includes("does not call any accepted auth wrapper")
    );
    const flagged = presence.map((finding) => finding.file_path).sort();

    // Violation half: the unwrapped route, and both near-miss routes.
    //
    // §4.3 near-miss. `withAuthorHat` is nominated by the same name heuristic that finds the real
    // wrappers - it starts with `with` and contains `auth` - while its content is a byline
    // decorator that checks nothing. It resolves to a different module, so it must not join the
    // family, and the routes that call only it must still be flagged. Without these two routes a
    // pure name heuristic would score identically to a correct one.
    expect(flagged).toEqual([
      "pages/api/blog-a.ts",
      "pages/api/blog-b.ts",
      "pages/api/open.ts"
    ]);

    // Conformance half: every route actually wrapped by a family member is silent.
    for (const route of [
      "pages/api/session-a.ts",
      "pages/api/session-b.ts",
      "pages/api/admin-a.ts",
      "pages/api/admin-b.ts"
    ]) {
      expect(flagged, `${route} calls an accepted wrapper and must be silent`).not.toContain(route);
    }
  }, 180000);

  it("per-symbol auth proof path fires", async () => {
    // The other side of the same kind. gt-auth-helper yields exactly one candidate and it carries
    // NO enforcement_semantics, so arm 3 does not intercept and arm 4's proof path runs. That the
    // two cells of one kind need two fixtures is the whole argument for keying the ledger on the
    // pair.
    const run = await runGtWorkflow({ fixture: "gt-auth-helper", acceptKinds: [AUTH_HELPER] });

    const candidates = (run.startPayload.candidates ?? []).filter(
      (candidate: any) => candidate.kind === AUTH_HELPER
    );
    expect(candidates).toHaveLength(1);
    expect(
      candidates[0].matcher?.enforcement_semantics,
      "this cell is only entered when arm 3 does NOT intercept"
    ).toBeUndefined();

    const flagged = flaggedPaths(readFindings(run.databasePath, run.repoId), AUTH_HELPER);
    expect(flagged).toEqual(["pages/api/route-c.ts"]);
  }, 180000);

  it("phase-5 sensitive-response-fields path fires, on both provenance routes", async () => {
    // The D1 cell. Its evidence is the reason this ledger exists at all: before D1 this path
    // could not fire for ANY proposer-produced convention, and the three tests that covered the
    // kind all hand-built their contract, so none of them could see it.
    //
    // Both provenance routes are asserted because they fail independently. The marker path
    // exercises `source: "schema"` surviving proposal (candidate_command.rs:642); the inference
    // path exercises `accepted_inference` being stamped at the accept path and admitted by the
    // allowlist (security_patterns.rs:266). Fixing only one leaves the other dead.
    for (const fixture of ["gt-sensitive-fields-schema", "gt-sensitive-fields"]) {
      const run = await runGtWorkflow({ fixture, acceptKinds: [SENSITIVE_FIELDS] });

      // Obtained from the proposer, never injected — the property that makes this evidence.
      expect(run.acceptPayloads, `${fixture}: convention must come from the proposer`).toHaveLength(1);

      // The documented review surface hides this kind unless --experimental-security is passed.
      await assertListVisibility(run.databasePath, run.repoId, SENSITIVE_FIELDS);

      const flagged = flaggedPaths(readFindings(run.databasePath, run.repoId), SENSITIVE_FIELDS);
      expect(flagged, `${fixture}: the leaking route and only the leaking route`).toEqual([
        "pages/api/route-leak.ts"
      ]);

      // The finding in the CLI's own JSON payload, at its line — not just a row in the state DB.
      const findings = (run.checkPayload.findings ?? []).filter(
        (finding: any) => finding.title === "API route emits sensitive response field"
      );
      expect(findings, `${fixture}: exactly one finding, in the JSON output`).toHaveLength(1);
      expect(findings[0].evidence_refs[0].file_path).toBe("pages/api/route-leak.ts");
      // pages/api/route-leak.ts:9 — the response that carries the accepted sensitive field.
      expect(findings[0].evidence_refs[0].start_line).toBe(9);
      expect(findings[0].actual_layer).toBe("sensitive_response_field_unfiltered");

      // Evaluated, not skipped. The compliant sibling is NAMED by the engine as a conforming
      // example — a scope that failed to match could not have produced that. Asserting only that
      // route-safe.ts is absent from `flagged` would be satisfied by never evaluating it at all,
      // which is exactly the failure mode this whole file exists to rule out.
      expect(
        (findings[0].conforming_examples ?? []).map((example: any) => example.file_path),
        `${fixture}: the compliant sibling must be evaluated, not merely absent`
      ).toContain("pages/api/route-safe.ts");

      // KIND-SPECIFIC LIMIT, and not the `--scope full` one the other canaries hit: a
      // candidate-sourced sensitive-fields convention cannot be accepted in block mode at all
      // (`packages/engine-contract/src/index.ts:412-420` — "candidate sensitive fields cannot back
      // blocking enforcement"). It lands on `warn`, so exit 2 is unreachable for this kind by
      // design rather than by the diff-scope accident. That reject is deliberate policy — a
      // name-heuristic guess should not block a merge — so it is asserted, not worked around.
      expect(findings[0].severity).toBe("warning");
      expect(findings[0].enforcement_result).toBe("warn");
      expect(run.checkExitCode, `${fixture}: warn-mode findings do not block`).toBe(0);
    }
  }, 180000);

  it("phase-5 secret-exposure path fires, reached by contract import", async () => {
    // THE ONE PLACE IN THIS FILE THAT DOES NOT GO THROUGH `conventions accept`, and the reason is
    // the cell itself. `api_route_forbids_secret_exposure` has NO proposer — zero
    // `ConventionKind::ApiRouteForbidsSecretExposure` occurrences in candidate_command.rs — so
    // `acceptKinds` cannot reach its enforcement arm, not because the arm is broken but because
    // nothing proposes the shape. The documented remaining path is a hand-authored contract
    // (`drift contract import drift.lock --repo <id> --confirm`, docs/agent-integration.md:84,
    // router.ts:158, contract.ts:452), and it runs the real command: schema validation,
    // `hasConventionEvaluator`, fingerprint compatibility, `--confirm`. Nothing here calls
    // `storage.upsertAcceptedConvention`.
    //
    // WHAT THIS DOES AND DOES NOT CLAIM. It does not claim the kind is proposable; the
    // `unimplemented` describe below still pins that the proposer emits nothing of this shape, and
    // `assertNoProposerFor` re-checks it inside this very run. What it falsifies is the *second*
    // half of the old ledger evidence — "nothing can ever reach it". Something can: an imported
    // contract does, and the arm fires.
    //
    // The scope is the proposer's own glob set rather than a de-globbed convenience, so this is
    // still a test of `phase5_file_scope_matches` -> `path_glob_matches` and still dies if the
    // globstar matcher regresses.
    // The imported scope below claims to be the proposer's own. Pin it, exactly as the
    // session-trust import canary does — without this the claim is unenforced and a change to
    // `candidate_command.rs`'s route_scope would silently turn this into a test of a glob set
    // nothing emits.
    assertProposerScopeGlobs();

    // Built from the SOURCE fixture, not the copied repo: this patch is an input to the workflow,
    // so it has to exist before the temp repo does. Reading the real files still beats eliding the
    // bodies — the hunk headers cannot drift from the fixture they describe.
    const patch = addedFilesPatch(resolve("test/fixtures/gt-secret-exposure"), [
      "app/api/billing/route.ts",
      "app/api/webhooks/route.ts",
      "app/api/status/route.ts"
    ]);

    const run = await runGtWorkflow({
      fixture: "gt-secret-exposure",
      scope: "changed-hunks",
      diffPatch: patch,
      importConventions: ({ contractId, now }) => [{
        id: "convention_gt_secret_exposure",
        contract_id: contractId,
        kind: SECRET_EXPOSURE,
        statement:
          "API routes must not let a secret read from the environment reach a response or log sink.",
        scope: { path_globs: PROPOSER_ROUTE_SCOPE_GLOBS, file_roles: ["api_route"] },
        matcher: { kind: SECRET_EXPOSURE, applies_to_file_roles: ["api_route"] },
        requires: { secret_sources: ["env"], log_sinks: ["console.error"] },
        severity: "error",
        enforcement_mode: "block",
        enforcement_capability: "deterministic_check",
        exceptions: [],
        evidence_refs: [],
        counterexample_refs: [],
        accepted_by: "gt-canary",
        accepted_at: now,
        updated_at: now
      }]
    });

    // The precondition for taking the import path at all, asserted from this run rather than from
    // a grep. If the proposer ever learns this kind, this fails and the canary must be rewritten
    // as an `acceptKinds` workflow.
    assertNoProposerFor(run, SECRET_EXPOSURE, "gt-secret-exposure");
    expect(run.acceptPayloads, "nothing was accepted through the candidate path").toHaveLength(0);
    expect(run.importPayload.compatibility.reasons).toEqual([]);
    expect(
      run.importPayload.compatibility.repo_fingerprint_matches,
      "the contract must be imported into the repository it names, not any repository"
    ).toBe(true);

    // Block mode survived the import. `contractValidationReasons` refuses block for
    // non-deterministic capability and for candidate-sourced sensitive fields; neither applies
    // here, and the finding below carries enforcement_result "block" as a result.
    const stored = run.checkPayload.findings.filter(
      (finding: any) => finding.convention_id === "convention_gt_secret_exposure"
    );
    expect(stored.length, `check payload: ${JSON.stringify(run.checkPayload.findings)}`).toBe(2);

    // Violation half, at the exact sink line. `phase5_finding_line` reports the *sink*, not the
    // secret read, so a finding at line 2 would mean the proof located the wrong end of the flow.
    const located = stored
      .map((finding: any) => `${finding.evidence_refs[0].file_path}:${finding.evidence_refs[0].start_line}`)
      .sort();
    expect(located).toEqual([
      "app/api/billing/route.ts:3",   // secret reaches Response.json
      "app/api/webhooks/route.ts:3"   // secret reaches console.error
    ]);
    for (const finding of stored) {
      expect(finding.enforcement_result).toBe("block");
      expect(finding.diff_status).toBe("new_in_diff");
    }

    // Conformance half, and the §4.3 near-miss: status/route.ts reads the SAME secret from the
    // SAME env key and genuinely uses it, but routes it to an outbound header rather than a sink.
    // A detector that flagged "route reads process.env.*_API_KEY" would score identically to a
    // correct one without this route, and it is in the diff and in scope, so it was evaluated
    // rather than skipped — the engine names it as a conforming example of the same convention.
    expect(flaggedPaths(readFindings(run.databasePath, run.repoId), SECRET_EXPOSURE)).toEqual([
      "app/api/billing/route.ts",
      "app/api/webhooks/route.ts"
    ]);
    for (const finding of stored) {
      expect(
        (finding.conforming_examples ?? []).map((example: any) => example.file_path),
        "the compliant sibling must be evaluated, not merely absent"
      ).toContain("app/api/status/route.ts");
    }

    // And the exit code the whole enforcement contract is about: 2, blocked.
    expect(run.checkExitCode, `check stderr:\n${run.checkStderr}`).toBe(2);
  }, 180000);

  it("phase-4 authorization path fires over the proposer's own route globs", async () => {
    // The cell's recorded missing_evidence was "no fixture produces a candidate of this kind".
    // That was a fixture-shape problem, not an engine one: `push_guard_candidate`
    // (candidate_command.rs:1660) needs the SAME symbol in >= 2 route facts, and all three
    // security-role-* fixtures are a single route with a single `requireRole` call, so the group
    // never reaches the threshold. gt-authorization calls one helper from three route files.
    const run = await runGtWorkflow({
      fixture: "gt-authorization",
      acceptKinds: [AUTHORIZATION],
      mode: "block",
      severity: "error"
    });

    // --- the candidate came from the proposer, and carries the glob scope --------------------
    await assertListVisibility(run.databasePath, run.repoId, AUTHORIZATION);

    const candidates = (run.startPayload.candidates ?? []).filter(
      (candidate: any) => candidate.kind === AUTHORIZATION
    );
    expect(
      candidates,
      "exactly one authorization candidate: `requirePermission`, nominated by repetition"
    ).toHaveLength(1);
    expect(candidates[0].matcher.required_calls).toEqual(["requirePermission"]);
    expect(candidates[0].requires.authorization_helpers).toEqual([
      { helper_id: "authorization:requirePermission", symbol: "requirePermission", import: "@/server/authz" }
    ]);
    expect(
      candidates[0].scope.path_globs,
      "the accepted scope is the proposer's glob set, verbatim — this canary is worthless if the " +
        "convention is scoped by anything else"
    ).toEqual(PROPOSER_ROUTE_SCOPE_GLOBS);
    expect(run.acceptPayloads, "obtained from the proposer, never injected").toHaveLength(1);

    // §4.3 near-miss, proposal side. `logPermissionCheck` passes
    // `is_authorization_candidate_symbol` on its name alone (it contains "permission") and guards
    // nothing. One call site keeps it under the >= 2 threshold, so it must never be nominated by
    // ANY candidate in this run — not just by the authorization one.
    const everyRequiredCall = (run.startPayload.candidates ?? []).flatMap(
      (candidate: any) => candidate.matcher?.required_calls ?? []
    );
    expect(everyRequiredCall).not.toContain("logPermissionCheck");

    // --- violation half ------------------------------------------------------------------------
    const findings = readFindings(run.databasePath, run.repoId);
    expect(flaggedPaths(findings, AUTHORIZATION)).toEqual([
      // near-miss: calls the accepted helper, but only AFTER the sink has run
      "app/api/audits/route.ts",
      // the unambiguous violation: no authorization guard at all
      "app/api/projects/route.ts",
      // near-miss: calls a permission-shaped symbol that is not the accepted helper
      "app/api/reports/route.ts"
    ]);

    // Exact file AND line, from the JSON payload the CLI actually emits. The line is the protected
    // sink, not the handler or the file head.
    const byPath = new Map<string, any>(
      (run.checkPayload.findings ?? [])
        .filter((finding: any) => finding.expected_layer === "authorization")
        .map((finding: any) => [finding.evidence_refs[0].file_path, finding])
    );
    const projects = byPath.get("app/api/projects/route.ts");
    expect(projects.title).toBe("API route missing required authorization proof");
    expect(projects.actual_layer).toBe("authorization_guard_missing");
    expect(projects.evidence_refs[0].start_line, "the `db.project.delete` call").toBe(7);
    expect(projects.severity).toBe("error");
    expect(projects.enforcement_result, "accepted in block mode").toBe("block");

    // The dominance near-miss fails for a DIFFERENT reason than the missing-guard one. A presence
    // matcher cannot tell these apart; this cell's path can, and that distinction is the claim.
    expect(byPath.get("app/api/audits/route.ts").actual_layer).toBe(
      "authorization_guard_not_dominating_sink"
    );
    expect(byPath.get("app/api/audits/route.ts").evidence_refs[0].start_line).toBe(10);
    expect(byPath.get("app/api/reports/route.ts").actual_layer).toBe("authorization_guard_missing");
    expect(byPath.get("app/api/reports/route.ts").evidence_refs[0].start_line).toBe(14);

    // Exit code. A `--scope full` run classifies every finding `touched_existing`, and
    // `blockingCount` (run-check.ts:821) counts only `new_in_diff` — inherited debt never blocks,
    // by design, so the full-scope run above exits 0 with three block-mode findings. The blocking
    // verdict therefore has to be taken over a diff, which is what a PR adding these routes looks
    // like. Same database, same accepted convention, so this is the same cell.
    const patchPath = join(run.repoRoot, "..", "adds-the-routes.patch");
    writeFileSync(patchPath, addedFilesPatch(run.repoRoot, ALL_GT_AUTHORIZATION_ROUTES), "utf8");
    const { runCli } = await import("../../packages/cli/src/index.js");
    // `runGtWorkflow` restores DRIFT_ENGINE_BIN when it returns, and without it the CLI falls back
    // to `cargo run` — a different binary than the one the assertions above were made against.
    const previousEngineBin = process.env.DRIFT_ENGINE_BIN;
    process.env.DRIFT_ENGINE_BIN = DEBUG_ENGINE;
    let blocked;
    try {
      blocked = await runCli([
        "--db", run.databasePath,
        "check",
        "--repo", run.repoId,
        "--scope", "changed-hunks",
        "--diff-file", patchPath,
        "--now", "2026-08-16T00:05:00.000Z",
        "--json"
      ]);
    } finally {
      if (previousEngineBin === undefined) delete process.env.DRIFT_ENGINE_BIN;
      else process.env.DRIFT_ENGINE_BIN = previousEngineBin;
    }
    expect(blocked.exitCode, `blocking check stderr:\n${blocked.stderr}`).toBe(2);
    const blockedPayload = JSON.parse(blocked.stdout);
    const blockedAuthorization = (blockedPayload.findings ?? []).filter(
      (finding: any) => finding.expected_layer === "authorization"
    );
    expect(
      blockedAuthorization.map((finding: any) => finding.evidence_refs[0].file_path).sort()
    ).toEqual([
      "app/api/audits/route.ts",
      "app/api/projects/route.ts",
      "app/api/reports/route.ts"
    ]);
    for (const finding of blockedAuthorization) {
      expect(finding.diff_status).toBe("new_in_diff");
      expect(finding.enforcement_result).toBe("block");
    }

    // --- inverse half, in the same run ---------------------------------------------------------
    // Both conformance routes are inside the accepted scope and carry a protected sink, so the
    // convention was evaluated over them and returned proven. The violating siblings above are the
    // evidence that "no finding" here means evaluated-and-passed rather than skipped.
    for (const route of ["app/api/members/route.ts", "app/api/invoices/route.ts"]) {
      expect(
        flaggedPaths(findings, AUTHORIZATION),
        `${route} guards its sink and must be silent`
      ).not.toContain(route);
    }
    const proofs = (run.checkPayload.security_boundary_proofs ?? []).filter((proof: any) =>
      (proof.contracts ?? []).some((contract: any) => contract.kind === AUTHORIZATION)
    );
    const provenPaths = proofs
      .filter((proof: any) => proof.authorization?.required === true && proof.authorization?.proven === true)
      .map((proof: any) => proof.route.file_path)
      .sort();
    expect(
      provenPaths,
      "a proof record for each conformance route is what distinguishes evaluated-and-passed from " +
        "never-reached; evaluation receipts do not exist in this codebase, so the proof payload is " +
        "the receipt"
    ).toEqual(["app/api/invoices/route.ts", "app/api/members/route.ts"]);
  }, 180000);

  it("phase-4 session-trust path fires through contract import", async () => {
    // THE CONTRACT-IMPORT CELL, and the one place in this file where the convention does not come
    // from the proposer — because for this kind there is no proposer to come from.
    // `candidate_command.rs` contains zero occurrences of
    // `ConventionKind::SessionObjectMustComeFromTrustedHelper`, so no candidate of this kind has
    // ever existed and `conventions accept` has nothing to accept. What DOES exist is
    // `drift contract import drift.lock --repo <id> --confirm` (docs/agent-integration.md:84,
    // router.ts:158, contract.ts:199) — a documented, user-reachable workflow. So the honest
    // statement about this cell is two-part, and the ledger says both halves:
    //
    //   the proposer emits nothing of this shape   (still true; pinned by the `unimplemented`
    //                                               test below, which keeps its two fixtures)
    //   the enforcement arm IS reachable and fires (this test)
    //
    // The second half falsifies the old evidence's claim that the arm "is unreachable through the
    // documented workflow". Import is a documented workflow.
    assertProposerScopeGlobs();

    const run = await runGtContractImportWorkflow({
      fixture: "gt-session-trust",
      importedKinds: [SESSION_TRUST],
      amendContract: (contract, { contractId, now }) => {
        // The fixture proposes nothing, so `start --accept-defaults` materialises an empty
        // contract. Asserting that keeps this from silently becoming a test of some other
        // convention that happened to be auto-accepted alongside.
        expect(contract.conventions).toHaveLength(0);
        contract.conventions.push({
          id: "convention_gt_session_trust",
          contract_id: contractId,
          kind: SESSION_TRUST,
          statement:
            "API route session objects must come from the accepted trusted helper, not from the request.",
          // The proposer's own scope, verbatim. This is what makes the mutation test meaningful:
          // every one of these globs is `**/`-prefixed, and the fixture's routes sit at the repo
          // root with zero leading segments, so `path_glob_matches` must handle the zero-segment
          // `**/` case or `security_phase4_findings_and_proofs` (check_command.rs:1610-1618)
          // filters every route out and this test sees nothing.
          scope: {
            path_globs: PROPOSER_ROUTE_SCOPE_GLOBS,
            file_roles: ["api_route"]
          },
          matcher: {
            kind: SESSION_TRUST,
            applies_to_file_roles: ["api_route"]
          },
          requires: {
            auth_helpers: [
              { symbol: "requireUser", import: "@/server/auth", behavior: "returns_session" }
            ]
          },
          severity: "error",
          // Block mode, accepted by the import: this kind is `deterministic_check`, so
          // `contractValidationReasons` has no objection. (The block-mode schema reject at
          // engine-contract/src/index.ts:411-423 is specific to candidate-sourced sensitive fields
          // and does not apply here.)
          enforcement_mode: "block",
          enforcement_capability: "deterministic_check",
          exceptions: [],
          evidence_refs: [],
          counterexample_refs: [],
          accepted_by: "gt-canary",
          accepted_at: now,
          updated_at: now
        });
        return contract;
      }
    });

    // The import is a real one: the CLI's own compatibility verdict, not the test's opinion.
    expect(run.dryRunExitCode, "the dry run must report the contract importable").toBe(0);
    expect(run.dryRunPayload.compatibility).toMatchObject({ compatible: true, reasons: [] });
    expect(run.importExitCode).toBe(0);
    expect(run.importPayload).toMatchObject({ imported: true, added_convention_count: 1 });

    // ── Violation half, with the blocking exit code. ────────────────────────────────────────────
    // Exit 2 needs `diff_status: "new_in_diff"` (run-check.ts:821), and `--scope full` classifies
    // every finding `touched_existing` by construction (diff.ts:diffStatusFor). So the blocking
    // assertion runs the way CI runs: a diff that introduces the routes, at changed-hunks scope.
    const routes = [
      "app/api/session/route.ts",
      "app/api/profile/route.ts",
      "app/api/trace/route.ts"
    ];
    const blocked = await run.check({
      scope: "changed-hunks",
      diff: addedFilesPatch(run.repoRoot, routes)
    });
    expect(blocked.exitCode, `check stderr:\n${blocked.stderr}`).toBe(2);

    const sessionFindings = blocked.payload.findings.filter(
      (finding: any) => finding.convention_id === "convention_gt_session_trust"
    );
    expect(sessionFindings).toHaveLength(1);
    expect(sessionFindings[0]).toMatchObject({
      title: "API route uses untrusted session object",
      expected_layer: "session_trust",
      actual_layer: "session_not_trusted",
      severity: "error",
      enforcement_result: "block",
      status: "new",
      diff_status: "new_in_diff"
    });
    // The file AND the line. Line 4 of the fixture is
    // `const session = request.headers.get("x-session-user");` — the session object being built
    // from an untrusted source, which is the whole claim of the kind.
    expect(sessionFindings[0].evidence_refs[0]).toMatchObject({
      file_path: "app/api/session/route.ts",
      start_line: 4
    });

    // ── Conformance half, and proof it was EVALUATED rather than skipped. ───────────────────────
    // The compliant sibling is silent, and the engine's own proof for it says why: the session
    // trust obligation was `required` for that route and `proven` on it. A skipped route emits no
    // proof at all, so this distinguishes "passed" from "never looked".
    const proofs = blocked.payload.security_boundary_proofs ?? [];
    const profileProof = proofs.find(
      (proof: any) => proof.route.file_path === "app/api/profile/route.ts"
    );
    expect(profileProof, "the compliant route must have been evaluated").toBeTruthy();
    expect(profileProof.session_trust).toMatchObject({ required: true, proven: true });
    expect(profileProof.session_trust.trusted_sessions[0]).toMatchObject({
      variable: "session",
      source: "auth_guard",
      trust: "trusted"
    });
    expect(profileProof.result).toMatchObject({ proof_status: "proven", enforcement_result: "pass" });

    // §4.3 near-miss: `app/api/trace/route.ts` reads from the SAME untrusted source into a
    // variable that is not a session. A check that flagged "route reads a request header" would
    // flag it; the real one does not.
    const flaggedFiles = sessionFindings.map(
      (finding: any) => finding.evidence_refs[0].file_path
    );
    expect(flaggedFiles).not.toContain("app/api/trace/route.ts");
    expect(flaggedFiles).not.toContain("app/api/profile/route.ts");

    // ── And the same verdict at full scope, where the glob filter is the only thing standing
    // between the convention and the routes. Exit 0 here is correct and is not a pass claim about
    // the violation: `--scope full` reports it as pre-existing debt rather than a new block.
    const full = await run.check({ scope: "full" });
    expect(
      flaggedPaths(readFindings(run.databasePath, run.repoId), SESSION_TRUST),
      "the violating route and only the violating route"
    ).toEqual(["app/api/session/route.ts"]);
    expect(full.payload.findings.map((finding: any) => finding.evidence_refs[0].file_path)).toEqual([
      "app/api/session/route.ts"
    ]);
  }, 180000);

  it("request-validation safeParse proof path fires", async () => {
    // The safeParse cell. Before this branch the proposer could infer a request-validation
    // convention from `safeParse` usage and a human could accept it, and the result proved nothing
    // and flagged the very routes it had been inferred from:
    //
    //   `push_request_validation_candidates` (candidate_command.rs) writes every inferred symbol
    //   into `requires.validators` and leaves `requires.schemas` empty, so `safeParse` arrived at
    //   the prover as `RequestValidatorKind::Helper`. The Helper arm
    //   (security_patterns.rs::accepted_request_validator_for_call) requires `call.value.is_none()`
    //   — a call with no receiver — and `SomeSchema.safeParse(body)` always has one. The Schema arm
    //   below it names "safeParse", but it matches the *schema* symbol, so nothing the proposer can
    //   emit ever reaches it. No `request_validation_called` fact, no validation, three findings on
    //   three routes, two of which were correct.
    //
    // So this test is a false-positive canary as much as a firing canary: the assertion that
    // tasks/notes are silent is the half that was failing.
    const run = await runGtWorkflow({
      fixture: "gt-request-validation",
      acceptKinds: [REQUEST_VALIDATION],
      severity: "error",
      mode: "block"
    });

    // Obtained from the proposer, never injected, and asserted in the exact shape whose kind
    // defaulted wrong: the method name under `validators`, with `schemas` empty.
    const candidates = (run.startPayload.candidates ?? []).filter(
      (candidate: any) => candidate.kind === REQUEST_VALIDATION
    );
    expect(candidates, "the proposer must emit the request-validation candidate").toHaveLength(1);
    expect(candidates[0].requires.validators.map((v: any) => v.symbol)).toEqual(["safeParse"]);
    expect(candidates[0].requires.schemas).toEqual([]);
    expect(run.acceptPayloads).toHaveLength(1);
    expect(run.acceptPayloads[0].accepted.enforcement_mode).toBe("block");

    // Violation half: the route that hands `await request.json()` straight to a data sink, and
    // only that route.
    const flagged = flaggedPaths(readFindings(run.databasePath, run.repoId), REQUEST_VALIDATION);
    expect(flagged).toEqual(["app/api/projects/route.ts"]);

    // ...at the sink line, not at a default. `sink_id` is `sink:{file}:{line}:{symbol}` while every
    // other id is `...:{line}`, so the shared parser read "create" as the line, failed, and every
    // request-validation finding ever emitted reported line 1.
    await assertListVisibility(run.databasePath, run.repoId, REQUEST_VALIDATION);

    const findings = (run.checkPayload.findings ?? []).filter(
      (finding: any) => finding.title === "API route uses unvalidated request input"
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].evidence_refs[0].file_path).toBe("app/api/projects/route.ts");
    expect(findings[0].evidence_refs[0].start_line).toBe(7);
    expect(findings[0].actual_layer).toBe("request_input_not_validated");
    expect(findings[0].enforcement_result).toBe("block");
    expect(findings[0].severity).toBe("error");

    // Conformance half, and the proof that the convention was EVALUATED on it rather than skipped:
    // both safeParse routes carry a request-validation proof that is `required` and `proven`, and
    // names the receiver as the schema. A skipped route would have no proof at all.
    const provenBySchema = new Map(
      (run.checkPayload.security_boundary_proofs ?? [])
        .filter((proof: any) => proof.proof_id.endsWith(":request_validation"))
        .map((proof: any) => [
          proof.route.file_path,
          {
            required: proof.request_validation.required,
            proven: proof.request_validation.proven,
            schemas: proof.request_validation.validations.map((v: any) => [
              v.validator_symbol,
              v.schema_symbol
            ])
          }
        ])
    );
    expect(provenBySchema.get("app/api/tasks/route.ts")).toEqual({
      required: true,
      proven: true,
      schemas: [["safeParse", "TaskInputSchema"]]
    });
    expect(provenBySchema.get("app/api/notes/route.ts")).toEqual({
      required: true,
      proven: true,
      schemas: [["safeParse", "NoteInputSchema"]]
    });
    expect(provenBySchema.get("app/api/projects/route.ts")).toEqual({
      required: true,
      proven: false,
      schemas: []
    });

    // The full-scope run exits 0, and that is NOT this cell's doing: `--scope full` counts a
    // finding as blocking only when its `diff_status` is `new_in_diff` (run-check.ts:821), and the
    // harness copies the fixture to a temp repo with no diff, so every full-scope finding is
    // `touched_existing`. Pinned so that if full-scope blocking is ever fixed, this says so.
    expect(run.checkExitCode).toBe(0);
    expect(run.checkPayload.summary.outcome.non_blocking_reasons).toContainEqual({
      reason: "full_scope_reports_existing_violations_without_blocking",
      count: 1
    });

    // ...and then take the blocking verdict properly, over the diff a pull request adding these
    // routes would produce. The convention was accepted `--mode block` and the finding already
    // carries `enforcement_result: block`, so exit 2 IS reachable for this kind — it just needs a
    // diff. Asserting only the 0 above would have been the weaker claim.
    const patchPath = join(run.stateRoot, "..", "request-validation.patch");
    writeFileSync(
      patchPath,
      addedFilesPatch(run.repoRoot, [
        "app/api/projects/route.ts",
        "app/api/tasks/route.ts",
        "app/api/notes/route.ts"
      ]),
      "utf8"
    );
    const blocked = await runCli([
      "--db", run.databasePath,
      "check",
      "--repo", run.repoId,
      "--scope", "changed-hunks",
      "--diff-file", patchPath,
      "--now", "2026-08-16T00:02:00.000Z",
      "--json"
    ]);
    expect(blocked.exitCode, `check stderr:\n${blocked.stderr}`).toBe(2);
    const blockedFindings = (JSON.parse(blocked.stdout).findings ?? []).filter(
      (finding: any) => finding.title === "API route uses unvalidated request input"
    );
    expect(blockedFindings).toHaveLength(1);
    expect(blockedFindings[0].evidence_refs[0].file_path).toBe("app/api/projects/route.ts");
    expect(blockedFindings[0].evidence_refs[0].start_line).toBe(7);
    expect(blockedFindings[0].diff_status).toBe("new_in_diff");
  }, 180000);

  it("phase-6 CORS policy path fires", async () => {
    const run = await runGtWorkflow({ fixture: "gt-cors-policy", acceptKinds: [CORS] });

    // The accepted policy is derived by the proposer from the repo's own declared origins.
    const candidate = (run.startPayload.candidates ?? []).find((c: any) => c.kind === CORS);
    expect(candidate, "the proposer must emit the CORS candidate").toBeTruthy();
    expect(candidate.requires.allowed_origins).toEqual(["https://app.example.com"]);

    const flagged = flaggedPaths(readFindings(run.databasePath, run.repoId), CORS);
    expect(flagged).toEqual(["app/api/public/route.ts"]);
    expect(flagged).not.toContain("app/api/partners/route.ts");
  }, 180000);

  it("phase-4 tenant-scope path fires, and the helper-scoped siblings pass", async () => {
    // The cell the ledger recorded as unreachable: "No fixture produces a candidate of this kind".
    // That was true and it was a fixture problem, not a proposer problem. `push_guard_candidate`
    // (candidate_command.rs:539/555) needs the SAME symbol called in >= 2 api-route facts and the
    // symbol has to survive `is_tenant_candidate_symbol`; every `security-tenant-*` fixture is one
    // route calling `requireUser`, which satisfies neither half.
    const run = await runGtWorkflow({
      fixture: "gt-tenant-scope",
      acceptKinds: [TENANT_SCOPE],
      severity: "error",
      mode: "block"
    });

    // The documented review surface hides this kind unless --experimental-security is passed.
    await assertListVisibility(run.databasePath, run.repoId, TENANT_SCOPE);

    // Obtained from the proposer, never injected, and exactly one — the near-miss below did not
    // also become a helper.
    const candidates = (run.startPayload.candidates ?? []).filter((c: any) => c.kind === TENANT_SCOPE);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].matcher.required_calls).toEqual(["requireTenantScope"]);
    expect(run.acceptPayloads, "the convention must come from the proposer").toHaveLength(1);

    // THE GLOB. This is the literal set the proposer emits, `**/` prefix and all, and it is what
    // phase 4 hands to `path_glob_matches` (check_command.rs:1614). Every assertion below is
    // downstream of that call returning true for `app/api/<x>/route.ts`; when the glob engine
    // reduced `**/app/api/**/route.ts` to `starts_with("**/app/api")` it returned false for all
    // five routes and this cell reported a clean pass over a rule that matched nothing.
    expect(candidates[0].scope.path_globs).toEqual([
      "**/app/api/**/route.ts",
      "**/app/api/**/route.tsx",
      "**/pages/api/**/*.ts"
    ]);

    // Violation half. `projects` does an unscoped `findMany`; `audits` and `exports` are the §4.3
    // near-miss — they call `throwIfTenantScopeMismatch`, whose name hits every substring
    // `is_tenant_candidate_symbol` tests for and which narrows nothing, so they must still be
    // flagged. Conformance half: the two routes that call the accepted helper are absent.
    const flagged = flaggedPaths(readFindings(run.databasePath, run.repoId), TENANT_SCOPE);
    expect(flagged).toEqual([
      "app/api/audits/route.ts",
      "app/api/exports/route.ts",
      "app/api/projects/route.ts"
    ]);

    // ...and absent because they were PROVEN, not because they were skipped. Both siblings carry a
    // phase-4 proof with `required: true`, so the arm ran on them and decided; a scope that failed
    // to match would have produced no proof at all.
    const tenantProofs = new Map<string, any>(
      (run.checkPayload.security_boundary_proofs ?? []).map((proof: any) => [
        proof.route.file_path,
        proof.tenant
      ])
    );
    for (const safe of ["app/api/invoices/route.ts", "app/api/reports/route.ts"]) {
      expect(tenantProofs.get(safe), `${safe} was never evaluated`).toMatchObject({
        required: true,
        proven: true
      });
    }
    expect(tenantProofs.get("app/api/projects/route.ts")).toMatchObject({
      required: true,
      proven: false
    });

    // The blocking exit code and the finding's file:line, over a diff (see `addedFilesPatch`).
    const routes = [
      "app/api/projects/route.ts",
      "app/api/invoices/route.ts",
      "app/api/reports/route.ts",
      "app/api/audits/route.ts",
      "app/api/exports/route.ts"
    ];
    const violatingDiff = join(run.stateRoot, "..", "violating.patch");
    await writeFile(violatingDiff, addedFilesPatch(run.repoRoot, routes));
    const blocked = await runCli([
      "--db", run.databasePath,
      "check",
      "--repo", run.repoId,
      "--scope", "changed-hunks",
      "--diff-file", violatingDiff,
      "--now", "2026-08-16T00:01:00.000Z",
      "--json"
    ]);
    expect(blocked.exitCode, `check stderr:\n${blocked.stderr}`).toBe(2);
    const blockedPayload = JSON.parse(blocked.stdout);
    const projects = (blockedPayload.findings ?? []).filter(
      (finding: any) => finding.evidence_refs?.[0]?.file_path === "app/api/projects/route.ts"
    );
    expect(projects).toHaveLength(1);
    expect(projects[0].title).toBe("API route missing required tenant scope proof");
    expect(projects[0].actual_layer).toBe("tenant_predicate_missing");
    expect(projects[0].enforcement_result).toBe("block");
    // app/api/projects/route.ts:4 — `const projects = await db.project.findMany();`, the one
    // unscoped sink in the fixture.
    expect(projects[0].evidence_refs[0].start_line).toBe(4);

    // Inverse half, as its own run: a diff touching ONLY the two helper-scoped routes, same repo,
    // same accepted convention, same CLI. Zero findings of this kind, exit 0.
    const safeDiff = join(run.stateRoot, "..", "safe.patch");
    await writeFile(
      safeDiff,
      addedFilesPatch(run.repoRoot, ["app/api/invoices/route.ts", "app/api/reports/route.ts"])
    );
    const clean = await runCli([
      "--db", run.databasePath,
      "check",
      "--repo", run.repoId,
      "--scope", "changed-hunks",
      "--diff-file", safeDiff,
      "--now", "2026-08-16T00:02:00.000Z",
      "--json"
    ]);
    expect(clean.exitCode, `check stderr:\n${clean.stderr}`).toBe(0);
    const cleanPayload = JSON.parse(clean.stdout);
    expect(
      (cleanPayload.findings ?? []).filter(
        (finding: any) => finding.title === "API route missing required tenant scope proof"
      )
    ).toEqual([]);
  }, 180000);
});

describe("cell canaries — unimplemented", () => {
  it("proposer emits no candidate of the unimplemented shapes", async () => {
    // What this test asserts, exactly: the PROPOSER emits nothing of these shapes. The fixtures
    // chosen are the ones built to exhibit each violation - if any shape were proposable at all,
    // these are the repos where it would be.
    //
    // What it does NOT assert, and used to be read as asserting: that the enforcement arm is
    // unreachable. Those are different claims, and for BOTH kinds still listed here the second one
    // is false — `drift contract import` reaches their arms and the arms fire, which "phase-5
    // secret-exposure path fires, reached by contract import" and "phase-4 session-trust path fires
    // through contract import" above now pin. Both cells are `firing` rather than `unimplemented`
    // as a result.
    //
    // Both cases nevertheless STAY in this list. The no-candidate half stayed true throughout and is
    // what makes import the ONLY route for these two kinds, and so what makes those canaries honest
    // rather than a way around `conventions accept`. Deleting either case would discard the half
    // that licenses the exception.
    const cases: Array<[string, string]> = [
      ["security-secret-leak", "api_route_forbids_secret_exposure"],
      ["security-session-from-request-untrusted", "session_object_must_come_from_trusted_helper"],
      ["security-session-trusted-helper", "session_object_must_come_from_trusted_helper"]
    ];

    for (const [fixture, kind] of cases) {
      const run = await runGtWorkflow({ fixture });
      const kinds = (run.startPayload.candidates ?? []).map((candidate: any) => candidate.kind);
      expect(
        kinds,
        `${fixture} proposed ${kind}. Both this kind's ledger cells rest on the evidence that the ` +
          `proposer emits nothing of this shape - "unimplemented" entirely, and "firing" for the ` +
          `part that justifies reaching the arm by contract import. That evidence is now false and ` +
          `the ledger row must be re-derived.`
      ).not.toContain(kind);
    }
  }, 300000);
});

describe("cell canaries — quarantined", () => {
  it("middleware_must_cover_routes is refused at acceptance, by name", async () => {
    // The quarantine's citation is packages/core/src/capabilities.ts's UNIMPLEMENTED_CONVENTION_KINDS,
    // and this is the "plus a test asserting it produces no findings" half. The refusal is the
    // stronger form of that: the convention cannot even be stored, so no clean pass can be reported
    // over a rule nothing evaluates.
    const run = await runGtWorkflow({ fixture: "security-middleware-covered" });
    const candidate = (run.startPayload.candidates ?? []).find((c: any) => c.kind === MIDDLEWARE);
    expect(candidate, "the proposer does emit this kind — that is why it is not `unimplemented`")
      .toBeTruthy();

    const { runCli } = await import("../../packages/cli/src/index.js");
    const accepted = await runCli([
      "--db",
      run.databasePath,
      "conventions",
      "accept",
      candidate.id,
      "--confirm",
      "--json"
    ]);
    expect(accepted.exitCode).toBe(1);
    expect(accepted.stderr).toContain(
      `Convention kind ${MIDDLEWARE} has no evaluator, so accepting it would enforce nothing while reporting a pass.`
    );

    // And therefore: no finding of this kind exists anywhere in the run.
    const findings = readFindings(run.databasePath, run.repoId);
    expect(findings.filter((finding) => finding.kind === MIDDLEWARE)).toHaveLength(0);
  }, 180000);
});

describe("ledger integrity", () => {
  it("every non-default state names a canary that exists in this file", () => {
    // The "a cell that changes state without a ledger edit fails CI" half, from the test side: a
    // state cannot be written into the ledger unless this file carries the artifact it requires.
    const titles = new Set(Object.values(CELLS_COVERED_HERE));
    const source = readFileSync(resolve("test/e2e/gt-canary.test.ts"), "utf8");
    for (const title of titles) {
      expect(source, `no test named "${title}" in this file`).toContain(`it("${title}"`);
    }

    for (const cell of LEDGER.cells) {
      if (cell.state === "needs-review") {
        expect(cell.canary, `${cell.id}: needs-review cells hold no evidence, so name no canary`).toBeNull();
        expect(
          cell.missing_evidence,
          `${cell.id}: every needs-review cell must record what evidence it lacked — that list is ` +
            `the next audit's worklist`
        ).toBeTruthy();
        continue;
      }
      expect(cell.canary, `${cell.id} is "${cell.state}" but names no canary`).toBeTruthy();
      const title = CELLS_COVERED_HERE[cell.id];
      expect(
        title,
        `${cell.id} is "${cell.state}" and its canary is not in this file. Either add it here, or ` +
          `the state is not one this branch holds evidence for.`
      ).toBeTruthy();
      expect(cell.canary).toContain(title);
      if (cell.state === "quarantined") {
        expect(
          cell.citation?.path,
          `${cell.id}: "quarantined" requires a located citation. A citation you cannot locate is ` +
            `not evidence — the state is "needs-review".`
        ).toBeTruthy();
      }
    }
  });

  it("every cited quarantine document actually exists at the cited path", () => {
    // The audit's own experience: the TDD cites `docs/architecture/security-heuristic-audit.md`,
    // which does not exist — the file is at docs/internal/architecture/. An unlocatable citation is
    // how a guess gets laundered into a checked-in fact, so the path is verified, not trusted.
    for (const cell of LEDGER.cells) {
      const path = cell.citation?.path;
      if (!path) continue;
      const filePath = path.replace(/:[0-9-]+$/, "");
      expect(() => readFileSync(resolve(filePath), "utf8"), `${cell.id} cites missing ${filePath}`)
        .not.toThrow();
    }
  });
});
