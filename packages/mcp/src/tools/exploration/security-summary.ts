/**
 * drift_security_summary - Security Posture Overview
 * 
 * Exploration tool that provides security-focused analysis:
 * - Sensitive data access patterns
 * - Security issues
 * - Data flow summary
 */

import { createResponseBuilder } from '../../infrastructure/index.js';

import type { BoundaryStore } from 'driftdetect-core';

export interface SecuritySummaryData {
  overview: {
    totalTables: number;
    totalAccessPoints: number;
    sensitiveFields: number;
    violations: number;
  };
  sensitiveData: {
    credentials: number;
    financial: number;
    health: number;
    pii: number;
  };
  topTables: Array<{
    name: string;
    accessCount: number;
    hasSensitive: boolean;
  }>;
  topSensitiveFields: Array<{
    field: string;
    type: string;
    accessCount: number;
  }>;
  recentViolations: Array<{
    file: string;
    line: number;
    message: string;
    severity: string;
  }>;
}

const DEFAULT_LIMIT = 10;

export async function handleSecuritySummary(
  store: BoundaryStore,
  args: {
    focus?: string;
    limit?: number;
  }
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const builder = createResponseBuilder<SecuritySummaryData>();
  const limit = args.limit ?? DEFAULT_LIMIT;
  
  await store.initialize();
  
  const accessMap = store.getAccessMap();
  const sensitiveFields = store.getSensitiveAccess();
  const rules = store.getRules();
  const violations = rules ? store.checkAllViolations() : [];
  
  // Count sensitive data by type
  const sensitiveByType = {
    credentials: 0,
    financial: 0,
    health: 0,
    pii: 0,
  };
  
  for (const field of sensitiveFields) {
    const type = field.sensitivityType as keyof typeof sensitiveByType;
    if (type in sensitiveByType) {
      sensitiveByType[type]++;
    }
  }
  
  // Get top tables by access count
  const tableEntries = Object.entries(accessMap.tables)
    .map(([name, info]) => ({
      name,
      accessCount: info.accessedBy.length,
      hasSensitive: info.sensitiveFields.length > 0,
    }))
    .sort((a, b) => b.accessCount - a.accessCount)
    .slice(0, limit);
  
  // Get top sensitive fields
  const fieldCounts = new Map<string, { type: string; count: number }>();
  for (const field of sensitiveFields) {
    const key = field.table ? `${field.table}.${field.field}` : field.field;
    const existing = fieldCounts.get(key);
    if (existing) {
      existing.count++;
    } else {
      fieldCounts.set(key, { type: field.sensitivityType, count: 1 });
    }
  }
  
  const topSensitiveFields = Array.from(fieldCounts.entries())
    .map(([field, { type, count }]) => ({ field, type, accessCount: count }))
    .sort((a, b) => b.accessCount - a.accessCount)
    .slice(0, limit);
  
  // Get recent violations
  const recentViolations = violations
    .slice(0, limit)
    .map(v => ({
      file: v.file,
      line: v.line,
      message: v.message,
      severity: v.severity,
    }));
  
  const data: SecuritySummaryData = {
    overview: {
      totalTables: accessMap.stats.totalTables,
      totalAccessPoints: accessMap.stats.totalAccessPoints,
      sensitiveFields: accessMap.stats.totalSensitiveFields,
      violations: violations.length,
    },
    sensitiveData: sensitiveByType,
    topTables: tableEntries,
    topSensitiveFields,
    recentViolations,
  };
  
  // Build summary
  let summary = `${accessMap.stats.totalTables} tables, ${accessMap.stats.totalAccessPoints} access points. `;
  summary += `${accessMap.stats.totalSensitiveFields} sensitive fields. `;
  if (violations.length > 0) {
    summary += `⚠️ ${violations.length} boundary violations.`;
  } else if (rules) {
    summary += '✓ No violations.';
  } else {
    summary += 'No boundary rules configured.';
  }
  
  const hints: { nextActions: string[]; warnings?: string[]; relatedTools: string[] } = {
    nextActions: [
      violations.length > 0 
        ? 'Review violations and update boundary rules'
        : 'Use drift_patterns_list to explore security patterns',
    ],
    relatedTools: ['drift_patterns_list'],
  };
  
  if (sensitiveByType.credentials > 0) {
    hints.warnings = [`${sensitiveByType.credentials} credential access points detected`];
  }
  if (violations.length > 0) {
    hints.warnings = hints.warnings ?? [];
    hints.warnings.push(`${violations.length} boundary violations need attention`);
  }
  
  return builder
    .withSummary(summary)
    .withData(data)
    .withHints(hints)
    .buildContent();
}
