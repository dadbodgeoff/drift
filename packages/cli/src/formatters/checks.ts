import { authorizeContextExport,type Finding,type SecurityBoundaryProof } from "@drift/core";
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
    affected_scope?: {
      changed_file_count: number;
      changed_line_count: number;
      deleted_file_count: number;
      renamed_file_count?: number;
      missing_file_count?: number;
    };
    outcome?: {
      blocking_reasons: Array<{ reason: string; count: number }>;
      warning_reasons: Array<{ reason: string; count: number }>;
      non_blocking_reasons: Array<{ reason: string; count: number }>;
    };
    // E-6 (D-2): conventions currently running weaker than block because something
    // explicitly demoted them. Present only while the weaker mode is in effect.
    enforcement_demotions?: Array<{
      convention_id: string;
      from: string;
      to: string;
      at: string;
    }>;
    /** BB-4: one line per forbidden module the repo no longer contains. */
    contract_staleness_warnings?: string[];
  };
  findings: Finding[];
  security_boundary_proofs?: SecurityBoundaryProof[];
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
    // BB-1: what was examined, on every run, in the vocabulary a reader checks first.
    //
    // `Affected: 0 files` was already printed, but a human scanning for "did this check anything"
    // reads it as a property of the change, not of the check. `Checked N files` answers the question
    // directly, and names the deleted-file case rather than leaving a bare 0 to be misread as a
    // broken diff spec - deleting code is a legitimate change with a legitimately empty scope.
    checkedFilesLine(payload.summary),
    payload.summary.affected_scope
      ? `Affected: ${payload.summary.affected_scope.changed_file_count} files, ${payload.summary.affected_scope.changed_line_count} changed lines`
      : "",
    ...reasonLines("Block reasons", payload.summary.outcome?.blocking_reasons ?? []),
    ...reasonLines("Warn reasons", payload.summary.outcome?.warning_reasons ?? []),
    ...reasonLines("Non-blocking reasons", payload.summary.outcome?.non_blocking_reasons ?? []),
    // BB-4: before the demotion lines, because "this rule enforces nothing" outranks "this rule
    // enforces something weaker".
    ...(payload.summary.contract_staleness_warnings ?? []),
    ...(payload.summary.enforcement_demotions ?? []).map(
      (demotion) =>
        `Enforcement demoted: ${demotion.convention_id} ${demotion.from} -> ${demotion.to} at ${demotion.at}`
    ),
    `Skipped deleted files: ${payload.summary.skipped_deleted_files.length}`,
    "",
    "Findings:",
    ...rows.map((row) => `  ${row}`),
    ...securityBlocks(payload),
    ""
  ].join("\n");
}

/**
 * BB-1: `Checked N files`, plus the reason when N is 0 for a legitimate reason.
 *
 * The count comes from `affected_scope`, which is the check's own record of what it looked at. When
 * that is absent (older payloads) the line is omitted rather than guessed at - a fabricated count is
 * worse than a missing one on a surface whose whole purpose is telling examined from unexamined.
 */
function checkedFilesLine(summary: {
  skipped_deleted_files: string[];
  affected_scope?: {
    changed_file_count: number;
    deleted_file_count: number;
    renamed_file_count?: number;
    missing_file_count?: number;
  };
}): string {
  if (!summary.affected_scope) {
    return "";
  }
  const checked = summary.affected_scope.changed_file_count;
  const deleted = summary.affected_scope.deleted_file_count;
  const renamed = summary.affected_scope.renamed_file_count ?? 0;
  const missing = summary.affected_scope.missing_file_count ?? 0;
  const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;
  // BB-1: name the reason a legitimate check examined nothing - a deletion or a pure rename. Both are
  // ordinary changes whose content scope is empty, and a bare `Checked 0 files` reads as a broken
  // diff spec.
  const reasons = [
    ...(deleted > 0 ? [`${plural(deleted, "deleted file")} skipped`] : []),
    ...(renamed > 0 ? [`${plural(renamed, "renamed file")} unchanged`] : [])
  ];
  // BB-9: a missing file is reported whether or not anything else was checked, because "I examined 3
  // of the 4 files you named" is a different claim from "I examined 3 files", and only the first is
  // true. The other reasons only matter when nothing was examined at all.
  const missingClause = missing > 0 ? `${plural(missing, "file")} missing from working tree` : "";
  const parts = [
    ...(checked === 0 ? reasons : []),
    ...(missingClause ? [missingClause] : [])
  ];
  const suffix = parts.length > 0 ? ` (${parts.join(", ")})` : "";
  return `Checked ${plural(checked, "file")}${suffix}`;
}

function securityBlocks(payload: {
  summary: { repo_id: string };
  findings: Finding[];
  security_boundary_proofs?: SecurityBoundaryProof[];
}): string[] {
  const findingsById = new Map(payload.findings.map((finding) => [finding.id, finding]));
  const blocks = (payload.security_boundary_proofs ?? [])
    .filter((proof) => proof.result.finding_ids.length > 0)
    .map((proof) => {
      const finding = proof.result.finding_ids
        .map((id) => findingsById.get(id))
        .find((candidate): candidate is Finding => Boolean(candidate));
      const contract = proof.contracts.find((entry) => entry.matched) ?? proof.contracts[0];
      const level = proof.result.enforcement_result === "block" ? "BLOCK" : "WARN";
      const route = proof.route.endpoint?.method && proof.route.endpoint?.path
        ? `${proof.route.endpoint.method} ${proof.route.endpoint.path}`
        : "unknown";
      return [
        "",
        `${level} ${contract?.kind ?? "security_boundary"}`,
        `  Route: ${route}`,
        `  File: ${proof.route.file_path}`,
        `  Reason: ${proof.missing_proof[0]?.code ?? proof.parser_gaps[0]?.code ?? finding?.title ?? proof.result.proof_status}`,
        `  Evidence: ${evidenceLine(proof)}`,
        `  Capability: ${proof.capability_status[0]?.name ?? proof.missing_proof[0]?.capability ?? "security"} ${contract?.capability ?? "deterministic_check"}`,
        `  Lifecycle: ${finding?.status ?? "unknown"}, ${finding?.diff_status ?? "changed-files"}`,
        `  Next: drift repo map --repo ${payload.summary.repo_id} --path ${proof.route.file_path} --json`
      ].join("\n");
    });
  return blocks;
}

function evidenceLine(proof: SecurityBoundaryProof): string {
  const refs = proof.evidence_refs ?? [];
  if (refs.length > 0) {
    return refs.slice(0, 4).map((ref) =>
      `${ref.kind}${ref.start_line ? ` line ${ref.start_line}` : ""}`
    ).join("; ");
  }
  const missingIds = proof.missing_proof.flatMap((missing) => missing.fact_ids);
  return missingIds.length > 0 ? missingIds.slice(0, 4).join("; ") : "proof metadata only";
}

function reasonLines(label: string, reasons: Array<{ reason: string; count: number }>): string[] {
  if (reasons.length === 0) {
    return [];
  }
  return [
    `${label}:`,
    ...reasons.map((reason) => `  ${reason.reason}: ${reason.count}`)
  ];
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
