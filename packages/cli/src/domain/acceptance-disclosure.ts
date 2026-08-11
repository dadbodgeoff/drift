import type { AcceptedConvention } from "@drift/core";

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
    upgrade_command: string;
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
    review_command: string;
  }>;
}

export interface PresenceDeferral {
  candidate_id: string;
  convention_kind: string;
  coverage_ratio: number;
  evidence_file_count: number;
  below_floor_reason: "coverage" | "evidence_files" | "both" | null;
}

const upgradeCommand = (conventionId: string, repoId: string) =>
  `drift conventions accept ${conventionId} --repo ${repoId} --severity error --mode block --confirm`;

export function acceptanceDisclosure(input: {
  /** Absent when only presence families were accepted, which is possible from CV-5 on. */
  accepted?: AcceptedConvention;
  alsoAccepted?: AcceptedConvention[];
  deferred?: PresenceDeferral[];
  repoId: string;
  baselinedCount: number;
}): AcceptanceDisclosure {
  const alsoAccepted = input.alsoAccepted ?? [];
  const deferred = input.deferred ?? [];
  // The primary is the default convention when there is one, or the first accepted family when
  // acceptance was families only. The headline has to describe something real either way.
  const primary = input.accepted ?? alsoAccepted[0];
  const rest = input.accepted ? alsoAccepted : alsoAccepted.slice(1);
  const mode = primary.enforcement_mode;
  const blocks = mode === "block";
  return {
    convention_id: primary.id,
    convention_kind: primary.kind,
    mode,
    severity: primary.severity,
    baselined_count: input.baselinedCount,
    blocks_new_violations: blocks,
    upgrade_command: blocks ? null : upgradeCommand(primary.id, input.repoId),
    accepted_count: (input.accepted ? 1 : 0) + alsoAccepted.length,
    also_accepted: rest.map((convention) => ({
      convention_id: convention.id,
      convention_kind: convention.kind,
      mode: convention.enforcement_mode,
      blocks_new_violations: convention.enforcement_mode === "block",
      upgrade_command: upgradeCommand(convention.id, input.repoId)
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
  const count = disclosure.baselined_count;
  // The baseline clause is what makes the count actionable rather than trivia: it is the reason the
  // surrounding violations are not precedent (BB-5 carries the same sentence into the packet).
  const baselined = count > 0
    ? `${count} existing violation${count === 1 ? "" : "s"} baselined — `
    : "";
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
      `Also accepted "${also.convention_kind}" in ${also.mode.toUpperCase()} mode (${alsoConsequence}).`
    );
  }
  // A family that exists and was skipped is the thing a silent onboarding would hide, so it is named
  // with the number that decided it and the command to look at it.
  for (const deferred of disclosure.deferred_candidates) {
    const percent = `${Math.round(deferred.coverage_ratio * 1000) / 10}%`;
    const why =
      deferred.below_floor_reason === "evidence_files"
        ? `${deferred.evidence_file_count} evidence files`
        : deferred.below_floor_reason === "both"
          ? `${percent} coverage, ${deferred.evidence_file_count} evidence files`
          : `${percent} coverage`;
    lines.push(
      `1 candidate awaiting review: "${deferred.convention_kind}", ${why} — below the auto-accept floor. ` +
        `Review: ${deferred.review_command}`
    );
  }
  return lines;
}
