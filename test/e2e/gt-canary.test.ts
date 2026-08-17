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
//
// THE ONE EXCEPTION, and it is narrow. Two kinds have no proposer at all —
// `candidate_command.rs` contains zero occurrences of `SessionObjectMustComeFromTrustedHelper` or
// `ApiRouteForbidsSecretExposure` — so there is no candidate to accept and the rule above cannot be
// satisfied for them by any test. For those, and only those, the convention arrives through the
// documented `drift contract import` workflow (docs/agent-integration.md), driven by
// `runGtContractImportWorkflow`, which asserts the proposer emitted nothing of the kind before it
// will import one. That is a different claim from the proposer path and the ledger evidence says so.

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  cleanupGtTempDirs,
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
const SESSION_TRUST = "session_object_must_come_from_trusted_helper";

/**
 * The proposer's literal emitted scope, `candidate_command.rs:371-373` and `:1009-1011`.
 *
 * Copied rather than imported because the engine is a separate process with no TypeScript export
 * of it — and pinned against the Rust source by `assertProposerScopeGlobs` below, so a drift
 * between the two fails here rather than quietly turning the import canary into a test of a scope
 * no candidate ever carries. A de-globbed scope without the leading globstar would pass under the
 * *reverted* `path_glob_matches`, which is exactly the fake this canary exists to rule out.
 */
const PROPOSER_ROUTE_SCOPE_GLOBS = [
  "**/app/api/**/route.ts",
  "**/app/api/**/route.tsx",
  "**/pages/api/**/*.ts"
];

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

/** A unified diff that introduces `paths` as new files, so every line is `new_in_diff`. */
function addedFilesDiff(repoRoot: string, paths: readonly string[]): string {
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
  // Not "unimplemented" any more, and the two words are not interchangeable. The proposer still
  // emits nothing of this shape — the test below keeps asserting exactly that, on both of its
  // fixtures — but "no proposer" is not "no reachable enforcement": `drift contract import` reaches
  // the arm, and the arm fires.
  "session_object_must_come_from_trusted_helper::phase4_proof":
    "phase-4 session-trust path fires through contract import",
  "middleware_must_cover_routes::no_dispatch_arm":
    "middleware_must_cover_routes is refused at acceptance, by name",
  "api_route_forbids_sensitive_response_fields::phase5_proof":
    "phase-5 sensitive-response-fields path fires, on both provenance routes"
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
      diff: addedFilesDiff(run.repoRoot, routes)
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
    // What this test asserts, exactly: the PROPOSER emits nothing of these shapes. The fixtures
    // chosen are the ones built to exhibit each violation - if any shape were proposable at all,
    // these are the repos where it would be.
    //
    // What it does NOT assert, and used to be read as asserting: that the enforcement arm is
    // unreachable. Those are different claims, and for
    // `session_object_must_come_from_trusted_helper` the second one is false — `drift contract
    // import` reaches its phase-4 arm and the arm fires, which "phase-4 session-trust path fires
    // through contract import" above now pins. The no-candidate half stayed true throughout and is
    // still worth holding down: it is what makes import the ONLY route, and so what makes the
    // import canary honest rather than a way around `conventions accept`.
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
