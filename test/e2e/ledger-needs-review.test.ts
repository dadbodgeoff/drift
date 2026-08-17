// `needs-review` is a passing ledger state, and this file is the measurement that decides whether
// it should stay one.
//
// The decision and its argument: docs/decisions/ledger-needs-review.md.
//
// WHAT `receipt_evidence` IS FOR. Each needs-review cell now records what `drift check`'s
// evaluation receipts say about its kind:
//
//   reached: true   an evaluator ran for a convention of this kind on the canary corpus
//   reached: false  a convention of this kind exists and its evaluator did not run
//   reached: null   no convention of this kind can be accepted here at all, so there is no receipt
//
// The third is strictly weaker than the second and is the state all six cells are in. That is the
// finding the strict flag is built on, and this file is what stops it becoming a claim in a JSON
// file that nobody re-derives: it drives the proposer over the fixtures each cell's own
// `missing_evidence` names and asserts the recorded value is still true of the code.
//
// THE HARD RULE (TDD §4.1): the candidates come from the proposer. This file never fabricates one -
// its whole subject is which candidates the proposer does and does not emit.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanupGtTempDirs, runGtWorkflow } from "./gt-harness.js";

afterEach(cleanupGtTempDirs);

interface Cell {
  id: string;
  kind: string;
  enforcement_path: string;
  state: string;
  receipt_evidence?: { reached: boolean | null; source: string; note: string };
}

const LEDGER = JSON.parse(
  readFileSync(resolve("test/canary/convention-cell-ledger.json"), "utf8")
) as { enforcement: Record<string, unknown>; cells: Cell[] };

const NEEDS_REVIEW = LEDGER.cells.filter((cell) => cell.state === "needs-review");

/**
 * The fixtures each needs-review cell's `missing_evidence` names as the place its kind would show
 * up if it showed up anywhere. Deliberately a small set rather than the whole 79-fixture corpus:
 * the sweep that produced `missing_evidence` is recorded there and does not need re-running every
 * CI, but the fixtures BUILT to exhibit each violation do - if any kind becomes proposable, it
 * becomes proposable here first.
 */
const PROBE_FIXTURES: Record<string, readonly string[]> = {
  api_route_requires_request_validation: ["gt-request-validation"],
  api_route_requires_rate_limit: ["security-rate-limit-missing"],
  api_route_forbids_untrusted_ssrf: ["security-ssrf", "security-ssrf-allowlist-pass"],
  api_route_forbids_raw_sql_without_params: ["security-raw-sql", "security-raw-sql-parameterized-pass"],
  api_route_requires_csrf_for_mutation: ["security-csrf-missing"]
};

describe("ledger needs-review evidence", () => {
  it("every needs-review cell records receipt evidence the strict flag can be judged on", () => {
    // The structural half, and the reason it is asserted here as well as in the gate: the gate
    // enforces on integration branches only, so on a track branch a cell could lose its evidence
    // and nothing would say so until merge.
    expect(NEEDS_REVIEW.length, "this file is about needs-review cells; there must be some").toBeGreaterThan(0);
    for (const cell of NEEDS_REVIEW) {
      expect(cell.receipt_evidence, `${cell.id}: no receipt_evidence recorded`).toBeTruthy();
      expect(
        [true, false, null],
        `${cell.id}: receipt_evidence.reached must be true, false or null - three distinct states, ` +
          `not a boolean with a gap`
      ).toContain(cell.receipt_evidence?.reached ?? null);
      expect(cell.receipt_evidence?.note, `${cell.id}: receipt evidence must say what it saw`)
        .toBeTruthy();
    }
  });

  it("declares the strict flag, default off, and names it where the gate reads it", () => {
    // The flip is a human call. What ships is the mechanism, and the mechanism has to be findable
    // from the ledger rather than only from the script that implements it.
    expect(LEDGER.enforcement.needs_review_strict_env).toBe("DRIFT_LEDGER_STRICT_NEEDS_REVIEW");
    expect(process.env.DRIFT_LEDGER_STRICT_NEEDS_REVIEW ?? "").not.toBe("1");
    expect(String(LEDGER.enforcement.needs_review_note)).toContain("Default OFF");
  });

  it("re-derives the `reached: null` claim from the proposer, on the fixtures built for it", async () => {
    // THE ANTI-STALENESS HALF. `receipt_evidence.reached: null` says "no convention of this shape
    // can be accepted on this corpus, so no receipt exists". That is a claim about today's
    // proposer, and a claim about code recorded in a JSON file is exactly the sort of thing that
    // quietly stops being true - the failure mode this whole ledger was built to prevent, applied
    // to the ledger itself.
    //
    // SHAPE, not kind. The ledger's unit is the PAIR (kind x enforcement path), because
    // `is_presence_convention` dispatches on `matcher.enforcement_semantics` BEFORE any kind arm -
    // so one kind reaches two different evaluators depending on which candidate the proposer
    // emitted. `api_route_requires_request_validation` is exactly that case here: its
    // `::request_validation_proof` cell is `firing` off a per-symbol candidate while its
    // `::presence_findings` cell is needs-review, and a kind-level probe would call the second one
    // stale on the strength of the first.
    //
    // If this test fails, the ledger is not wrong so much as OUT OF DATE, and the fix is a real
    // one: the shape became proposable, so the cell can be driven to a canary and should leave
    // needs-review.
    const probed = NEEDS_REVIEW.filter(
      (cell) =>
        PROBE_FIXTURES[cell.kind] && (cell.receipt_evidence?.reached ?? null) === null
    );
    expect(probed.length, "no needs-review cell has a probe fixture; the map has gone stale")
      .toBeGreaterThan(0);

    for (const cell of probed) {
      // `presence_findings` cells are reached only by a family candidate carrying
      // `enforcement_semantics: "presence"`; every other path is reached only by a candidate
      // WITHOUT it. That predicate is the whole (kind x path) distinction, in one line.
      const wantsPresence = cell.enforcement_path === "presence_findings";
      for (const fixture of PROBE_FIXTURES[cell.kind]) {
        const run = await runGtWorkflow({ fixture });
        const proposed = (run.startPayload.candidates ?? []).filter(
          (candidate: any) =>
            candidate.kind === cell.kind &&
            (candidate.matcher?.enforcement_semantics === "presence") === wantsPresence
        );
        expect(
          proposed,
          `${fixture} now proposes a ${wantsPresence ? "presence" : "per-symbol"} candidate of ` +
            `${cell.kind}. ${cell.id} records receipt_evidence.reached: null, meaning no ` +
            `convention of this shape can be accepted and no receipt exists to read. That is no ` +
            `longer true: accept the candidate, read the receipt, and re-derive the cell's state ` +
            `from what it says.`
        ).toHaveLength(0);
      }
    }
  }, 600000);
});
