import type { Finding,FindingDiffStatus,FindingStatus,Severity } from "@drift/core";
import { reviewFinding } from "../domain/findings.js";

export function formatFindingsText(payload: {
  repo_id: string;
  summary: {
    total_count: number;
    filtered_count: number;
    by_status: Partial<Record<FindingStatus, number>>;
    by_severity: Partial<Record<Severity, number>>;
    by_diff_status: Partial<Record<FindingDiffStatus, number>>;
  };
  pagination: {
    limit: number | null;
    offset: number;
    returned_count: number;
    has_more: boolean;
    next_offset: number | null;
  };
  findings: Finding[];
}): string {
  const rows = payload.findings.length > 0
    ? payload.findings.map((finding) =>
        `${finding.id} ${finding.severity}/${finding.enforcement_result} ${finding.status} ${finding.diff_status} ${findingLocation(finding)} - ${finding.title}`
      )
    : ["  none"];

  return [
    "Drift findings",
    "",
    `Repo: ${payload.repo_id}`,
    `Total: ${payload.summary.total_count}`,
    `Filtered: ${payload.summary.filtered_count}`,
    `Returned: ${payload.pagination.returned_count}`,
    `Offset: ${payload.pagination.offset}`,
    `Limit: ${payload.pagination.limit ?? "none"}`,
    `Next offset: ${payload.pagination.next_offset ?? "none"}`,
    `Statuses: ${formatCounts(payload.summary.by_status)}`,
    `Severities: ${formatCounts(payload.summary.by_severity)}`,
    `Diff: ${formatCounts(payload.summary.by_diff_status)}`,
    "",
    "Findings:",
    ...rows.map((row) => `  ${row}`),
    ""
  ].join("\n");
}

export function formatFindingShowText(payload: {
  repo_id: string;
  review_item: ReturnType<typeof reviewFinding>;
  finding: Finding;
  next_commands: string[];
}): string {
  return [
    "Drift finding",
    "",
    `Repo: ${payload.repo_id}`,
    `Finding: ${payload.finding.id}`,
    `Convention: ${payload.finding.convention_id}`,
    `Severity: ${payload.finding.severity}/${payload.finding.enforcement_result}`,
    `Status: ${payload.finding.status}`,
    `Diff: ${payload.finding.diff_status}`,
    `Location: ${findingLocation(payload.finding)}`,
    "",
    payload.finding.title,
    payload.finding.message,
    "",
    "Evidence:",
    ...(payload.finding.evidence_refs.length > 0
      ? payload.finding.evidence_refs.map((evidence) =>
          `  ${evidence.file_path}:${evidence.start_line ?? "?"}${evidence.import_source ? ` import:${evidence.import_source}` : ""}${evidence.symbol ? ` symbol:${evidence.symbol}` : ""}`
        )
      : ["  none"]),
    "",
    "Next commands:",
    ...payload.next_commands.map((command) => `  ${command}`),
    ""
  ].join("\n");
}

export function formatBaselineStatusText(payload: {
  repo_id: string;
  active_count: number;
  resolved_count: number;
  by_convention: Array<{ convention_id: string; active_count: number; resolved_count: number }>;
}): string {
  const rows = payload.by_convention.length > 0
    ? payload.by_convention.map((row) =>
        `${row.convention_id} active:${row.active_count} resolved:${row.resolved_count}`
      )
    : ["  none"];

  return [
    "Drift baseline",
    "",
    `Repo: ${payload.repo_id}`,
    `Active: ${payload.active_count}`,
    `Resolved: ${payload.resolved_count}`,
    "",
    "By convention:",
    ...rows.map((row) => `  ${row}`),
    ""
  ].join("\n");
}

export function findingLocation(finding: Finding): string {
  const evidence = finding.evidence_refs[0];
  if (!evidence) {
    return "unknown";
  }
  return `${evidence.file_path}:${evidence.start_line ?? "?"}`;
}

export function formatCounts(counts: Partial<Record<string, number>>): string {
  const entries = Object.entries(counts).filter(([, value]) => Number(value) > 0);
  return entries.length > 0
    ? entries.map(([key, value]) => `${key}: ${value}`).join(", ")
    : "none";
}

export function formatFindingFixedText(payload: { finding: Finding; evidence: string }): string {
  return [
    "Drift finding fixed",
    "",
    `Finding: ${payload.finding.id}`,
    `Status: ${payload.finding.status}`,
    `Evidence: ${payload.evidence}`,
    ""
  ].join("\n");
}

export function formatFindingResolutionText(payload: { finding: Finding; reason: string }): string {
  return [
    "Drift finding updated",
    "",
    `Finding: ${payload.finding.id}`,
    `Status: ${payload.finding.status}`,
    `Reason: ${payload.reason}`,
    ""
  ].join("\n");
}
