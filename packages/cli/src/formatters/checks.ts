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
    };
    outcome?: {
      blocking_reasons: Array<{ reason: string; count: number }>;
      warning_reasons: Array<{ reason: string; count: number }>;
      non_blocking_reasons: Array<{ reason: string; count: number }>;
    };
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
    payload.summary.affected_scope
      ? `Affected: ${payload.summary.affected_scope.changed_file_count} files, ${payload.summary.affected_scope.changed_line_count} changed lines`
      : "",
    ...reasonLines("Block reasons", payload.summary.outcome?.blocking_reasons ?? []),
    ...reasonLines("Warn reasons", payload.summary.outcome?.warning_reasons ?? []),
    ...reasonLines("Non-blocking reasons", payload.summary.outcome?.non_blocking_reasons ?? []),
    `Skipped deleted files: ${payload.summary.skipped_deleted_files.length}`,
    "",
    "Findings:",
    ...rows.map((row) => `  ${row}`),
    ...securityBlocks(payload),
    ""
  ].join("\n");
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
