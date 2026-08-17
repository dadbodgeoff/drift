// `api_route_requires_service_delegation` accepts and enforces nothing — so it stops accepting.
//
// The decision and its full rationale: docs/decisions/service-delegation-capability.md. This file
// is the evidence half, and it is the canary the ledger's `quarantined` state requires.
//
// THE STATE THIS REPLACES. A user could run the documented workflow, accept this convention, and
// get a stored, listed, exportable rule that could not produce a finding on any repo, ever, while
// `drift check` reported `findings: 0`, `partial_coverage.complete: true`, `status: "pass"`,
// exit 0. Three independent blocks made it unreachable: both proposers stamp
// `enforcement_capability: "heuristic_check"` where the engine's loop requires
// `deterministic_check`; `run-check.ts` contains zero occurrences of the kind, so the engine was
// never invoked for it at all; and the evaluator took `_allowed_delegate_imports` and never read
// it, so the matcher's only configurable field had no effect.
//
// THE HARD RULE (TDD §4.1) applies here as everywhere: the candidate comes from the proposer. That
// matters more than usual for this test, because the claim is precisely about the proposer-to-
// acceptance seam - a hand-built candidate would prove nothing about what a user can actually do.

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runCli } from "../../packages/cli/src/index.js";
import { cleanupGtTempDirs, runGtWorkflow, withDebugEngine } from "./gt-harness.js";

afterEach(cleanupGtTempDirs);

const SERVICE_DELEGATION = "api_route_requires_service_delegation";

// The ledger canary for this cell lives in test/e2e/gt-canary.test.ts
// ("api_route_requires_service_delegation is refused at acceptance, by name"), because the ledger
// integrity check requires a non-default state's canary to be in that file. What is here is the
// rest of the evidence: the OTHER door into storage, and the coverage the removed arm duplicated.
describe("api_route_requires_service_delegation fails closed", () => {
  it("cannot be reached through contract import either", async () => {
    // `conventions accept` is not the only door. `drift contract import` installs a hand-authored
    // contract, and it is the documented, user-reachable path that two other kinds reach their
    // enforcement arms through - so a refusal covering only acceptance would be a fence with a
    // gate beside it.
    //
    // Driven through the real export -> amend -> import round trip rather than a fabricated
    // envelope, so every compatibility check a user's own contract has to satisfy applies here.
    const run = await runGtWorkflow({
      fixture: "next-api-direct-db",
      acceptKinds: ["api_route_no_direct_data_access"]
    });
    const exported = await withDebugEngine(() =>
      runCli(["--db", run.databasePath, "contract", "export", "--repo", run.repoId, "--confirm", "--json"])
    );
    expect(exported.exitCode, `export stderr:\n${exported.stderr}`).toBe(0);
    const contract = JSON.parse(exported.stdout).contract;

    contract.conventions.push({
      ...contract.conventions[0],
      id: `${contract.conventions[0].id}_delegation`,
      kind: SERVICE_DELEGATION,
      matcher: { kind: SERVICE_DELEGATION, allowed_delegate_imports: ["**/services/**"] }
    });
    const contractPath = join(run.stateRoot, "..", "with-delegation.json");
    writeFileSync(contractPath, JSON.stringify(contract, null, 2), "utf8");

    const dryRun = await withDebugEngine(() =>
      runCli(["--db", run.databasePath, "contract", "import", contractPath, "--repo", run.repoId, "--dry-run", "--json"])
    );
    const verdict = JSON.parse(dryRun.stdout);
    expect(verdict.compatibility.compatible).toBe(false);
    // The reason, by name. `compatible: false` alone would be satisfied by a fingerprint mismatch
    // or a schema bump, neither of which is the claim.
    expect(verdict.compatibility.reasons).toContain("convention_kind_has_no_evaluator");
  }, 300000);

  it("leaves the layering wedge it duplicated intact and firing", async () => {
    // The reason option (a) - "make it deterministic" - was rejected. The rule that arm would have
    // built is the rule `api_route_no_direct_data_access` already enforces: a route module
    // importing a data-access module. That kind is the ledger's only `firing` layering cell, and
    // it flags this fixture's route.
    //
    // Asserted here, in the file that removes the other kind, because "we deleted a dead rule" and
    // "we deleted a rule and lost coverage" look identical in a diff.
    const run = await runGtWorkflow({
      fixture: "next-api-direct-db",
      acceptKinds: ["api_route_no_direct_data_access"]
    });
    expect(run.checkPayload.summary.findings_count).toBe(1);
    expect(run.checkPayload.findings[0].evidence_refs[0].file_path)
      .toBe("apps/web/app/api/users/route.ts");

    // ...and the receipt says the surviving convention actually ran, rather than that it happened
    // to be quiet.
    const receipts = run.checkPayload.summary.evaluation_receipts;
    expect(receipts).toHaveLength(1);
    expect(receipts[0].kind).toBe("api_route_no_direct_data_access");
    expect(receipts[0].reached).toBe(true);
    expect(receipts[0].findings_emitted).toBe(1);
  }, 300000);
});
