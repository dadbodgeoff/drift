import { conventionDispatchFor,type ConventionDispatch } from "@drift/core";

/**
 * What `check` actually did with each convention, said per convention.
 *
 * THE PROBLEM. Three states were indistinguishable in a check payload:
 *
 *   a. the convention ran and found nothing
 *   b. the convention ran on zero inputs
 *   c. the convention structurally cannot fire
 *
 * All three emitted `findings: 0`, `partial_coverage.complete: true`, `status: pass`, exit 0.
 * Eight dead conventions shipped through that gap. `partial_coverage` looks like the field that
 * should have caught it and is not: its reasons are keyed on FILE PATHS - a changed file missing
 * from the worktree, a contract target the scan never indexed - so it answers "which files did
 * Drift fail to read", and nothing in it reflects which CONVENTIONS ran. A contract of twelve
 * accepted conventions, none of which was reached, is `complete: true` by that measure and always
 * was.
 *
 * THE RECEIPT. One per convention on the contract, emitted whether or not the convention did
 * anything, carrying the four facts that separate the three states above:
 *
 *   reached            an evaluator executed for this convention
 *   inputs_considered  how many units it was handed (files, or facts where the evaluator is
 *                      fact-scoped) - 0 with `reached: true` is state (b)
 *   findings_emitted   how many findings came back
 *   skip_reason        why not, when `reached` is false - state (c), by name
 *
 * WHY `dispatch` IS ON IT. `reached: false` on a `none`-dispatch kind and `reached: false` on an
 * `engine_direct` kind are different problems: the first is a kind nothing implements, the second
 * is an implemented kind that this run did not enter. Carrying the target from
 * vocabulary/vocabulary.json - the same table the engine's exhaustive match and the parity gate
 * read - means the receipt cannot disagree with where the code actually sends the kind.
 *
 * A receipt is NOT a finding and never affects the verdict. It reports what was examined, on the
 * same principle as `Checked N files`: an honest account of coverage is what makes a pass worth
 * reading, and the pass itself is decided elsewhere.
 */
export interface EvaluationReceipt {
  /** The accepted convention, or the agent contract, this receipt is about. */
  convention_id: string;
  kind: string;
  /** Where the vocabulary says this kind is evaluated. */
  dispatch: ConventionDispatch;
  /** An evaluator ran for this convention in this check. */
  reached: boolean;
  /**
   * Units handed to the evaluator - files for the file-scoped evaluators, facts for the
   * fact-scoped ones. Zero with `reached: true` is the "ran on nothing" state, which is a real
   * outcome and not a clean one.
   */
  inputs_considered: number;
  findings_emitted: number;
  /**
   * Why the evaluator did not run. Null exactly when `reached` is true, so the two can never
   * describe different runs.
   */
  skip_reason: string | null;
}

/**
 * The reasons an evaluator declines a convention, as a closed set.
 *
 * Closed rather than free text because these are read by machines - the human summary counts them,
 * `security audit` derives proof-backing from them, and the ledger gate will key on them. A
 * free-text reason would be a fifth spelling of "no matching files" within two sprints.
 */
export type EvaluationSkipReason =
  /** The vocabulary sends this kind nowhere: accepting it enforces nothing. */
  | "no_evaluator_for_kind"
  /** `enforcement_mode: "off"`. Deliberately inert, and still worth a receipt. */
  | "enforcement_mode_off"
  /** Past `expires_at`. The convention has lapsed rather than been removed. */
  | "convention_expired"
  /**
   * The evaluator requires `deterministic_check` and this convention declares something weaker,
   * so the arm is unreachable for it no matter what the repo contains.
   */
  | "capability_not_deterministic"
  /** Nothing in scope matched: the evaluator would have run on an empty input set. */
  | "no_matching_files"
  /** The kind is evaluated, but not by the evaluator that owns this dispatch target. */
  | "not_dispatched_to_this_evaluator"
  /** The engine's evaluator reads route source from disk and no repo_root was supplied. */
  | "engine_source_unavailable";

