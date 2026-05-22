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
  candidates: ConventionCandidate[];
}): string {
  const rows = payload.candidates.length > 0
    ? payload.candidates.flatMap((candidate) => [
        `${candidate.id}`,
        `  Kind: ${candidate.kind}`,
        `  Status: ${candidate.status}`,
        `  Capability: ${candidate.enforcement_capability}`,
        `  Suggested: ${candidate.suggested_severity}/${candidate.suggested_enforcement_mode}`,
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
    `Confidence: ${candidate.confidence_label}`,
    `Scope: ${candidate.scope.path_globs.join(", ") || "none"}`,
    `File roles: ${candidate.scope.file_roles?.join(", ") || "none"}`,
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
