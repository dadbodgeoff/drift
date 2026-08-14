import type { AcceptedConvention, PresenceDeferralReason } from "@drift/core";

/**
 * BB-3: what `--accept-defaults` actually decided, said out loud.
 *
 * Verified at b5c3c230: accepting dub's default lands `enforcement_mode: "warn"` (397 pre-existing
 * violations, so `baseline_coverage_direction` reads the convention as an aspiration), while
 * cal.com's lands `"block"`. Both printed the identical line - `"Accepted default convention."` - so
 * a dub user who believed they had installed a gate had installed a suggestion box, and nothing in
 * the output disagreed with them.
 *
 * It is not a cosmetic gap. Ten agent trials on 2026-08-03 (Q9/Q19) show agents read warn mode as
 * "not a real rule" and defect from it, which means the mode is the single most load-bearing fact
 * about an accepted convention and was the one fact the acceptance output omitted.
 *
 * This module only *describes* the decision. The decision itself - which mode a candidate earns -
 * belongs to `baseline_coverage_direction` in the engine and must not move because of this item.
 */
export interface AcceptanceDisclosure {
  convention_id: string;
  /**
   * The convention's kind, which is what the sentence names. Accepted ids are content hashes
   * (`convention_c8a97e3d4e5490d8`) and tell a reader nothing about what was accepted; the id still
   * appears in `upgrade_command`, where it is the argument the CLI actually needs.
   */
  convention_kind: string;
  mode: AcceptedConvention["enforcement_mode"];
  severity: AcceptedConvention["severity"];
  baselined_count: number;
  /**
   * T-05: how many of `baselined_count` belong to each accepted kind.
   *
   * The total was printed inside the sentence about the primary convention, so on dub the auth
   * family's 87 violations were credited to data-access and the family itself was given no number.
   * Keyed by kind rather than convention id, because the id is a content hash and the reader is
   * matching this against the kind named in the sentence above it.
   */
  baselined_by_kind: Record<string, number>;
  /** Whether a *new* violation in changed code exits non-zero. The user's actual question. */
  blocks_new_violations: boolean;
  /** Present only in warn mode: the exact command that turns the suggestion into a gate. */
  upgrade_command: string | null;
  /**
   * CV-5: the other conventions acceptance decided about, because from this item on a repo can onboard
   * with more than one. `accepted_count` is what the headline reports, and it is the number a reader
   * uses to decide whether onboarding did what they expected.
   */
  accepted_count: number;
  also_accepted: Array<{
    convention_id: string;
    convention_kind: string;
    mode: AcceptedConvention["enforcement_mode"];
    blocks_new_violations: boolean;
    /** T-12: null when this convention can never take `--mode block`. */
    upgrade_command: string | null;
  }>;
  /**
   * Families that did NOT clear the auto-acceptance floor. Left as candidates for a human, and named
   * here with their coverage and the command to review them - a family that exists and was skipped is
   * exactly the thing a silent onboarding would hide.
   */
  deferred_candidates: Array<{
    candidate_id: string;
    convention_kind: string;
    coverage_ratio: number;
    evidence_file_count: number;
    below_floor_reason: "coverage" | "evidence_files" | "both" | null;
    /**
     * T-04: which of the four causes held this family back. `families_flag_not_set` means it
     * qualified and the flag was off - a different problem from any floor, with a different fix.
     */
    deferred_reason: PresenceDeferralReason;
    review_command: string;
  }>;
}

export interface PresenceDeferral {
  candidate_id: string;
  convention_kind: string;
  coverage_ratio: number;
  evidence_file_count: number;
  below_floor_reason: "coverage" | "evidence_files" | "both" | null;
  deferred_reason: PresenceDeferralReason;
}

const upgradeCommand = (conventionId: string, repoId: string) =>
  `drift conventions accept ${conventionId} --repo ${repoId} --severity error --mode block --confirm`;