/**
 * How much each reason tells you, so the most informative one survives.
 *
 * A convention is offered to every evaluator in turn and declined by all but at most one. Without
 * an ordering the LAST evaluator to look wins, and since the last few are always non-owning, every
 * skip reason in the payload collapsed to `not_dispatched_to_this_evaluator` - a convention
 * accepted at `enforcement_mode: "off"` reported "not mine" from an evaluator that was never going
 * to own it, and the one evaluator that knew why said so first and was overwritten. Caught by
 * reading the receipts this mechanism produces, which is the argument for producing them.
 *
 * `not_dispatched_to_this_evaluator` therefore ranks lowest: it is the seeded default and the
 * absence of an opinion. It means something only when it survives every evaluator, which is
 * exactly the case it is there to report - a kind nothing claims.
 */
const SKIP_REASON_RANK: Record<EvaluationSkipReason, number> = {
  // Nothing anywhere evaluates this kind. Beats every other explanation, because the convention
  // could not have been enforced under any repo, mode or diff.
  no_evaluator_for_kind: 5,
  // The convention's own configuration makes it inert. True regardless of what the repo contains,
  // so it outranks anything derived from this particular run.
  enforcement_mode_off: 4,
  convention_expired: 4,
  capability_not_deterministic: 4,
  // Environmental: the evaluator exists and would have run given what it needed.
  engine_source_unavailable: 3,
  // The owning evaluator ran the gauntlet and had nothing in scope. A statement about this diff.
  no_matching_files: 2,
  not_dispatched_to_this_evaluator: 1
};

/**
 * The run's receipts, one per convention, assembled as the evaluators go.
 *
 * SEEDED UP FRONT, from the contract rather than from the evaluators. That ordering is the whole
 * point: an evaluator that never mentions a convention cannot suppress its receipt, because the
 * receipt already exists and says `reached: false`. Building the list from what the evaluators
 * reported would reproduce the original defect one level up - the twelve security kinds dropped at
 * `fileSet.size === 0` would simply have had no receipt either.
 */
export class EvaluationReceiptLedger {
  private readonly receipts = new Map<string, EvaluationReceipt>();

  /**
   * Declare a convention, before any evaluator has had a chance to skip it.
   *
   * The seeded state is the pessimistic one - not reached, nothing considered, and a skip reason
   * saying no evaluator claimed it. An evaluator that runs overwrites it; one that never looks
   * leaves the truth in place.
   */
  seed(conventionId: string, kind: string): void {
    if (this.receipts.has(conventionId)) {
      return;
    }
    const dispatch = conventionDispatchFor(kind);
    this.receipts.set(conventionId, {
      convention_id: conventionId,
      kind,
      dispatch,
      reached: false,
      inputs_considered: 0,
      findings_emitted: 0,
      // A `none`-dispatch kind has no evaluator to skip it, so `skipped()` is never called for it
      // and the seeded reason is the only one it will ever get. Seeding it as
      // `not_dispatched_to_this_evaluator` said "not mine" from an evaluator that was never going
      // to own it regardless - the exact collapse SKIP_REASON_RANK exists to prevent, just done at
      // seed time instead of at skip time.
      skip_reason: dispatch === "none" ? "no_evaluator_for_kind" : "not_dispatched_to_this_evaluator"
    });
  }

  /**
   * An evaluator declined this convention, and why.
   *
   * Two things it will not do. It will not overwrite a `reached: true` receipt - a convention is
   * offered to every evaluator and skipped by all but one, and the one that ran is what happened.
   * And it will not replace a more informative reason with a less informative one, per
   * SKIP_REASON_RANK: order of evaluation is an implementation detail, and the reason a reader
   * gets should not depend on it.
   */
  skipped(conventionId: string, reason: EvaluationSkipReason): void {
    const receipt = this.receipts.get(conventionId);
    if (!receipt || receipt.reached) {
      return;
    }
    const current = receipt.skip_reason as EvaluationSkipReason | null;
    const currentRank = current ? SKIP_REASON_RANK[current] ?? 0 : 0;
    if (SKIP_REASON_RANK[reason] < currentRank) {
      return;
    }
    receipt.skip_reason = reason;
  }

