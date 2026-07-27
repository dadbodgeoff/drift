import type { AuditEvent,ConventionCandidate,Finding } from "@drift/core";

export function orderFindingsForReview(findings: Finding[]): Finding[] {
  return [...findings].sort((left, right) =>
    left.created_at.localeCompare(right.created_at) ||
    left.id.localeCompare(right.id)
  );
}

export function paginateFindings(findings: Finding[], limit: number | undefined, offset: number): Finding[] {
  return limit === undefined
    ? findings.slice(offset)
    : findings.slice(offset, offset + limit);
}

export function paginationSummary(total: number, returnedCount: number, limit: number | undefined, offset: number): {
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

export function orderAuditEventsForReview(events: AuditEvent[]): AuditEvent[] {
  return [...events].sort((left, right) =>
    left.created_at.localeCompare(right.created_at) ||
    left.id.localeCompare(right.id)
  );
}

export function paginateAuditEvents(events: AuditEvent[], limit: number | undefined, offset: number): AuditEvent[] {
  return limit === undefined
    ? events.slice(offset)
    : events.slice(offset, offset + limit);
}

export function orderConventionCandidatesForReview(candidates: ConventionCandidate[]): ConventionCandidate[] {
  return [...candidates].sort((left, right) =>
    left.created_at.localeCompare(right.created_at) ||
    left.id.localeCompare(right.id)
  );
}

export function paginateConventionCandidates(
  candidates: ConventionCandidate[],
  limit: number | undefined,
  offset: number
): ConventionCandidate[] {
  return limit === undefined
    ? candidates.slice(offset)
    : candidates.slice(offset, offset + limit);
}

export function countBy<T, K extends string>(
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
