import type { AcceptedConvention } from "./domain.js";

/**
 * Structural inputs rather than a CLI type, because both the CLI packet and the MCP packet build
 * this view and neither package can import the other's shapes. Sharing the builder is the point:
 * two implementations of the packet's headline view is how the EW-6 `stored_fact_count` parity
 * failure happened.
 */
export interface GuidanceInputConvention {
  id: string;
  kind: string;
  statement: string;
  scope: AcceptedConvention["scope"];
  matcher: AcceptedConvention["matcher"];
  enforcement_mode: AcceptedConvention["enforcement_mode"];
  migration_sentence: string | null;
  conforming_examples: Array<{ file_path: string; role: string | null }>;
  conforming_examples_reason: string | null;
  rationale: { derivation: string; reason: string | null };
}

export interface GuidanceInputFile {
  path: string;
  reasons: string[];
}

export interface GuidanceInputCheck {
  command: string;
  reason?: string;
}

export interface GuidanceInputGap {
  code?: string;
  kind?: string;
}

/**
 * BB-6: one view of the packet an agent can actually eat.
 *
 * Measured composition of the 901,730-byte dub packet (compact JSON, 2026-08-03):
 * `parser_gaps` 358,538 B in 639 full records, `selected_conventions` 187,369 B (of which 186,252
 * was the same 397 findings the envelope already carries), `graph_context` 167,801 B, `findings`
 * 94,486 B. The agent-usage trial used **2 of 9 sections**; `semantic_coverage`, `parser_gaps`,
 * `route_flows` and `risky_areas` were all dismissed as noise by the consumer they exist for. The
 * useful core measured 25-40 KB.
 *
 * So this is a filtering job, not a compression job. `guidance` is the filter: what to do, which
 * files matter, what will block, what to run, and - the part nothing else in the packet says - what
 * Drift has no opinion about. The full envelope stays intact for audit; nothing here is the only
 * copy of anything.
 *
 * The 32 KB ceiling is asserted in bytes on every eval repo, including cal.com with its ~2,500
 * parser gaps, because the EW-8 lesson is that only byte assertions force real fixes.
 */
export const GUIDANCE_BYTE_BUDGET = 32_768;

export interface GuidanceConvention {
  id: string;
  kind: string;
  statement: string;
  scope: AcceptedConvention["scope"];
  matcher: AcceptedConvention["matcher"];
  mode: AcceptedConvention["enforcement_mode"];
  /** The question a reader actually has, answered rather than implied by `mode`. */
  will_this_block: boolean;
  migration_sentence: string | null;
  conforming_examples: Array<{ file_path: string; role: string | null }>;
  conforming_examples_reason: string | null;
  reason: string | null;
}

export interface GuidanceView {
  schema_version: "drift.guidance.v1";
  conventions: GuidanceConvention[];
  relevant_files: Array<{ path: string; reason: string }>;
  required_checks: Array<{ command: string; reason: string }>;
  /**
   * BB-6: what Drift has no opinion on, said out loud - the AK-2 seed.
   *
   * An agent handed a list of rules reasonably infers the list is exhaustive, and then treats
   * silence as approval. This is one line saying that silence is silence.
   */
  not_covered: string;
  parser_gaps: {
    count: number;
    by_code: Array<{ code: string; count: number }>;
    full_list_command: string;
  };
  truncated: {
    conventions: boolean;
    relevant_files: boolean;
    required_checks: boolean;
  };
}

const MAX_GUIDANCE_RELEVANT_FILES = 20;
const MAX_GUIDANCE_REQUIRED_CHECKS = 12;
const MAX_GUIDANCE_GAP_CODES = 3;

export function buildGuidanceView(input: {
  repoId: string;
  conventions: GuidanceInputConvention[];
  relevantFiles: GuidanceInputFile[];
  requiredChecks: GuidanceInputCheck[];
  parserGaps: GuidanceInputGap[];
}): GuidanceView {
  const relevantFiles = input.relevantFiles.slice(0, MAX_GUIDANCE_RELEVANT_FILES).map((file) => ({
    path: file.path,
    // The ranking reason, not the file's whole record: `roles`, `risk`, evidence and graph links all
    // live in `relevant_files` on the envelope for anyone who wants them.
    reason: file.reasons[0] ?? "ranked_for_task"
  }));
  const requiredChecks = input.requiredChecks
    .slice(0, MAX_GUIDANCE_REQUIRED_CHECKS)
    .map((check) => ({ command: check.command, reason: check.reason ?? "required_for_changed_files" }));

  return {
    schema_version: "drift.guidance.v1",
    conventions: input.conventions.map((convention) => ({
      id: convention.id,
      kind: convention.kind,
      statement: convention.statement,
      scope: convention.scope,
      matcher: convention.matcher,
      mode: convention.enforcement_mode,
      // Stated as a boolean because the trials showed agents inferring it wrongly from the mode word:
      // warn mode was read as "not a real rule", which is right about blocking and wrong about the
      // rule.
      will_this_block: convention.enforcement_mode === "block",
      migration_sentence: convention.migration_sentence,
      conforming_examples: convention.conforming_examples,
      conforming_examples_reason: convention.conforming_examples_reason,
      reason: convention.rationale.reason
    })),
    relevant_files: relevantFiles,
    required_checks: requiredChecks,
    not_covered: notCoveredSentence(input.conventions),
    parser_gaps: {
      count: input.parserGaps.length,
      by_code: topGapCodes(input.parserGaps),
      // The records themselves stay reachable rather than being deleted - 639 of them on dub, which
      // is a work list, not packet content.
      full_list_command: `drift doctor --repo ${input.repoId} --json`
    },
    truncated: {
      conventions: false,
      relevant_files: input.relevantFiles.length > relevantFiles.length,
      required_checks: input.requiredChecks.length > requiredChecks.length
    }
  };
}

function topGapCodes(gaps: GuidanceInputGap[]): Array<{ code: string; count: number }> {
  const counts = new Map<string, number>();
  for (const gap of gaps) {
    const code = gap.code ?? gap.kind ?? "unknown";
    counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  return [...counts.entries()]
    // Count descending, then code ascending: a total order, because eval:determinism byte-compares.
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, MAX_GUIDANCE_GAP_CODES)
    .map(([code, count]) => ({ code, count }));
}

function notCoveredSentence(conventions: GuidanceInputConvention[]): string {
  if (conventions.length === 0) {
    return (
      "Drift has no accepted convention for this repo yet, so it has no opinion on any of this task. " +
      "Nothing here has been checked; run drift conventions list to see what it could enforce."
    );
  }
  const kinds = [...new Set(conventions.map((convention) => convention.kind))].sort();
  return (
    `Drift enforces only ${kinds.length === 1 ? "this kind" : `these ${kinds.length} kinds`} of rule here: ` +
    `${kinds.join(", ")}. ` +
    "Everything else - naming, error handling, test style, performance, security beyond the listed " +
    "matchers - is uncovered: Drift's silence about it is silence, not approval."
  );
}
