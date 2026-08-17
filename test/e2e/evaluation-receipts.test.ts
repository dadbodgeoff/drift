// Per-convention evaluation receipts, driven end to end through the documented workflow.
//
// WHAT THESE TESTS ARE ABOUT. Before receipts, three states produced byte-identical check output:
//
//   a. the convention ran and found nothing
//   b. the convention ran on zero inputs
//   c. the convention structurally cannot fire
//
// All three: `findings_count: 0`, `partial_coverage.complete: true`, `check.status: "pass"`,
// exit 0. Eight dead conventions shipped through that gap, and `partial_coverage` - the field that
// looks like it should have caught them - is keyed on FILE PATHS and has never reflected which
// conventions ran. Each test below pins one of the three states and, crucially, asserts it is
// DISTINGUISHABLE from the others rather than merely present.
//
// THE HARD RULE (TDD §4.1), same as gt-canary.test.ts: nothing here calls
// `storage.upsertAcceptedConvention` or hand-writes a contract. Every convention comes from the
// proposer and is accepted through `drift conventions accept`. A receipt asserted over an injected
// convention would prove the receipt struct serialises, which is not the claim.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runCli } from "../../packages/cli/src/index.js";
import { cleanupGtTempDirs, runGtWorkflow, withDebugEngine } from "./gt-harness.js";

afterEach(cleanupGtTempDirs);

const DATA_ACCESS = "api_route_no_direct_data_access";
const CORS = "api_route_cors_must_match_policy";

interface Receipt {
  convention_id: string;
  kind: string;
  dispatch: string;
  reached: boolean;
  inputs_considered: number;
  findings_emitted: number;
  skip_reason: string | null;
}

function receiptsOf(payload: any): Receipt[] {
  const receipts = payload?.summary?.evaluation_receipts;
  expect(
    Array.isArray(receipts),
    `summary.evaluation_receipts must be present on every check payload, unconditionally. ` +
      `An account of coverage that appears only when Drift already knows it has a problem is not ` +
      `an account. Got: ${JSON.stringify(payload?.summary?.evaluation_receipts)}`
  ).toBe(true);
  return receipts as Receipt[];
}

/**
 * A patch adding one file, so a check can be given a diff that touches a chosen path and nothing
 * else. Copied in shape from gt-canary.test.ts's helper; kept local because the two files assert
 * different things about the same fixtures and a shared helper would couple them.
 */
function addedFilePatch(path: string, body: string): string {
  const lines = body.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return [
    `diff --git a/${path} b/${path}`,
    "new file mode 100644",
    "--- /dev/null",
    `+++ b/${path}`,
    `@@ -0,0 +1,${lines.length} @@`,
    ...lines.map((line) => `+${line}`),
    ""
  ].join("\n");
}

