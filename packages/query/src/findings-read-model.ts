import type { EvidenceRef, Finding, FindingDiffStatus, FindingStatus, Severity } from "@drift/core";
import { matchesPolicyGlob } from "@drift/core";

export interface FindingsReadModelFilters {
  status?: FindingStatus;
  severity?: Severity;
  diff_status?: FindingDiffStatus;
  convention_id?: string;
  path?: string;
}

export interface FindingsReadModelOptions {
  findings: Finding[];
  filters?: FindingsReadModelFilters;
  limit?: number;
  offset?: number;
}

export function buildFindingsReadModel(input: FindingsReadModelOptions): {
  filters: {
    status: FindingStatus | null;
    severity: Severity | null;
    diff_status: FindingDiffStatus | null;
    convention_id: string | null;
    path: string | null;
  };
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
  review_items: ReturnType<typeof reviewFinding>[];
  findings: Finding[];
} {
  const filters = input.filters ?? {};
  const offset = input.offset ?? 0;
  const filteredFindings = input.findings.filter((finding) =>
    (!filters.status || finding.status === filters.status) &&
    (!filters.severity || finding.severity === filters.severity) &&
    (!filters.diff_status || finding.diff_status === filters.diff_status) &&
    (!filters.convention_id || finding.convention_id === filters.convention_id) &&
    (!filters.path || findingMatchesPath(finding, filters.path))
  );
  const orderedFindings = orderFindingsForReview(filteredFindings);
  const findings = paginateFindings(orderedFindings, input.limit, offset);

  return {
    filters: {
      status: filters.status ?? null,
      severity: filters.severity ?? null,
      diff_status: filters.diff_status ?? null,
      convention_id: filters.convention_id ?? null,
      path: filters.path ?? null
    },
    summary: {
      total_count: input.findings.length,
      filtered_count: filteredFindings.length,
      by_status: countBy(input.findings, (finding) => finding.status),
      by_severity: countBy(input.findings, (finding) => finding.severity),
      by_diff_status: countBy(input.findings, (finding) => finding.diff_status)
    },
    pagination: paginationSummary(filteredFindings.length, findings.length, input.limit, offset),
    review_items: findings.map(reviewFinding),
    findings
  };
}

export function findingMatchesPath(finding: Finding, path: string): boolean {
  return finding.evidence_refs.some((ref) =>
    ref.file_path === path ||
    matchesPolicyGlob(ref.file_path, path)
  );
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

function orderFindingsForReview(findings: Finding[]): Finding[] {
  return [...findings].sort((left, right) =>
    left.created_at.localeCompare(right.created_at) ||
    left.id.localeCompare(right.id)
  );
}

function paginateFindings(findings: Finding[], limit: number | undefined, offset: number): Finding[] {
  return limit === undefined
    ? findings.slice(offset)
    : findings.slice(offset, offset + limit);
}

function paginationSummary(total: number, returnedCount: number, limit: number | undefined, offset: number): {
  limit: number | null;
  offset: number;
  returned_count: number;
  has_more: boolean;
  next_offset: number | null;
} {
  const nextOffset = offset + returnedCount;
  const hasMore = nextOffset < total;
  return {
    limit: limit ?? null,
    offset,
    returned_count: returnedCount,
    has_more: hasMore,
    next_offset: hasMore ? nextOffset : null
  };
}

function countBy<T, K extends string>(
  entries: T[],
  keyFor: (entry: T) => K
): Partial<Record<K, number>> {
  const counts: Partial<Record<K, number>> = {};
  for (const entry of entries) {
    const key = keyFor(entry);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}
