import type { EvidenceRef,Finding,FindingDiffStatus,FindingStatus,Severity } from "@drift/core";
import { matchesGlob } from "./repo-paths.js";

export function findingMatchesPath(finding: Finding, path: string): boolean {
  return finding.evidence_refs.some((ref) =>
    ref.file_path === path ||
    matchesGlob(ref.file_path, path)
  );
}

export function isOpenPreflightFinding(finding: Finding): boolean {
  return !isClosedFindingStatus(finding.status);
}

export function isClosedFindingStatus(status: FindingStatus): boolean {
  return ["fixed", "false_positive", "suppressed", "accepted_drift", "expired"].includes(status);
}

export function preservedGovernanceStatus(finding: Finding | undefined): FindingStatus | undefined {
  if (!finding) {
    return undefined;
  }
  if (
    finding.status === "suppressed" ||
    finding.status === "accepted_drift" ||
    finding.status === "false_positive"
  ) {
    return finding.status;
  }
  return undefined;
}

export function reviewFinding(finding: Finding): {
  id: string;
  convention_id: string;
  title: string;
  severity: Severity;
  status: FindingStatus;
  diff_status: FindingDiffStatus;
  enforcement_result: Finding["enforcement_result"];
  evidence_ref_count: number;
  first_evidence: Pick<EvidenceRef, "file_path" | "start_line" | "import_source" | "symbol"> | null;
} {
  const firstEvidence = finding.evidence_refs[0] ?? null;
  return {
    id: finding.id,
    convention_id: finding.convention_id,
    title: finding.title,
    severity: finding.severity,
    status: finding.status,
    diff_status: finding.diff_status,
    enforcement_result: finding.enforcement_result,
    evidence_ref_count: finding.evidence_refs.length,
    first_evidence: firstEvidence
      ? {
          file_path: firstEvidence.file_path,
          start_line: firstEvidence.start_line,
          import_source: firstEvidence.import_source,
          symbol: firstEvidence.symbol
        }
      : null
  };
}

export function fixedFindingResolution(evidence: string, resolvedBaselineCount: number): {
  kind: "fixed";
  evidence: string;
  resolved_baseline_count: number;
} {
  return {
    kind: "fixed",
    evidence,
    resolved_baseline_count: resolvedBaselineCount
  };
}

export function governedFindingResolution(
  status: Extract<FindingStatus, "needs_review" | "suppressed" | "accepted_drift" | "false_positive">,
  reason: string
): {
  kind: Extract<FindingStatus, "needs_review" | "suppressed" | "accepted_drift" | "false_positive">;
  reason: string;
} {
  return {
    kind: status,
    reason
  };
}

export function fixedFindingNextCommands(repoId: string): string[] {
  return [
    `drift findings list --repo ${repoId} --json`,
    `drift baseline status --repo ${repoId} --json`,
    `drift audit list --repo ${repoId} --action finding_resolved --json`
  ];
}

export function governedFindingNextCommands(
  repoId: string,
  status: Extract<FindingStatus, "needs_review" | "suppressed" | "accepted_drift" | "false_positive">
): string[] {
  const auditAction = status === "suppressed"
    ? "finding_suppressed"
    : status === "needs_review"
      ? "finding_flagged_for_review"
      : "finding_resolved";
  return [
    status === "needs_review"
      ? `drift findings list --repo ${repoId} --status needs_review --json`
      : `drift findings list --repo ${repoId} --json`,
    `drift prepare "task" --repo ${repoId} --json`,
    `drift audit list --repo ${repoId} --action ${auditAction} --json`
  ];
}

export function findingShowNextCommands(repoId: string, finding: Finding): string[] {
  const firstEvidence = finding.evidence_refs[0] ?? null;
  const evidence = firstEvidence?.file_path && firstEvidence.start_line
    ? `${firstEvidence.file_path}:${firstEvidence.start_line}`
    : "<file:line>";
  const commands = [
    `drift findings mark-fixed ${finding.id} --repo ${repoId} --evidence ${evidence} --confirm --json`,
    `drift findings mark-needs-review ${finding.id} --repo ${repoId} --reason "needs human review" --confirm --json`
  ];
  if (firstEvidence?.file_path) {
    commands.push(`drift prepare "task" --repo ${repoId} --path ${firstEvidence.file_path} --json`);
  } else {
    commands.push(`drift prepare "task" --repo ${repoId} --json`);
  }
  return commands;
}
