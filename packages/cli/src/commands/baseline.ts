import type { Finding } from "@drift/core";
import type { SqliteDriftStorage } from "@drift/storage";
import { CommandPayload,ParsedArgs } from "../app/command-types.js";
import { actorFlag,requiredFlag,requiredNonEmptyFlag,stringFlag } from "../args/flag-readers.js";
import { resolveRepoId } from "../args/repo-flags.js";
import { baselineScanManifest,inferFilePathFromMessage } from "../check/finding-fingerprint.js";
import { baselineClearNextCommands,baselineCreateNextCommands,baselineReviewItems,baselineRowsSummary,baselineStatusNextCommands,baselineViolationKey,isBaselineEligibleFinding } from "../domain/baselines.js";
import { auditEvent,mutationGovernance,preflightGovernance } from "../domain/governance.js";
import { sanitizeAuditId } from "../domain/identifiers.js";
import { requiredRepo } from "../domain/repo-paths.js";
import { formatBaselineStatusText } from "../formatters/findings.js";

export function createBaseline(storage: SqliteDriftStorage, parsed: ParsedArgs): {
  created_count: number;
  baseline: ReturnType<SqliteDriftStorage["listBaselineViolations"]>;
  governance: ReturnType<typeof mutationGovernance>;
  summary: ReturnType<typeof baselineRowsSummary>;
  review_items: ReturnType<typeof baselineReviewItems>;
  next_commands: string[];
} {
  const repoId = resolveRepoId(parsed);
  const from = requiredNonEmptyFlag(parsed, "from");
  if (!parsed.flags.has("confirm")) {
    throw new Error("Baseline creation requires --confirm.");
  }
  const now = stringFlag(parsed, "now") ?? new Date().toISOString();
  const actor = actorFlag(parsed);
  const repo = storage.getRepo(repoId);
  if (!repo) {
    throw new Error(`Unknown repo ${repoId}.`);
  }

  const scanId = `scan_baseline_${sanitizeAuditId(now)}`;

  const findings = storage.listFindings(repoId);
  const existingBaselines = new Set(storage
    .listBaselineViolations(repoId)
    .map((row) => baselineViolationKey(row.convention_id, row.finding_fingerprint)));
  const newBaselineFindings: Finding[] = [];
  for (const finding of findings) {
    if (!isBaselineEligibleFinding(finding)) {
      continue;
    }

    const baselineKey = baselineViolationKey(finding.convention_id, finding.fingerprint);
    if (existingBaselines.has(baselineKey)) {
      continue;
    }

    newBaselineFindings.push(finding);
    existingBaselines.add(baselineKey);
  }

  if (newBaselineFindings.length === 0) {
    const baseline = storage.listBaselineViolations(repoId);
    return {
      created_count: 0,
      baseline,
      governance: mutationGovernance(),
      summary: baselineRowsSummary(baseline),
      review_items: baselineReviewItems(baseline),
      next_commands: baselineCreateNextCommands(repoId)
    };
  }

  storage.transaction(() => {
    storage.upsertScanManifest(baselineScanManifest({
      id: scanId,
      repoId,
      from,
      now,
      findingCount: findings.length
    }));

    for (const finding of newBaselineFindings) {
      storage.upsertBaselineViolation({
        id: `baseline_${finding.fingerprint.slice(0, 16)}`,
        repo_id: repoId,
        convention_id: finding.convention_id,
        finding_fingerprint: finding.fingerprint,
        file_path: finding.evidence_refs[0]?.file_path ?? inferFilePathFromMessage(finding.message),
        first_seen_scan_id: scanId,
        first_seen_commit: from,
        status: "active",
        created_at: now
      });
    }
    storage.appendAuditEvent(auditEvent({
      id: `audit_event_baseline_create_${repoId}_${now}`,
      repoId,
      actor,
      action: "baseline_created",
      targetType: "baseline",
      targetId: scanId,
      metadata: { from, created_count: newBaselineFindings.length },
      createdAt: now
    }));
  });

  const baseline = storage.listBaselineViolations(repoId);
  return {
    created_count: newBaselineFindings.length,
    baseline,
    governance: mutationGovernance(),
    summary: baselineRowsSummary(baseline),
    review_items: baselineReviewItems(baseline),
    next_commands: baselineCreateNextCommands(repoId)
  };
}