export function acceptanceDisclosure(input: {
  /** Absent when only presence families were accepted, which is possible from CV-5 on. */
  accepted?: AcceptedConvention;
  /**
   * T-12: conventions that can never take `--mode block`, by id.
   *
   * The upgrade command is suppressed for these. Printing "To make this a gate: ... --mode block"
   * for a convention whose acceptance preflight rejects that exact flag hands the user an
   * instruction the tool refuses - measured exiting 1 with "Only deterministic conventions can use
   * --mode block."
   */
  nonBlockableConventionIds?: string[];
  alsoAccepted?: AcceptedConvention[];
  deferred?: PresenceDeferral[];
  repoId: string;
  baselinedCount: number;
  /** T-05: baseline rows created, per convention id, from the pass that created them. */
  baselinedByConvention?: Record<string, number>;
}): AcceptanceDisclosure {
  const alsoAccepted = input.alsoAccepted ?? [];
  const deferred = input.deferred ?? [];
  // The primary is the default convention when there is one, or the first accepted family when
  // acceptance was families only. The headline has to describe something real either way.
  const primary = input.accepted ?? alsoAccepted[0];
  const rest = input.accepted ? alsoAccepted : alsoAccepted.slice(1);
  const mode = primary.enforcement_mode;
  const blocks = mode === "block";
  const nonBlockable = new Set(input.nonBlockableConventionIds ?? []);
  const upgradeFor = (convention: AcceptedConvention): string | null =>
    convention.enforcement_mode === "block" || nonBlockable.has(convention.id)
      ? null
      : upgradeCommand(convention.id, input.repoId);
  // Convention ids are what the baseline counts by; kinds are what the disclosure talks about.
  //
  // Left EMPTY when the caller supplied no breakdown, rather than filled with zeros. A map of
  // zeros is indistinguishable from a real breakdown at the point of use, so it would silently
  // report "0 baselined" for every convention instead of falling back to the total.
  const byConvention = input.baselinedByConvention;
  const baselinedByKind: Record<string, number> = {};
  if (byConvention) {
    for (const convention of [...(input.accepted ? [input.accepted] : []), ...alsoAccepted]) {
      baselinedByKind[convention.kind] =
        (baselinedByKind[convention.kind] ?? 0) + (byConvention[convention.id] ?? 0);
    }
  }
  return {
    convention_id: primary.id,
    convention_kind: primary.kind,
    mode,
    severity: primary.severity,
    baselined_count: input.baselinedCount,
    baselined_by_kind: baselinedByKind,
    blocks_new_violations: blocks,
    upgrade_command: upgradeFor(primary),
    accepted_count: (input.accepted ? 1 : 0) + alsoAccepted.length,
    also_accepted: rest.map((convention) => ({
      convention_id: convention.id,
      convention_kind: convention.kind,
      mode: convention.enforcement_mode,
      blocks_new_violations: convention.enforcement_mode === "block",
      upgrade_command: upgradeFor(convention)
    })),
    deferred_candidates: deferred.map((entry) => ({
      ...entry,
      review_command: `drift conventions show ${entry.candidate_id} --repo ${input.repoId}`
    }))
  };
}

/**
 * The human lines. Written as full sentences on purpose: the failure mode here is a user forming a
 * belief about enforcement from an output that never contradicted it, and a mode word alone
 * ("WARN") does not contradict anything.
 */
export function acceptanceDisclosureLines(disclosure: AcceptanceDisclosure): string[] {
  // T-05: this convention's own baselined count, not the run's total.
  //
  // The clause is what makes the number actionable rather than trivia - it is the reason the
  // surrounding violations are not precedent (BB-5 carries the same sentence into the packet) -
  // and a total credited to one kind answers a question nobody asked. Falls back to the total
  // when no breakdown is present, so a caller that predates the field still reads sensibly.
  const baselinedClause = (kind: string): string => {
    const byKind = disclosure.baselined_by_kind ?? {};
    const count = Object.keys(byKind).length > 0
      ? byKind[kind] ?? 0
      : disclosure.baselined_count;
    return count > 0
      ? `${count} existing violation${count === 1 ? "" : "s"} baselined — `
      : "";
  };
  const baselined = baselinedClause(disclosure.convention_kind);
  const consequence = disclosure.blocks_new_violations
    ? "new violations exit 2"
    : "new violations will be reported but will NOT block";
  // The mode's own name, not a two-way summary: `off` and `brief` are also non-blocking, and telling
  // a user they accepted "WARN mode" when they accepted `brief` would be a new version of this bug.
  const modeWord = disclosure.mode.toUpperCase();
  const headline = `Accepted "${disclosure.convention_kind}" in ${modeWord} mode (${baselined}${consequence}).`;
  const lines = [headline];
  if (disclosure.upgrade_command) {
    lines.push(`To make this a gate: ${disclosure.upgrade_command}`);
  }
  // CV-5: one line per additional convention rather than a combined summary. Four conventions in one
  // sentence is a wall, and the mode is per-convention - the fact a reader most needs is which of them
  // will actually fail a build.
  for (const also of disclosure.also_accepted) {
    const alsoConsequence = also.blocks_new_violations
      ? "new violations exit 2"
      : "reported, will NOT block";
    lines.push(
      `Also accepted "${also.convention_kind}" in ${also.mode.toUpperCase()} mode ` +
        `(${baselinedClause(also.convention_kind)}${alsoConsequence}).`
    );
  }
  // A family that exists and was skipped is the thing a silent onboarding would hide, so it is named
  // with the number that decided it and the command to look at it.
  for (const deferred of disclosure.deferred_candidates) {
    const percent = `${Math.round(deferred.coverage_ratio * 1000) / 10}%`;
    // T-04: a family held back by a flag is not a family that failed a floor, and must not be
    // described as one. Sending a user to improve coverage that is already above the floor is a
    // worse outcome than saying nothing - the number quoted is real, so the advice reads credible.
    if (deferred.deferred_reason === "families_flag_not_set") {
      lines.push(
        `1 candidate ready but not accepted: "${deferred.convention_kind}", ${percent} coverage ` +
          `across ${deferred.evidence_file_count} files — it clears the auto-accept floor. ` +
          `Pass --accept-families to accept it, or review it first: ${deferred.review_command}`
      );
      continue;
    }
    const why =
      deferred.deferred_reason === "below_evidence_floor"
        ? `${deferred.evidence_file_count} evidence files`
        : deferred.deferred_reason === "below_both"
          ? `${percent} coverage, ${deferred.evidence_file_count} evidence files`
          : `${percent} coverage`;
    lines.push(
      `1 candidate awaiting review: "${deferred.convention_kind}", ${why} — below the auto-accept floor. ` +
        `Review: ${deferred.review_command}`
    );
  }
  return lines;
}