  /**
   * An evaluator ran for this convention, on this many inputs, producing this many findings.
   *
   * Additive, because two evaluators legitimately contribute to one convention (the direct
   * data-access kind is materialized by the engine and again over the graph), and because the
   * engine-owned paths call the engine once per convention inside a loop. `reached` latches true
   * and `skip_reason` clears with it: a run that happened is not also a skip.
   */
  ran(conventionId: string, input: { inputsConsidered: number; findingsEmitted: number }): void {
    const receipt = this.receipts.get(conventionId);
    if (!receipt) {
      return;
    }
    receipt.reached = true;
    receipt.skip_reason = null;
    receipt.inputs_considered += input.inputsConsidered;
    receipt.findings_emitted += input.findingsEmitted;
  }

  /**
   * Fold in what the engine reported about the conventions it was handed.
   *
   * DOWNGRADE ONLY, and deliberately so. The CLI marks a convention `reached` because it invoked
   * the engine for it - which is the CLI's honest view and one step short of the truth, because
   * the engine has skips of its own behind that invocation: a kind whose dispatch is not the
   * engine's, a security evaluator whose route source it could not read. Only the engine knows
   * whether its arm executed, so its `reached: false` overrides, and its `reached: true` adds
   * nothing the caller has not already recorded.
   *
   * The direction matters: a merge that could upgrade would let an engine that reports optimistically
   * manufacture coverage the CLI never observed, which is the failure this whole mechanism exists to
   * detect. Downgrading can only ever make the run look less covered than claimed.
   *
   * A receipt naming a convention the ledger has never seen is taken whole - that is a convention
   * only the engine knows about, and dropping it would reintroduce the silence one layer down.
   */
  applyEngineReceipts(
    engineReceipts: ReadonlyArray<{
      convention_id: string;
      kind: string;
      reached: boolean;
      inputs_considered: number;
      findings_emitted: number;
      skip_reason: string | null;
    }>
  ): void {
    for (const engineReceipt of engineReceipts) {
      const known = this.receipts.get(engineReceipt.convention_id);
      if (!known) {
        this.receipts.set(engineReceipt.convention_id, {
          convention_id: engineReceipt.convention_id,
          kind: engineReceipt.kind,
          dispatch: conventionDispatchFor(engineReceipt.kind),
          reached: engineReceipt.reached,
          inputs_considered: engineReceipt.inputs_considered,
          findings_emitted: engineReceipt.findings_emitted,
          skip_reason: engineReceipt.reached ? null : engineReceipt.skip_reason
        });
        continue;
      }
      if (engineReceipt.reached) {
        continue;
      }
      known.reached = false;
      known.skip_reason = engineReceipt.skip_reason ?? known.skip_reason;
    }
  }

  /** Sorted by convention id, so two runs over the same contract produce byte-identical receipts. */
  list(): EvaluationReceipt[] {
    return [...this.receipts.values()].sort((left, right) =>
      left.convention_id.localeCompare(right.convention_id)
    );
  }
}

/**
 * The receipts a reader needs to be told about, in the order that matters.
 *
 * `reached: false` first, because a convention that never ran is a stronger claim than one that
 * ran on nothing - the second at least proves the wiring works. Both are "this convention did not
 * enforce anything on this run", which is what the summary line exists to say.
 */
export function silentConventionReceipts(receipts: readonly EvaluationReceipt[]): EvaluationReceipt[] {
  return receipts
    .filter((receipt) => !receipt.reached || receipt.inputs_considered === 0)
    .sort((left, right) =>
      Number(left.reached) - Number(right.reached) ||
      left.convention_id.localeCompare(right.convention_id)
    );
}
