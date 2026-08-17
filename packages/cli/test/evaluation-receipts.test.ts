import { describe, expect, it } from "vitest";

import {
  EvaluationReceiptLedger,
  silentConventionReceipts
} from "../src/check/evaluation-receipts.js";

/**
 * The ledger's four properties, each tested against the mistake it prevents.
 *
 * The e2e half (test/e2e/evaluation-receipts.test.ts) proves the receipts a real `drift check`
 * emits are true of that run. This half proves the ledger cannot be made to lie by the ORDER in
 * which evaluators happen to consult it - which is not observable end to end, because the order is
 * fixed there, and which is where the first real defect in this mechanism turned up.
 */
describe("evaluation receipt ledger", () => {
  it("keeps a receipt for a convention no evaluator ever mentions", () => {
    // THE PROPERTY THE WHOLE DESIGN RESTS ON. The ledger is seeded from the contract, so a
    // convention that every evaluator silently drops still ends the run with a receipt saying so.
    // Assembling the list from what the evaluators reported would move the silence up one level:
    // the twelve security kinds dropped at `fileSet.size === 0` would have had no receipt either,
    // and the payload would have been just as clean and just as wrong.
    const ledger = new EvaluationReceiptLedger();
    ledger.seed("convention_ghost", "api_route_requires_tenant_scope");

    const receipts = ledger.list();
    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toEqual({
      convention_id: "convention_ghost",
      kind: "api_route_requires_tenant_scope",
      dispatch: "engine_direct",
      reached: false,
      inputs_considered: 0,
      findings_emitted: 0,
      skip_reason: "not_dispatched_to_this_evaluator"
    });
  });

  it("seeds the correct reason immediately for a kind no evaluator will ever claim", () => {
    // A `none`-dispatch kind - e.g. a legacy accepted `middleware_must_cover_routes` or
    // `api_route_requires_service_delegation` convention from before acceptance-time refusal
    // existed (packages/cli/src/domain/convention-candidates.ts) - has no evaluator to call
    // `skipped()` on it, so the seeded reason is the only one it will ever get. Seeding it as
    // `not_dispatched_to_this_evaluator` said "not mine" from an evaluator that was never going
    // to own it regardless of what ran - the exact collapse SKIP_REASON_RANK exists to prevent,
    // just reintroduced one step earlier, at seed time instead of skip time.
    const ledger = new EvaluationReceiptLedger();
    ledger.seed("convention_legacy", "middleware_must_cover_routes");

    const receipts = ledger.list();
    expect(receipts).toHaveLength(1);
    expect(receipts[0].dispatch).toBe("none");
    expect(receipts[0].reached).toBe(false);
    expect(receipts[0].skip_reason).toBe("no_evaluator_for_kind");
  });

  it("does not let a later evaluator's 'not mine' erase the reason an earlier one gave", () => {
    // THE DEFECT THIS FILE EXISTS FOR, found by reading the receipts the mechanism produced. A
    // convention is offered to every evaluator and declined by all but at most one, and the last
    // few to look are always non-owning - so without an ordering, every skip reason in the payload
    // collapsed to `not_dispatched_to_this_evaluator`. A convention accepted at
    // `enforcement_mode: "off"` reported "not mine" from an evaluator that was never going to own
    // it, and the one evaluator that knew why said so first and was overwritten.
    const ledger = new EvaluationReceiptLedger();
    ledger.seed("convention_off", "api_route_no_direct_data_access");

    ledger.skipped("convention_off", "enforcement_mode_off");
    // Six further evaluators shrug at it, exactly as they do in run-check.
    for (let index = 0; index < 6; index += 1) {
      ledger.skipped("convention_off", "not_dispatched_to_this_evaluator");
    }

    expect(ledger.list()[0].skip_reason).toBe("enforcement_mode_off");
  });

  it("prefers the reason that survives any repo, diff or mode over one about this run", () => {
    // Rank, not recency. `no_evaluator_for_kind` is true whatever the repo contains;
    // `no_matching_files` is a statement about one diff. A reader who is told the second when the
    // first also holds goes off to fix their globs for a rule nothing implements.
    const ledger = new EvaluationReceiptLedger();
    ledger.seed("convention_dead", "custom_briefing");
    ledger.skipped("convention_dead", "no_matching_files");
    ledger.skipped("convention_dead", "no_evaluator_for_kind");
    expect(ledger.list()[0].skip_reason).toBe("no_evaluator_for_kind");

    // ...and the same pair applied in the opposite order gives the same answer, which is the point
    // of ranking rather than of ordering the call sites carefully.
    const reversed = new EvaluationReceiptLedger();
    reversed.seed("convention_dead", "custom_briefing");
    reversed.skipped("convention_dead", "no_evaluator_for_kind");
    reversed.skipped("convention_dead", "no_matching_files");
    expect(reversed.list()[0].skip_reason).toBe("no_evaluator_for_kind");
  });

  it("never lets a skip overwrite the fact that an evaluator ran", () => {
    // The direct data-access kind is evaluated by the engine and again over the graph, and the
    // auth loop shrugs at it afterwards. "It ran" is what happened; a later "not mine" describes a
    // different evaluator, not a different outcome.
    const ledger = new EvaluationReceiptLedger();
    ledger.seed("convention_live", "api_route_no_direct_data_access");
    ledger.ran("convention_live", { inputsConsidered: 3, findingsEmitted: 1 });
    ledger.skipped("convention_live", "no_evaluator_for_kind");

    const receipt = ledger.list()[0];
    expect(receipt.reached).toBe(true);
    expect(receipt.skip_reason).toBeNull();
  });

  it("sums inputs and findings across the evaluators that contribute to one convention", () => {
    const ledger = new EvaluationReceiptLedger();
    ledger.seed("convention_live", "api_route_no_direct_data_access");
    ledger.ran("convention_live", { inputsConsidered: 3, findingsEmitted: 1 });
    ledger.ran("convention_live", { inputsConsidered: 2, findingsEmitted: 4 });

    expect(ledger.list()[0]).toMatchObject({
      reached: true,
      inputs_considered: 5,
      findings_emitted: 5
    });
  });

  it("lets the engine downgrade a reached receipt, and never upgrade one", () => {
    // THE MERGE DIRECTION, and it is a safety property rather than a nicety. The CLI marks a
    // convention reached because it INVOKED the engine for it, which is one step short of the
    // truth: the engine has skips behind that invocation the CLI cannot see. So the engine's
    // `reached: false` wins.
    //
    // The converse must not hold. If an engine's `reached: true` could overwrite a CLI skip, an
    // engine reporting optimistically - or a stale binary, or a malformed result - could
    // manufacture coverage the CLI never observed, which is precisely the failure this mechanism
    // exists to detect. Downgrading can only ever make a run look less covered than claimed.
    const downgraded = new EvaluationReceiptLedger();
    downgraded.seed("convention_a", "api_route_requires_auth_helper");
    downgraded.ran("convention_a", { inputsConsidered: 4, findingsEmitted: 0 });
    downgraded.applyEngineReceipts([
      {
        convention_id: "convention_a",
        kind: "api_route_requires_auth_helper",
        reached: false,
        inputs_considered: 0,
        findings_emitted: 0,
        skip_reason: "engine_source_unavailable"
      }
    ]);
    expect(downgraded.list()[0]).toMatchObject({
      reached: false,
      skip_reason: "engine_source_unavailable"
    });

    const notUpgraded = new EvaluationReceiptLedger();
    notUpgraded.seed("convention_b", "api_route_requires_auth_helper");
    notUpgraded.skipped("convention_b", "no_matching_files");
    notUpgraded.applyEngineReceipts([
      {
        convention_id: "convention_b",
        kind: "api_route_requires_auth_helper",
        reached: true,
        inputs_considered: 99,
        findings_emitted: 7,
        skip_reason: null
      }
    ]);
    expect(notUpgraded.list()[0]).toMatchObject({
      reached: false,
      skip_reason: "no_matching_files",
      inputs_considered: 0,
      findings_emitted: 0
    });
  });

  it("takes a whole receipt for a convention only the engine knows about", () => {
    // Dropping it would reintroduce the silence one layer down: a convention the CLI never seeded
    // but the engine evaluated would vanish from the account entirely.
    const ledger = new EvaluationReceiptLedger();
    ledger.applyEngineReceipts([
      {
        convention_id: "convention_engine_only",
        kind: "api_route_cors_must_match_policy",
        reached: false,
        inputs_considered: 0,
        findings_emitted: 0,
        skip_reason: "capability_not_deterministic"
      }
    ]);
    expect(ledger.list()).toEqual([
      {
        convention_id: "convention_engine_only",
        kind: "api_route_cors_must_match_policy",
        dispatch: "engine_phase6",
        reached: false,
        inputs_considered: 0,
        findings_emitted: 0,
        skip_reason: "capability_not_deterministic"
      }
    ]);
  });

  it("answers 'none' for a kind the vocabulary does not know, rather than inventing a target", () => {
    const ledger = new EvaluationReceiptLedger();
    ledger.seed("convention_x", "a_kind_from_a_newer_engine");
    expect(ledger.list()[0].dispatch).toBe("none");
  });

  it("sorts by convention id, so one contract produces the same receipts twice", () => {
    const ledger = new EvaluationReceiptLedger();
    ledger.seed("convention_c", "file_role");
    ledger.seed("convention_a", "import_boundary");
    ledger.seed("convention_b", "module_placement");
    expect(ledger.list().map((receipt) => receipt.convention_id))
      .toEqual(["convention_a", "convention_b", "convention_c"]);
  });
});

