import { authorizeContextExport,type Finding,type FindingStatus } from "@drift/core";
import type { SqliteDriftStorage } from "@drift/storage";
import { CommandPayload,ParsedArgs } from "../app/command-types.js";
import { actorFlag,optionalFindingDiffStatusFlag,optionalFindingStatusFlag,optionalNonEmptyFlag,optionalNonNegativeIntegerFlag,optionalPositiveIntegerFlag,optionalRepoRelativeFlag,optionalSeverityFlag,requiredFlag,requiredNonEmptyFlag,stringFlag,validateFileLineEvidence } from "../args/flag-readers.js";
import { resolveRepoId } from "../args/repo-flags.js";
import { findingMatchesPath,findingShowNextCommands,fixedFindingNextCommands,fixedFindingResolution,governedFindingNextCommands,governedFindingResolution,reviewFinding } from "../domain/findings.js";
import { auditEvent,mutationGovernance,preflightGovernance } from "../domain/governance.js";
import { countBy,orderFindingsForReview,paginateFindings,paginationSummary } from "../domain/pagination.js";
import { requiredRepo,requiredRepoContract } from "../domain/repo-paths.js";
import { assertFreshScanIfRequired,freshnessRequirement,scanStatusPayload } from "../domain/scan-status.js";
import { formatFindingFixedText,formatFindingResolutionText,formatFindingShowText,formatFindingsText } from "../formatters/findings.js";

export function listFindings(storage: SqliteDriftStorage, parsed: ParsedArgs): CommandPayload {
  const repoId = resolveRepoId(parsed);
  requiredRepo(storage, repoId);
  const contract = requiredRepoContract(storage, repoId);
  const policy = authorizeContextExport(contract, "cli-check");
  if (!policy.allowed) {
    throw new Error(`Policy denied findings output: ${policy.reason}`);
  }
  const status = optionalFindingStatusFlag(parsed, "status");
  const severity = optionalSeverityFlag(parsed, "severity");
  const diffStatus = optionalFindingDiffStatusFlag(parsed, "diff-status");
  const path = optionalRepoRelativeFlag(parsed, "path");
  const conventionId = optionalNonEmptyFlag(parsed, "convention");
  const limit = optionalPositiveIntegerFlag(parsed, "limit");
  const offset = optionalNonNegativeIntegerFlag(parsed, "offset") ?? 0;
  const requireFresh = parsed.flags.has("require-fresh");
  const scanStatus = scanStatusPayload(storage, repoId);
  assertFreshScanIfRequired(repoId, scanStatus, requireFresh);
  const allFindings = storage.listFindings(repoId);
  const filteredFindings = allFindings.filter((finding) =>
    (!status || finding.status === status) &&
    (!severity || finding.severity === severity) &&
    (!diffStatus || finding.diff_status === diffStatus) &&
    (!conventionId || finding.convention_id === conventionId) &&
    (!path || findingMatchesPath(finding, path))
  );
  const orderedFindings = orderFindingsForReview(filteredFindings);
  const findings = paginateFindings(orderedFindings, limit, offset);

  const payload = {
    repo_id: repoId,
    policy,
    governance: preflightGovernance(),
    filters: {
      status: status ?? null,
      severity: severity ?? null,
      diff_status: diffStatus ?? null,
      convention_id: conventionId ?? null,
      path: path ?? null
    },
    scan_status: scanStatus,
    freshness_requirement: freshnessRequirement(requireFresh, scanStatus),
    summary: {
      total_count: allFindings.length,
      filtered_count: filteredFindings.length,
      by_status: countBy(allFindings, (finding) => finding.status),
      by_severity: countBy(allFindings, (finding) => finding.severity),
      by_diff_status: countBy(allFindings, (finding) => finding.diff_status)
    },
    pagination: paginationSummary(filteredFindings.length, findings.length, limit, offset),
    review_items: findings.map(reviewFinding),
    findings
  };

  return {
    payload: parsed.flags.has("json") ? payload : formatFindingsText(payload)
  };
}

export function showFinding(
  storage: SqliteDriftStorage,
  parsed: ParsedArgs,
  findingId: string
): CommandPayload {
  const repoId = resolveRepoId(parsed);
  requiredRepo(storage, repoId);
  const contract = requiredRepoContract(storage, repoId);
  const policy = authorizeContextExport(contract, "cli-check");
  if (!policy.allowed) {
    throw new Error(`Policy denied findings output: ${policy.reason}`);
  }
  const requireFresh = parsed.flags.has("require-fresh");
  const scanStatus = scanStatusPayload(storage, repoId);
  assertFreshScanIfRequired(repoId, scanStatus, requireFresh);
  const finding = storage.listFindings(repoId).find((entry) => entry.id === findingId);
  if (!finding) {
    throw new Error(`Finding not found: ${findingId}`);
  }
  const payload = {
    repo_id: repoId,
    policy,
    governance: preflightGovernance(),
    scan_status: scanStatus,
    freshness_requirement: freshnessRequirement(requireFresh, scanStatus),
    review_item: reviewFinding(finding),
    finding,
    next_commands: findingShowNextCommands(repoId, finding)
  };

  return {
    payload: parsed.flags.has("json") ? payload : formatFindingShowText(payload)
  };
}