describe("evaluation receipts — the three states are distinguishable", () => {
  it("a convention that ran and was satisfied is not a convention that never ran", async () => {
    // STATE (a), the positive control, and the half that makes every other assertion in this file
    // mean something. A receipt mechanism that reported `reached: false` for everything would pass
    // all the negative tests below and be worthless.
    const run = await runGtWorkflow({
      fixture: "gt-cors-policy",
      acceptKinds: [CORS]
    });
    const receipts = receiptsOf(run.checkPayload);
    expect(receipts).toHaveLength(1);
    expect(receipts[0].kind).toBe(CORS);
    expect(receipts[0].reached).toBe(true);
    expect(receipts[0].skip_reason).toBeNull();
    // The two route files of the fixture, and the one violation among them. Pinned as exact
    // numbers rather than `toBeGreaterThan(0)`: "the evaluator saw two files" is the claim, and a
    // receipt reporting 1 would mean half the scope went unexamined while still reading as
    // reached.
    expect(receipts[0].inputs_considered).toBe(2);
    expect(receipts[0].findings_emitted).toBe(1);
    expect(receipts[0].dispatch).toBe("engine_phase6");
  }, 300000);

  it("an accepted convention that cannot fire reports reached:false, not a clean pass", async () => {
    // STATE (c). `--mode off` is a documented, first-class acceptance mode - `drift conventions
    // accept --mode off` is listed in the CLI's own capability manifest - and a convention
    // accepted that way enforces nothing by design. That is fine. What was NOT fine is that the
    // resulting check was byte-identical to one where the convention ran and the repo was clean:
    // same `findings_count: 0`, same `partial_coverage.complete: true`, same `status: "pass"`,
    // same exit 0.
    //
    // The fixture is chosen so the difference is maximal: next-api-direct-db contains a real
    // violation of exactly this convention. At `--mode off` the check reports zero findings over a
    // repo that has one, and before this change nothing in the payload said why.
    const off = await runGtWorkflow({
      fixture: "next-api-direct-db",
      acceptKinds: [DATA_ACCESS],
      mode: "off"
    });
    expect(off.checkPayload.summary.findings_count).toBe(0);
    expect(off.checkPayload.check.status).toBe("pass");
    expect(off.checkExitCode).toBe(0);
    // ...and the receipt is the only thing in the payload that says the zero is not a clean bill
    // of health.
    const offReceipts = receiptsOf(off.checkPayload);
    expect(offReceipts).toHaveLength(1);
    expect(offReceipts[0].kind).toBe(DATA_ACCESS);
    expect(offReceipts[0].reached).toBe(false);
    expect(offReceipts[0].skip_reason).toBe("enforcement_mode_off");
    expect(offReceipts[0].findings_emitted).toBe(0);

    // THE DISTINGUISHABILITY CLAIM, made against the real comparison rather than asserted in the
    // abstract: the same fixture, the same kind, accepted at warn instead of off. Every field the
    // old payload had is the same in both runs; the receipts are opposite. If receipts ever stop
    // reflecting whether the evaluator ran, this is the assertion that fails.
    const on = await runGtWorkflow({
      fixture: "next-api-direct-db",
      acceptKinds: [DATA_ACCESS]
    });
    const onReceipts = receiptsOf(on.checkPayload);
    expect(onReceipts[0].reached).toBe(true);
    expect(onReceipts[0].skip_reason).toBeNull();
    expect(on.checkPayload.summary.partial_coverage.complete)
      .toBe(off.checkPayload.summary.partial_coverage.complete);
    expect(on.checkPayload.check.status).toBe(off.checkPayload.check.status);
  }, 300000);

  it("a run whose scope contains nothing for the convention reports zero inputs, not silence", async () => {
    // STATE (b). The convention is live, deterministic, unexpired and dispatched - and the diff
    // hands it nothing. Reported as a receipt rather than as an absence, because "I examined no
    // routes" and "I examined every route and they were fine" are different claims and only the
    // second licenses the pass.
    const run = await runGtWorkflow({
      fixture: "gt-cors-policy",
      acceptKinds: [CORS]
    });
    const readmePath = join(run.repoRoot, "NOTES.md");
    writeFileSync(readmePath, "# notes\n", "utf8");
    const patchPath = join(run.stateRoot, "..", "notes-only.patch");
    writeFileSync(patchPath, addedFilePatch("NOTES.md", "# notes\n"), "utf8");

    const scoped = await withDebugEngine(() =>
      runCli([
        "--db", run.databasePath,
        "check",
        "--repo", run.repoId,
        "--scope", "changed-hunks",
        "--diff-file", patchPath,
        "--now", "2026-08-16T02:00:00.000Z",
        "--json"
      ])
    );
    const payload = JSON.parse(scoped.stdout);
    expect(payload.summary.findings_count).toBe(0);
    const receipts = receiptsOf(payload);
    expect(receipts).toHaveLength(1);
    expect(receipts[0].kind).toBe(CORS);
    expect(receipts[0].inputs_considered).toBe(0);
    // `no_matching_files` and not `enforcement_mode_off`: the convention is in perfect health and
    // this particular diff is out of its scope, which is an ordinary outcome with an ordinary
    // reason. Conflating it with a dead convention would make the receipt cry wolf on every docs
    // commit.
    expect(receipts[0].skip_reason).toBe("no_matching_files");
    expect(receipts[0].reached).toBe(false);
  }, 300000);

  it("every accepted convention gets exactly one receipt, whatever the evaluators did", async () => {
    // The completeness property, and the reason the ledger is seeded from the contract rather than
    // assembled from what the evaluators reported. Building it the other way would put the silence
    // one level up: a convention no evaluator mentions would have no receipt at all, which is the
    // original defect wearing a new field name.
    const run = await runGtWorkflow({
      fixture: "next-api-direct-db",
      acceptKinds: [DATA_ACCESS, "api_route_requires_service_delegation"]
    });
    const receipts = receiptsOf(run.checkPayload);
    const accepted = run.acceptPayloads.map((payload: any) => payload.accepted.id).sort();
    expect(accepted.length).toBeGreaterThan(1);
    expect(receipts.map((receipt) => receipt.convention_id).sort()).toEqual(accepted);
    // Sorted by convention id, so two runs over one contract produce identical receipts and a
    // consumer can diff them.
    expect(receipts.map((receipt) => receipt.convention_id))
      .toEqual([...receipts.map((receipt) => receipt.convention_id)].sort());
  }, 300000);
});

