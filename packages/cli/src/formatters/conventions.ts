import type { ConventionCandidate,ConventionKind,ConventionStatus,EnforcementCapability,EvidenceRef } from "@drift/core";
import { conventionCandidateSummary } from "../domain/convention-candidates.js";
import { preflightGovernance } from "../domain/governance.js";

export function formatConventionCandidatesText(payload: {
  repo_id: string;
  status: ConventionStatus | "all";
  filters: { status: ConventionStatus | null; kind: ConventionKind | null; capability: EnforcementCapability | null };
  governance: ReturnType<typeof preflightGovernance>;
  summary: ReturnType<typeof conventionCandidateSummary>;
  pagination: {
    limit: number | null;
    offset: number;
    returned_count: number;
    has_more: boolean;
    next_offset: number | null;
  };
  next_commands: string[];
  // A7/T25: the two withholding decisions, rendered rather than reported only in JSON.
  low_confidence: {
    hidden_count: number;
    included: boolean;
    floor: { min_coverage_ratio: number };
    reveal_command: string;
  };
  experimental_security: {
    hidden_count: number;
    included: boolean;
    reason: string;
    reveal_command: string;
  };
  candidates: ConventionCandidate[];
}): string {
  const rows = payload.candidates.length > 0
    ? payload.candidates.flatMap((candidate) => [
        `${candidate.id}`,
        `  Kind: ${candidate.kind}`,
        `  Status: ${candidate.status}`,
        `  Capability: ${candidate.enforcement_capability}`,
        `  Suggested: ${candidate.suggested_severity}/${candidate.suggested_enforcement_mode}`,
        `  Not blocking: ${candidate.reason_not_blocking ?? "n/a"}`,
        `  Confidence: ${candidate.confidence_label}`,
        `  Evidence refs: ${candidate.evidence_refs.length}; counterexamples: ${candidate.counterexample_refs.length}`,
        `  Statement: ${candidate.statement}`,
        `  Accept: drift conventions accept ${candidate.id} --severity ${candidate.suggested_severity} --mode ${candidate.suggested_enforcement_mode} --confirm`,
        ""
      ])
    : ["  none"];

  return [
    "Drift convention candidates",
    "",
    `Repo: ${payload.repo_id}`,
    `Status: ${payload.status}`,
    `Kind: ${payload.filters.kind ?? "all"}`,
    `Capability: ${payload.filters.capability ?? "all"}`,
    `Candidates: ${payload.summary.listed_count} returned, ${payload.summary.filtered_count} filtered, ${payload.summary.total_count} total`,
    ...withheldCandidateLines(payload),
    `Page: offset ${payload.pagination.offset}, returned ${payload.pagination.returned_count}, next offset ${payload.pagination.next_offset ?? "none"}`,
    `Governance: ${payload.governance.read_only ? "read-only" : "mutable"}; human approval required for mutations`,
    "",
    ...rows,
    "Next commands:",
    ...payload.next_commands.map((command) => `  ${command}`),
    "",
    ""
  ].join("\n");
}

/**
 * The candidates this listing withheld, and how to see them.
 *
 * A7 gave `conventions list` a coverage floor and T25 quarantined the experimental security kinds.
 * Both wrote their count and their exact reveal command into the JSON payload and neither reached
 * the human formatter, so on a real repo the text surface printed
 * `Candidates: 0 returned, 0 filtered, 35 total` and stopped - a reader could see that 35 existed
 * and had no way to learn why none of them were shown or what to type next. The withholding is
 * defensible; withholding it silently is not, and "never truncate silently" was A7's own rule.
 *
 * Printed directly under the counts rather than at the end, because the line it explains is the
 * count, and an explanation a page away from the number it explains is one a reader has to go
 * looking for.
 */
function withheldCandidateLines(payload: {
  low_confidence: { hidden_count: number; floor: { min_coverage_ratio: number }; reveal_command: string };
  experimental_security: { hidden_count: number; reveal_command: string };
}): string[] {
  const lines: string[] = [];
  const lowConfidence = payload.low_confidence.hidden_count;
  if (lowConfidence > 0) {
    const floor = `${Math.round(payload.low_confidence.floor.min_coverage_ratio * 100)}%`;
    lines.push(
      `Hidden: ${lowConfidence} low-confidence candidate${lowConfidence === 1 ? "" : "s"} ` +
        `below the ${floor} coverage floor.`,
      `  Show them: ${payload.low_confidence.reveal_command}`
    );
  }
  const security = payload.experimental_security.hidden_count;
  if (security > 0) {
    lines.push(
      `Hidden: ${security} experimental security candidate${security === 1 ? "" : "s"}; ` +
        "the security heuristics are experimental and are not proofs.",
      `  Show them: ${payload.experimental_security.reveal_command}`
    );
  }
  return lines;
}

export function formatConventionCandidateText(payload: {
  candidate: ConventionCandidate;
  governance: ReturnType<typeof preflightGovernance>;
  next_commands: string[];
}): string {
  const { candidate } = payload;
  return [
    "Drift convention candidate",
    "",
    `ID: ${candidate.id}`,
    `Repo: ${candidate.repo_id}`,
    `Kind: ${candidate.kind}`,
    `Status: ${candidate.status}`,
    `Capability: ${candidate.enforcement_capability}`,
    `Suggested: ${candidate.suggested_severity}/${candidate.suggested_enforcement_mode}`,
    `Not blocking: ${candidate.reason_not_blocking ?? "n/a"}`,
    `Confidence: ${candidate.confidence_label}`,
    `Scope: ${candidate.scope.path_globs.join(", ") || "none"}`,
    `File roles: ${candidate.scope.file_roles?.join(", ") || "none"}`,
    // CV-2: which route flavours this convention is about. Printed only when it is conditioned,
    // because "all of them" is the absence of a condition rather than a value - and a reviewer
    // deciding whether to accept has to be able to see that a family excludes cron routes.
    ...(candidate.matcher.applies_to_route_flavors?.length
      ? [`Route flavors: ${candidate.matcher.applies_to_route_flavors.join(", ")}`]
      : []),
    `Forbidden imports: ${candidate.matcher.forbidden_imports?.join(", ") || "none"}`,
    `Required calls: ${candidate.matcher.required_calls?.join(", ") || "none"}`,
    `Delegate imports: ${candidate.matcher.allowed_delegate_imports?.join(", ") || "none"}`,
    `Governance: ${payload.governance.read_only ? "read-only" : "mutable"}; human approval required for mutations`,
    "",
    "Statement:",
    `  ${candidate.statement}`,
    "",
    "Evidence:",
    `  supporting examples: ${candidate.scoring.supporting_examples_count}`,
    `  counterexamples: ${candidate.scoring.counterexamples_count}`,
    `  scope files: ${candidate.scoring.scope_files_count}`,
    `  heuristic: ${candidate.scoring.heuristic_id}`,
    ...evidenceLocationLines("  evidence", candidate.evidence_refs),
    ...evidenceLocationLines("  counterexample", candidate.counterexample_refs),
    "",
    "Next commands:",
    ...payload.next_commands.map((command) => `  ${command}`),
    ""
  ].join("\n");
}

export function evidenceLocationLines(label: string, refs: EvidenceRef[]): string[] {
  if (refs.length === 0) {
    return [];
  }
  return refs.slice(0, 5).map((ref) =>
    `${label}: ${ref.file_path}${ref.start_line ? `:${ref.start_line}` : ""}` +
      `${ref.import_source ? ` ${ref.import_source}` : ""}` +
      `${ref.symbol ? ` (${ref.symbol})` : ""}`
  );
}
