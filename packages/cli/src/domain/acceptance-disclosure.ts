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
}

export function acceptanceDisclosure(input: {
  accepted: AcceptedConvention;
  repoId: string;
  baselinedCount: number;
}): AcceptanceDisclosure {
  const mode = input.accepted.enforcement_mode;
  const blocks = mode === "block";
  return {
    convention_id: input.accepted.id,
    convention_kind: input.accepted.kind,
    mode,
    severity: input.accepted.severity,
    baselined_count: input.baselinedCount,
    blocks_new_violations: blocks,
    upgrade_command: blocks
      ? null
      : `drift conventions accept ${input.accepted.id} --repo ${input.repoId} --severity error --mode block --confirm`
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
  return disclosure.upgrade_command
    ? [headline, `To make this a gate: ${disclosure.upgrade_command}`]
    : [headline];
}
