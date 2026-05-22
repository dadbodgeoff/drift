import { authorizeContextExport,type Finding } from "@drift/core";
import { findingLocation } from "./findings.js";

export function formatCheckText(payload: {
  policy: ReturnType<typeof authorizeContextExport>;
  summary: {
    repo_id: string;
    scope: string;
    findings_count: number;
    blocking_count: number;
    waived_findings_count?: number;
    expired_findings_count?: number;
    skipped_deleted_files: string[];
    engine_source: "rust" | "typescript";
  };
  findings: Finding[];
}): string {
  const rows = payload.findings.length > 0
    ? payload.findings.map((finding) =>
        `${finding.id} ${finding.severity}/${finding.enforcement_result} ${finding.status} ${finding.diff_status} ${findingLocation(finding)} - ${finding.title}`
      )
    : ["  none"];

  return [
    "Drift check",
    "",
    `Repo: ${payload.summary.repo_id}`,
    `Scope: ${payload.summary.scope}`,
    `Engine: ${payload.summary.engine_source}`,
    `Policy: ${payload.policy.allowed ? "allowed" : "denied"} (${payload.policy.mode})`,
    `Findings: ${payload.summary.findings_count}`,
    `Blocking: ${payload.summary.blocking_count}`,
    `Waived: ${payload.summary.waived_findings_count ?? 0}`,
    `Expired: ${payload.summary.expired_findings_count ?? 0}`,
    `Skipped deleted files: ${payload.summary.skipped_deleted_files.length}`,
    "",
    "Findings:",
    ...rows.map((row) => `  ${row}`),
    ""
  ].join("\n");
}

export function formatChecksText(payload: {
  summary?: {
    required_count: number;
    safe_count: number;
    total_count: number;
    filtered_count?: number;
    listed_count?: number;
  };
  pagination?: {
    limit: number | null;
    offset: number;
    returned_count: number;
    has_more: boolean;
    next_offset: number | null;
  };
  required_checks: Array<{ command: string; reason?: string }>;
  safe_commands: Array<{ command: string; reason?: string }>;
}): string {
  const requiredChecks = payload.required_checks.length > 0
    ? payload.required_checks.map((check) => `  ${check.command}${check.reason ? ` - ${check.reason}` : ""}`)
    : ["  none"];
  const safeCommands = payload.safe_commands.length > 0
    ? payload.safe_commands.map((command) => `  ${command.command}${command.reason ? ` - ${command.reason}` : ""}`)
    : ["  none"];

  return [
    "Drift checks",
    "",
    payload.summary
      ? `Summary: ${payload.summary.required_count} required, ${payload.summary.safe_count} safe, ${payload.summary.total_count} total`
      : "",
    payload.summary && payload.summary.filtered_count !== undefined
      ? `Returned: ${payload.summary.listed_count ?? payload.summary.total_count} of ${payload.summary.filtered_count}`
      : "",
    payload.pagination
      ? `Page: limit ${payload.pagination.limit ?? "none"}, offset ${payload.pagination.offset}, next ${payload.pagination.next_offset ?? "none"}`
      : "",
    payload.summary ? "" : "",
    "Required checks:",
    ...requiredChecks,
    "",
    "Safe commands:",
    ...safeCommands,
    ""
  ].join("\n");
}