export function baselineStatus(storage: SqliteDriftStorage, parsed: ParsedArgs): CommandPayload {
  const repoId = resolveRepoId(parsed);
  requiredRepo(storage, repoId);
  const rows = storage.listBaselineViolations(repoId);
  const byConvention = new Map<string, { active_count: number; resolved_count: number }>();

  for (const row of rows) {
    const counts = byConvention.get(row.convention_id) ?? { active_count: 0, resolved_count: 0 };
    if (row.status === "active") {
      counts.active_count += 1;
    } else {
      counts.resolved_count += 1;
    }
    byConvention.set(row.convention_id, counts);
  }

  const payload = {
    repo_id: repoId,
    active_count: rows.filter((row) => row.status === "active").length,
    resolved_count: rows.filter((row) => row.status === "resolved").length,
    governance: preflightGovernance(),
    summary: baselineRowsSummary(rows),
    review_items: baselineReviewItems(rows),
    next_commands: baselineStatusNextCommands(repoId, rows),
    by_convention: [...byConvention.entries()].map(([convention_id, counts]) => ({
      convention_id,
      ...counts
    }))
  };

  return {
    payload: parsed.flags.has("json") ? payload : formatBaselineStatusText(payload)
  };
}

export function clearBaseline(storage: SqliteDriftStorage, parsed: ParsedArgs): {
  resolved_count: number;
  baseline: ReturnType<SqliteDriftStorage["listBaselineViolations"]>;
  governance: ReturnType<typeof mutationGovernance>;
  summary: ReturnType<typeof baselineRowsSummary>;
  review_items: ReturnType<typeof baselineReviewItems>;
  next_commands: string[];
} {
  const repoId = resolveRepoId(parsed);
  requiredRepo(storage, repoId);
  const conventionId = requiredFlag(parsed, "convention");
  if (!parsed.flags.has("confirm")) {
    throw new Error("Baseline clearing requires --confirm.");
  }
  const now = stringFlag(parsed, "now") ?? new Date().toISOString();
  const actor = actorFlag(parsed);
  let resolvedCount = 0;

  const activeBaselineRows = storage.listBaselineViolations(repoId).filter((row) =>
    row.convention_id === conventionId && row.status === "active"
  );

  for (const row of activeBaselineRows) {
    resolvedCount += 1;
  }

  if (resolvedCount === 0) {
    const baseline = storage.listBaselineViolations(repoId);
    return {
      resolved_count: resolvedCount,
      baseline,
      governance: mutationGovernance(),
      summary: baselineRowsSummary(baseline),
      review_items: baselineReviewItems(baseline),
      next_commands: baselineClearNextCommands(repoId)
    };
  }

  storage.transaction(() => {
    for (const row of activeBaselineRows) {
      storage.upsertBaselineViolation({ ...row, status: "resolved" });
    }
    storage.appendAuditEvent(auditEvent({
      id: `audit_event_baseline_clear_${repoId}_${conventionId}_${now}`,
      repoId,
      actor,
      action: "baseline_cleared",
      targetType: "baseline",
      targetId: conventionId,
      metadata: { convention_id: conventionId, resolved_count: resolvedCount },
      createdAt: now
    }));
  });

  const baseline = storage.listBaselineViolations(repoId);
  return {
    resolved_count: resolvedCount,
    baseline,
    governance: mutationGovernance(),
    summary: baselineRowsSummary(baseline),
    review_items: baselineReviewItems(baseline),
    next_commands: baselineClearNextCommands(repoId)
  };
}