export function markFindingFixed(
  storage: SqliteDriftStorage,
  parsed: ParsedArgs,
  findingId: string
): CommandPayload {
  const repoId = resolveRepoId(parsed);
  requiredRepo(storage, repoId);
  const evidence = requiredFlag(parsed, "evidence");
  validateFileLineEvidence(evidence);
  const now = stringFlag(parsed, "now") ?? new Date().toISOString();
  const actor = actorFlag(parsed);
  const finding = storage.listFindings(repoId).find((entry) => entry.id === findingId);
  if (!finding) {
    throw new Error(`Finding not found: ${findingId}`);
  }
  if (!parsed.flags.has("confirm")) {
    throw new Error("Finding fixed resolution requires --confirm.");
  }
  if (finding.status === "fixed") {
    const payload = {
      finding,
      evidence,
      governance: mutationGovernance(),
      review_item: reviewFinding(finding),
      resolution: fixedFindingResolution(evidence, 0),
      next_commands: fixedFindingNextCommands(repoId),
      changed: false
    };
    return {
      payload: parsed.flags.has("json") ? payload : formatFindingFixedText(payload)
    };
  }

  const updated: Finding = {
    ...finding,
    status: "fixed"
  };
  storage.upsertFinding(updated);
  let resolvedBaselineCount = 0;
  for (const baseline of storage.listBaselineViolations(repoId)) {
    if (
      baseline.status === "active" &&
      baseline.convention_id === finding.convention_id &&
      baseline.finding_fingerprint === finding.fingerprint
    ) {
      storage.upsertBaselineViolation({ ...baseline, status: "resolved" });
      resolvedBaselineCount += 1;
    }
  }
  storage.appendAuditEvent(auditEvent({
    id: `audit_event_finding_fixed_${repoId}_${findingId}_${now}`,
    repoId,
    actor,
    action: "finding_resolved",
    targetType: "finding",
    targetId: findingId,
    metadata: { evidence, resolved_baseline_count: resolvedBaselineCount },
    createdAt: now
  }));

  const payload = {
    finding: updated,
    evidence,
    governance: mutationGovernance(),
    review_item: reviewFinding(updated),
    resolution: fixedFindingResolution(evidence, resolvedBaselineCount),
    next_commands: fixedFindingNextCommands(repoId),
    changed: true
  };
  return {
    payload: parsed.flags.has("json") ? payload : formatFindingFixedText(payload)
  };
}

export function resolveFindingWithReason(
  storage: SqliteDriftStorage,
  parsed: ParsedArgs,
  findingId: string,
  status: Extract<FindingStatus, "needs_review" | "suppressed" | "accepted_drift" | "false_positive">
): CommandPayload {
  const repoId = resolveRepoId(parsed);
  requiredRepo(storage, repoId);
  const reason = requiredNonEmptyFlag(parsed, "reason");
  const now = stringFlag(parsed, "now") ?? new Date().toISOString();
  const actor = actorFlag(parsed);
  const finding = storage.listFindings(repoId).find((entry) => entry.id === findingId);
  if (!finding) {
    throw new Error(`Finding not found: ${findingId}`);
  }
  if (finding.status === "fixed") {
    throw new Error("Finding is already fixed. Reopen it before applying another governance status.");
  }
  requireFindingGovernanceConfirmation(parsed, status);
  if (finding.status === status) {
    const payload = {
      finding,
      reason,
      governance: mutationGovernance(),
      review_item: reviewFinding(finding),
      resolution: governedFindingResolution(status, reason),
      next_commands: governedFindingNextCommands(repoId, status),
      changed: false
    };
    return {
      payload: parsed.flags.has("json") ? payload : formatFindingResolutionText(payload)
    };
  }

  const updated: Finding = {
    ...finding,
    status
  };
  storage.upsertFinding(updated);
  storage.appendAuditEvent(auditEvent({
    id: `audit_event_finding_${status}_${repoId}_${findingId}_${now}`,
    repoId,
    actor,
    action: status === "suppressed"
      ? "finding_suppressed"
      : status === "needs_review"
        ? "finding_flagged_for_review"
        : "finding_resolved",
    targetType: "finding",
    targetId: findingId,
    metadata: { reason, status },
    createdAt: now
  }));

  const payload = {
    finding: updated,
    reason,
    governance: mutationGovernance(),
    review_item: reviewFinding(updated),
    resolution: governedFindingResolution(status, reason),
    next_commands: governedFindingNextCommands(repoId, status),
    changed: true
  };
  return {
    payload: parsed.flags.has("json") ? payload : formatFindingResolutionText(payload)
  };
}

export function requireFindingGovernanceConfirmation(
  parsed: ParsedArgs,
  status: Extract<FindingStatus, "needs_review" | "suppressed" | "accepted_drift" | "false_positive">
): void {
  if (!parsed.flags.has("confirm")) {
    if (status === "needs_review") {
      throw new Error("Finding needs-review resolution requires --confirm.");
    }
    throw new Error("Finding governance changes require --confirm for suppress, accept-drift, and mark-false-positive.");
  }
}
