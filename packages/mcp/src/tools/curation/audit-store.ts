/**
 * Curation Audit Store - Persists curation decisions
 * 
 * Maintains audit trail of all pattern approvals/ignores.
 * 
 * @module tools/curation/audit-store
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as crypto from 'node:crypto';

import type { CurationAuditEntry } from './types.js';
import { CURATION_CONSTANTS } from './types.js';

const DRIFT_DIR = '.drift';

interface AuditFile {
  version: string;
  entries: CurationAuditEntry[];
  lastUpdated: string;
}

/**
 * Load audit entries from disk
 */
export async function loadAuditEntries(
  projectRoot: string
): Promise<CurationAuditEntry[]> {
  const auditPath = path.join(
    projectRoot, 
    DRIFT_DIR, 
    CURATION_CONSTANTS.AUDIT_FILE
  );
  
  try {
    const content = await fs.readFile(auditPath, 'utf-8');
    const data = JSON.parse(content) as AuditFile;
    return data.entries ?? [];
  } catch {
    return [];
  }
}

/**
 * Save audit entry to disk
 */
export async function saveAuditEntry(
  projectRoot: string,
  entry: Omit<CurationAuditEntry, 'id' | 'timestamp'>
): Promise<CurationAuditEntry> {
  const auditPath = path.join(
    projectRoot, 
    DRIFT_DIR, 
    CURATION_CONSTANTS.AUDIT_FILE
  );
  
  // Load existing entries
  const entries = await loadAuditEntries(projectRoot);
  
  // Create new entry with ID and timestamp
  const newEntry: CurationAuditEntry = {
    ...entry,
    id: crypto.randomUUID().slice(0, 8),
    timestamp: new Date().toISOString(),
  };

  entries.push(newEntry);
  
  // Save to disk
  const auditFile: AuditFile = {
    version: '1.0.0',
    entries,
    lastUpdated: new Date().toISOString(),
  };
  
  await fs.writeFile(auditPath, JSON.stringify(auditFile, null, 2));
  
  return newEntry;
}

/**
 * Get audit summary statistics
 */
export function getAuditSummary(entries: CurationAuditEntry[]): {
  totalDecisions: number;
  approved: number;
  ignored: number;
  bulkApproved: number;
  byCategory: Record<string, number>;
  recentDecisions: CurationAuditEntry[];
} {
  const byCategory: Record<string, number> = {};
  let approved = 0;
  let ignored = 0;
  let bulkApproved = 0;
  
  for (const entry of entries) {
    byCategory[entry.category] = (byCategory[entry.category] ?? 0) + 1;
    
    if (entry.action === 'approve') approved++;
    else if (entry.action === 'ignore') ignored++;
    else if (entry.action === 'bulk_approve') bulkApproved++;
  }
  
  return {
    totalDecisions: entries.length,
    approved,
    ignored,
    bulkApproved,
    byCategory,
    recentDecisions: entries.slice(-10).reverse(),
  };
}