describe("evaluation receipts — the human output", () => {
  it("names what enforced nothing, with the reason, on a run that reports zero findings", async () => {
    // The JSON carries every receipt because a machine should be able to ask "did rule X run"
    // without knowing the answer first. A human scanning a terminal cannot read twenty receipts,
    // so this is the one line: `Findings: 0` above it is compatible with both "everything ran and
    // was satisfied" and "nothing ran at all".
    const run = await runGtWorkflow({
      fixture: "next-api-direct-db",
      acceptKinds: [DATA_ACCESS],
      mode: "off"
    });
    const text = await withDebugEngine(() =>
      runCli([
        "--db", run.databasePath,
        "check",
        "--repo", run.repoId,
        "--scope", "full",
        "--now", "2026-08-16T02:00:00.000Z"
      ])
    );
    expect(text.exitCode, `check stderr:\n${text.stderr}`).toBe(0);
    expect(text.stdout).toContain("Findings: 0");
    expect(text.stdout).toContain("Enforced nothing: 1 of 1 convention(s) did not run");
    // The reason, not just the count. "no evaluator for this kind" and "nothing in this diff
    // matched" are the same silence with opposite remedies, and a bare count sends the reader to
    // the JSON to find out which one they have.
    expect(text.stdout).toContain("enforcement_mode_off");
    expect(text.stdout).toContain(run.acceptPayloads[0].accepted.id);
  }, 300000);

  it("says nothing extra when every convention ran", async () => {
    // The other half, and the one that keeps the line worth reading. A disclosure printed on every
    // run is a disclosure nobody reads, and this file would happily pass its other tests while
    // shouting on clean runs.
    const run = await runGtWorkflow({
      fixture: "gt-cors-policy",
      acceptKinds: [CORS]
    });
    const text = await withDebugEngine(() =>
      runCli([
        "--db", run.databasePath,
        "check",
        "--repo", run.repoId,
        "--scope", "full",
        "--now", "2026-08-16T02:00:00.000Z"
      ])
    );
    expect(text.stdout).not.toContain("Enforced nothing:");
  }, 300000);

  it("discloses a non-blocking contract on a zero-finding run, which is when it matters most", async () => {
    // `nonBlockingDisclosure` used to short-circuit on `findings.length === 0`, so the sentence
    // "this run exits 0 and will not fail CI" was suppressed exactly when a reader most needed it:
    // a green CI step from a warn-mode contract is indistinguishable, in a log, from a green CI
    // step from a contract that would have failed the build had there been anything to fail on.
    //
    // A whole-repo run of gt-cors-policy produces a finding, so the old code covered that case.
    // This is the one it did not: a diff containing only the fixture's CONFORMING route, so the
    // convention is evaluated, is satisfied, and reports nothing - the ordinary shape of almost
    // every check a team ever runs, and the shape whose exit 0 said least about what it proved.
    const run = await runGtWorkflow({
      fixture: "gt-cors-policy",
      acceptKinds: [CORS]
    });
    const conformingRoute = "app/api/partners/route.ts";
    const patchPath = join(run.stateRoot, "..", "conforming-only.patch");
    writeFileSync(
      patchPath,
      addedFilePatch(conformingRoute, readFileSync(join(run.repoRoot, conformingRoute), "utf8")),
      "utf8"
    );
    const text = await withDebugEngine(() =>
      runCli([
        "--db", run.databasePath,
        "check",
        "--repo", run.repoId,
        "--scope", "changed-hunks",
        "--diff-file", patchPath,
        "--now", "2026-08-16T02:00:00.000Z"
      ])
    );
    expect(text.exitCode, `check stderr:\n${text.stderr}`).toBe(0);
    expect(text.stdout).toContain("Findings: 0");
    // Not the "Enforced nothing" line - the convention DID run. This is the other sentence, and
    // the two must not be confused: one says coverage was missing, the other says coverage was
    // complete and toothless.
    expect(text.stdout).not.toContain("Enforced nothing:");
    expect(text.stdout).toContain("this run exits 0 and will not fail CI");
    expect(text.stdout).toContain("To make it a gate: drift conventions accept");
  }, 300000);
});
