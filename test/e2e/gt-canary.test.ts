// Canary tests for the (convention kind × enforcement path) ledger (TDD §4.2, phase 0b).
//
// The ledger at test/canary/convention-cell-ledger.json declares one state per cell. This file is
// the evidence half: every cell the ledger calls `firing`, `unimplemented` or `quarantined` is
// backed by a test here, and the last test in this file asserts that correspondence both ways, so a
// state cannot be edited into the ledger without the artifact its state requires.
//
// THE ONE HARD RULE (§4.1). Nothing here calls `storage.upsertAcceptedConvention` and nothing hand-
// writes a `requires` block. Every convention is obtained from the proposer and accepted through
// `drift conventions accept`. Three existing tests of D1's kind inject their contract, and that is
// precisely why a P0 shipped under their coverage: a hand-built contract is not coverage for a
// convention kind, so a test that injects its convention cannot be evidence for `firing`.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertNoProposerFor,
  cleanupGtTempDirs,
  flaggedPaths,
  readFindings,
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
const SECRET_EXPOSURE = "api_route_forbids_secret_exposure";

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
 */
const PROPOSER_ROUTE_SCOPE_GLOBS = [
  "**/app/api/**/route.ts",
  "**/app/api/**/route.tsx",
  "**/pages/api/**/*.ts"
];

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
  "session_object_must_come_from_trusted_helper::phase4_proof":
    "proposer emits no candidate of the unimplemented shapes",
  "middleware_must_cover_routes::no_dispatch_arm":
    "middleware_must_cover_routes is refused at acceptance, by name",
  "api_route_forbids_sensitive_response_fields::phase5_proof":
    "phase-5 sensitive-response-fields path fires, on both provenance routes"
};

/**
 * A unified-diff stanza presenting a whole file as added, for `check --diff-file`.
 *
 * Only the hunk header matters to the classifier — `parse_hunk_new_start` plus the line count give
 * the changed line numbers — so the body is elided rather than duplicating the fixture, which would
 * silently rot the moment the fixture changed.
 */
function unifiedAddedFile(path: string, lineCount: number): string {
  return [
    `diff --git a/${path} b/${path}`,
    "new file mode 100644",
    "--- /dev/null",
    `+++ b/${path}`,
    `@@ -0,0 +1,${lineCount} @@`,
    ...Array.from({ length: lineCount }, () => "+"),
    ""
  ].join("\n");
}

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

      const flagged = flaggedPaths(readFindings(run.databasePath, run.repoId), SENSITIVE_FIELDS);
      expect(flagged, `${fixture}: the leaking route and only the leaking route`).toEqual([
        "pages/api/route-leak.ts"
      ]);
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
    const patch = [
      unifiedAddedFile("app/api/billing/route.ts", 4),
      unifiedAddedFile("app/api/webhooks/route.ts", 5),
      unifiedAddedFile("app/api/status/route.ts", 5)
    ].join("");

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
});

describe("cell canaries — unimplemented", () => {
  it("proposer emits no candidate of the unimplemented shapes", async () => {
    // `unimplemented` means the PROPOSER emits nothing of this shape, so the enforcement arm is
    // unreachable through the documented workflow no matter what it would do. The fixtures chosen
    // are the ones built to exhibit each violation - if any shape were proposable at all, these are
    // the repos where it would be.
    //
    // `api_route_forbids_secret_exposure` stays in this list even though its cell is now `firing`.
    // The two claims are separate and both true: the proposer emits nothing (this test), and the
    // enforcement arm nevertheless fires when a hand-authored contract is imported ("phase-5
    // secret-exposure path fires, reached by contract import" above). Deleting this case would
    // discard the half that makes the import path legitimate rather than a shortcut.
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