describe("silentConventionReceipts", () => {
  it("reports both silences and puts the unreached ones first", () => {
    // Two states, kept apart because their fixes are different. `reached: false` is a rule that
    // never executed - a Drift or contract problem. `inputs_considered: 0` on a rule that DID
    // execute is usually an ordinary property of the diff. Collapsing them would hide the first
    // behind the second, and the first is the one that shipped eight dead conventions.
    const ledger = new EvaluationReceiptLedger();
    ledger.seed("convention_ran_on_nothing", "api_route_requires_auth_helper");
    ledger.seed("convention_never_ran", "custom_briefing");
    ledger.seed("convention_fine", "api_route_no_direct_data_access");
    ledger.ran("convention_ran_on_nothing", { inputsConsidered: 0, findingsEmitted: 0 });
    ledger.ran("convention_fine", { inputsConsidered: 5, findingsEmitted: 0 });
    ledger.skipped("convention_never_ran", "no_evaluator_for_kind");

    expect(silentConventionReceipts(ledger.list()).map((receipt) => receipt.convention_id))
      .toEqual(["convention_never_ran", "convention_ran_on_nothing"]);
  });

  it("says nothing about a convention that ran on real inputs and was satisfied", () => {
    // The half that keeps the human line worth reading: a disclosure printed on every run is one
    // nobody reads.
    const ledger = new EvaluationReceiptLedger();
    ledger.seed("convention_fine", "api_route_no_direct_data_access");
    ledger.ran("convention_fine", { inputsConsidered: 5, findingsEmitted: 0 });
    expect(silentConventionReceipts(ledger.list())).toEqual([]);
  });
});
