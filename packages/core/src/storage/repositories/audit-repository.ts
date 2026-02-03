/**
 * Audit Repository - SQLite implementation
 *
 * Provides operations for audit snapshots, history, trends, and scan tracking.
 *
 * @module storage/repositories/audit-repository
 */

import type Database from 'better-sqlite3';
import type {
  IAuditRepository,
  DbAuditSnapshot,
  DbPatternHistoryEvent,
  DbHealthTrend,
  DbScanHistory,
} from '../types.js';

// ============================================================================
// Audit Repository Implementation
// ============================================================================

export class AuditRepository implements IAuditRepository {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  // ==========================================================================
  // Snapshots
  // ==========================================================================

  async addSnapshot(snapshot: DbAuditSnapshot): Promise<number> {
    const result = this.db.prepare(`
      INSERT OR REPLACE INTO audit_snapshots 
      (date, scan_hash, health_score, total_patterns, auto_approve_eligible, 
       flagged_for_review, likely_false_positives, duplicate_candidates,
       avg_confidence, cross_validation_score, summary)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      snapshot.date,
      snapshot.scan_hash,
      snapshot.health_score,
      snapshot.total_patterns,
      snapshot.auto_approve_eligible,
      snapshot.flagged_for_review,
      snapshot.likely_false_positives,
      snapshot.duplicate_candidates,
      snapshot.avg_confidence,
      snapshot.cross_validation_score,
      snapshot.summary
    );
    return result.lastInsertRowid as number;
  }

  async getLatestSnapshot(): Promise<DbAuditSnapshot | null> {
    return (this.db
      .prepare('SELECT * FROM audit_snapshots ORDER BY date DESC LIMIT 1')
      .get() as DbAuditSnapshot) ?? null;
  }

  async getSnapshot(date: string): Promise<DbAuditSnapshot | null> {
    return (this.db
      .prepare('SELECT * FROM audit_snapshots WHERE date = ?')
      .get(date) as DbAuditSnapshot) ?? null;
  }

  async getSnapshots(startDate?: string, endDate?: string): Promise<DbAuditSnapshot[]> {
    if (startDate && endDate) {
      return this.db
        .prepare('SELECT * FROM audit_snapshots WHERE date >= ? AND date <= ? ORDER BY date DESC')
        .all(startDate, endDate) as DbAuditSnapshot[];
    }
    if (startDate) {
      return this.db
        .prepare('SELECT * FROM audit_snapshots WHERE date >= ? ORDER BY date DESC')
        .all(startDate) as DbAuditSnapshot[];
    }
    if (endDate) {
      return this.db
        .prepare('SELECT * FROM audit_snapshots WHERE date <= ? ORDER BY date DESC')
        .all(endDate) as DbAuditSnapshot[];
    }
    return this.db
      .prepare('SELECT * FROM audit_snapshots ORDER BY date DESC')
      .all() as DbAuditSnapshot[];
  }

  // ==========================================================================
  // History
  // ==========================================================================

  async addHistoryEvent(event: DbPatternHistoryEvent): Promise<void> {
    this.db.prepare(`
      INSERT INTO pattern_history 
      (date, pattern_id, action, previous_status, new_status, changed_by, details)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      event.date,
      event.pattern_id,
      event.action,
      event.previous_status,
      event.new_status,
      event.changed_by,
      event.details
    );
  }

  async getHistory(patternId: string): Promise<DbPatternHistoryEvent[]> {
    return this.db
      .prepare('SELECT * FROM pattern_history WHERE pattern_id = ? ORDER BY date DESC')
      .all(patternId) as DbPatternHistoryEvent[];
  }

  async getHistoryByDate(date: string): Promise<DbPatternHistoryEvent[]> {
    return this.db
      .prepare('SELECT * FROM pattern_history WHERE date LIKE ? ORDER BY date DESC')
      .all(`${date}%`) as DbPatternHistoryEvent[];
  }

  // ==========================================================================
  // Trends
  // ==========================================================================

  async addTrend(trend: DbHealthTrend): Promise<void> {
    this.db.prepare(`
      INSERT OR REPLACE INTO health_trends 
      (date, health_score, avg_confidence, total_patterns, approved_count, duplicate_groups, cross_validation_score)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      trend.date,
      trend.health_score,
      trend.avg_confidence,
      trend.total_patterns,
      trend.approved_count,
      trend.duplicate_groups,
      trend.cross_validation_score
    );
  }

  async getTrends(days = 30): Promise<DbHealthTrend[]> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const cutoffStr = cutoff.toISOString().split('T')[0];

    return this.db
      .prepare('SELECT * FROM health_trends WHERE date >= ? ORDER BY date DESC')
      .all(cutoffStr) as DbHealthTrend[];
  }

  // ==========================================================================
  // Scans
  // ==========================================================================

  async addScan(scan: DbScanHistory): Promise<void> {
    this.db.prepare(`
      INSERT INTO scan_history 
      (scan_id, started_at, completed_at, duration_ms, files_scanned, patterns_found, patterns_approved, errors, status, error_message, checksum)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      scan.scan_id,
      scan.started_at,
      scan.completed_at,
      scan.duration_ms,
      scan.files_scanned,
      scan.patterns_found,
      scan.patterns_approved,
      scan.errors,
      scan.status,
      scan.error_message,
      scan.checksum
    );
  }

  async getLatestScan(): Promise<DbScanHistory | null> {
    return (this.db
      .prepare('SELECT * FROM scan_history ORDER BY started_at DESC LIMIT 1')
      .get() as DbScanHistory) ?? null;
  }

  async getScans(limit = 10): Promise<DbScanHistory[]> {
    return this.db
      .prepare('SELECT * FROM scan_history ORDER BY started_at DESC LIMIT ?')
      .all(limit) as DbScanHistory[];
  }
}
