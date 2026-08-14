import type { Finding } from "@drift/core";
import type { SqliteDriftStorage } from "@drift/storage";
import { baselineScanManifest } from "../check/finding-fingerprint.js";
import { auditEvent } from "./governance.js";
import { sanitizeAuditId } from "./identifiers.js";

export function baselineViolationKey(conventionId: string, findingFingerprint: string): string {
  return `${conventionId}:${findingFingerprint}`;
}

export function createBaselineForFindings(
  storage: SqliteDriftStorage,
  options: { now: string; actor: string },
  repoId: string,
  findings: Finding[]
): { created_count: number; created_by_convention: Record<string, number> } {
  if (findings.length === 0) {
    return { created_count: 0, created_by_convention: {} };
  }

  const now = options.now;
  const scanId = `scan_baseline_${sanitizeAuditId(now)}`;
  storage.upsertScanManifest(baselineScanManifest({
    id: scanId,
    repoId,
    from: "initial-scan",
    now,
    findingCount: findings.length
  }));

  let createdCount = 0;
  // T-05: counted per convention as the rows are written, rather than re-derived afterwards.
  // The total alone cannot answer the question a user actually has - how much of THIS convention
  // is grandfathered - and deriving it later would have to repeat the eligibility and dedupe
  // rules this loop applies, which is how the two numbers drift apart.
  const createdByConvention: Record<string, number> = {};
  const existingBaselines = new Set(storage
    .listBaselineViolations(repoId)
    .map((row) => baselineViolationKey(row.convention_id, row.finding_fingerprint)));
  for (const finding of findings) {
    if (!isBaselineEligibleFinding(finding)) {
      continue;
    }

    const baselineKey = baselineViolationKey(finding.convention_id, finding.fingerprint);
    if (existingBaselines.has(baselineKey)) {
      continue;
    }

    // T-06: the file from the finding's own evidence, never inferred from its prose.
    //
    // The previous `inferFilePathFromMessage` split the message on the literal " imports ", which
    // occurs in the data-access message and no other kind's - so every other kind stored a
    // SENTENCE in the path column. Measured on dub: the auth family's 87 rows collapsed to 5
    // distinct values, each a sentence, and `baseline status --json` served them to agents as
    // `file_path`.
    //
    // Thrown rather than defaulted when evidence is missing. A finding with no evidence cannot say
    // what file it is about, and quietly writing a placeholder is how the prose got there in the
    // first place - a loud failure at onboarding is recoverable, a corrupted baseline is not.
    const filePath = finding.evidence_refs[0]?.file_path;
    if (!filePath) {
      throw new Error(
        `Cannot baseline finding ${finding.id} (${finding.convention_id}): it carries no evidence file path.`
      );
    }

    storage.upsertBaselineViolation({
      id: `baseline_${finding.fingerprint.slice(0, 16)}`,
      repo_id: repoId,
      convention_id: finding.convention_id,
      finding_fingerprint: finding.fingerprint,
      file_path: filePath,
      first_seen_scan_id: scanId,
      first_seen_commit: "initial-scan",
      status: "active",
      created_at: now
    });
    existingBaselines.add(baselineKey);
    createdCount += 1;
    createdByConvention[finding.convention_id] = (createdByConvention[finding.convention_id] ?? 0) + 1;
  }

  storage.appendAuditEvent(auditEvent({
    id: `audit_event_baseline_create_${repoId}_${now}`,
    repoId,
    actor: options.actor,
    action: "baseline_created",
    targetType: "baseline",
    targetId: scanId,
    metadata: {
      from: "initial-scan",
      created_count: createdCount,
      created_by_convention: createdByConvention
    },
    createdAt: now
  }));

  return { created_count: createdCount, created_by_convention: createdByConvention };
}

export function baselineSummary(storage: SqliteDriftStorage, repoId: string): {
  active_count: number;
  resolved_count: number;
  by_convention: Array<{ convention_id: string; active_count: number; resolved_count: number }>;
} {
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

  return {
    active_count: rows.filter((row) => row.status === "active").length,
    resolved_count: rows.filter((row) => row.status === "resolved").length,
    by_convention: [...byConvention.entries()].map(([convention_id, counts]) => ({
      convention_id,
      ...counts
    }))
  };
}

export function baselineRowsSummary(rows: ReturnType<SqliteDriftStorage["listBaselineViolations"]>): {
  active_count: number;
  resolved_count: number;
  total_count: number;
} {
  return {
    active_count: rows.filter((row) => row.status === "active").length,
    resolved_count: rows.filter((row) => row.status === "resolved").length,
    total_count: rows.length
  };
}

export function baselineReviewItems(rows: ReturnType<SqliteDriftStorage["listBaselineViolations"]>): Array<{
  id: string;
  convention_id: string;
  finding_fingerprint: string;
  file_path: string;
  status: "active" | "resolved";
  first_seen_scan_id: string;
  first_seen_commit: string;
}> {
  return rows.map((row) => ({
    id: row.id,
    convention_id: row.convention_id,
    finding_fingerprint: row.finding_fingerprint,
    file_path: row.file_path,
    status: row.status,
    first_seen_scan_id: row.first_seen_scan_id,
    first_seen_commit: row.first_seen_commit
  }));
}

export function baselineCreateNextCommands(repoId: string): string[] {
  return [
    `drift baseline status --repo ${repoId} --json`,
    `drift prepare "task" --repo ${repoId} --json`,
    `drift check --repo ${repoId} --diff main...HEAD --scope changed-hunks --json`
  ];
}

export function baselineStatusNextCommands(
  repoId: string,
  rows: ReturnType<SqliteDriftStorage["listBaselineViolations"]>
): string[] {
  const firstActive = rows.find((row) => row.status === "active");
  return [
    `drift findings list --repo ${repoId} --json`,
    firstActive
      ? `drift baseline clear --repo ${repoId} --convention ${firstActive.convention_id} --confirm --json`
      : `drift check --repo ${repoId} --diff main...HEAD --scope changed-hunks --json`
  ];
}

export function baselineClearNextCommands(repoId: string): string[] {
  return [
    `drift baseline status --repo ${repoId} --json`,
    `drift check --repo ${repoId} --diff main...HEAD --scope changed-hunks --json`,
    `drift audit list --repo ${repoId} --action baseline_cleared --json`
  ];
}

export function isBaselineEligibleFinding(finding: Finding): boolean {
  return ![
    "fixed",
    "false_positive",
    "suppressed",
    "accepted_drift"
  ].includes(finding.status);
}
