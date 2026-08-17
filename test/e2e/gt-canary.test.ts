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

import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  cleanupGtTempDirs,
  DEBUG_ENGINE,
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
const AUTHORIZATION = "api_route_requires_authorization";

// The proposer's literal route-scope glob set (candidate_command.rs, API_ROUTE_SCOPE_GLOBS).
//
// Pinned here because the authorization canary's whole point is that the accepted scope reaches the
// routes through `path_glob_matches` (check_command.rs:2793) rather than a prefix compare. The first
// glob matching `app/api/projects/route.ts` is the ZERO-SEGMENT double-star case: the leading
// double-star-slash consumes nothing at all. That is the case the historical bug got wrong — the
// pattern reduced to a `starts_with` over its own literal prefix and matched no file in any repo.
//
// This is a restatement of what the proposer emits, asserted for equality below. It is not a
// hand-written scope: nothing here is fed INTO the workflow.
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
 * A unified diff that adds `paths` verbatim, read out of the copied fixture so it cannot drift from
 * the files under test.
 *
 * Needed because `blockingCount` only counts `new_in_diff` findings, and `--scope full` classifies
 * everything `touched_existing`. Rather than assert a weaker exit code, the canary takes the
 * verdict over the diff that a pull request adding these routes would actually produce.
 */
function addedFilesPatch(repoRoot: string, paths: readonly string[]): string {
  return paths
    .map((path) => {
      const lines = readFileSync(join(repoRoot, path), "utf8").split("\n");
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

/** Cell ids this file claims to be the canary for. Kept beside the tests it names. */
const CELLS_COVERED_HERE: Record<string, string> = {
  "api_route_no_direct_data_access::materialized_and_graph":
    "data-access materialized+graph path fires",
  "api_route_requires_auth_helper::presence_findings":
    "presence path fires and the arm-3 intercept is real",
  "api_route_requires_auth_helper::auth_proof": "per-symbol auth proof path fires",
  "api_route_cors_must_match_policy::phase6_proof": "phase-6 CORS policy path fires",
  "api_route_forbids_secret_exposure::phase5_proof":
    "proposer emits no candidate of the unimplemented shapes",
  "session_object_must_come_from_trusted_helper::phase4_proof":
    "proposer emits no candidate of the unimplemented shapes",
  "middleware_must_cover_routes::no_dispatch_arm":
    "middleware_must_cover_routes is refused at acceptance, by name",
  "api_route_forbids_sensitive_response_fields::phase5_proof":
    "phase-5 sensitive-response-fields path fires, on both provenance routes",
  "api_route_requires_authorization::phase4_proof":
    "phase-4 authorization path fires over the proposer's own route globs"
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

      const flagged = flaggedPaths(readFindings(run.databasePath, run.repoId), SENSITIVE_FIELDS);
      expect(flagged, `${fixture}: the leaking route and only the leaking route`).toEqual([
        "pages/api/route-leak.ts"
      ]);
    }
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
        `${fixture} proposed ${kind}. The ledger declares this cell "unimplemented" on the ` +
          `evidence that the proposer emits nothing of this shape; that evidence is now false and ` +
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
