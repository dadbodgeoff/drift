/**
 * Constraint Repository - SQLite implementation
 *
 * Provides CRUD operations and queries for constraints stored in SQLite.
 *
 * @module storage/repositories/constraint-repository
 */

import type Database from 'better-sqlite3';
import type {
  IConstraintRepository,
  DbConstraint,
  DbConstraintStatus,
  DbConstraintCounts,
} from '../types.js';

// ============================================================================
// Constraint Repository Implementation
// ============================================================================

export class ConstraintRepository implements IConstraintRepository {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  // ==========================================================================
  // CRUD Operations
  // ==========================================================================

  async create(constraint: DbConstraint): Promise<string> {
    this.db.prepare(`
      INSERT INTO constraints (
        id, name, description, category, status, language,
        invariant, scope, enforcement_level, enforcement_message, enforcement_autofix,
        confidence_score, confidence_evidence, confidence_violations,
        created_at, updated_at, approved_at, approved_by, ignored_at, ignore_reason, tags, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      constraint.id,
      constraint.name,
      constraint.description,
      constraint.category,
      constraint.status,
      constraint.language,
      constraint.invariant,
      constraint.scope,
      constraint.enforcement_level,
      constraint.enforcement_message,
      constraint.enforcement_autofix,
      constraint.confidence_score,
      constraint.confidence_evidence,
      constraint.confidence_violations,
      constraint.created_at,
      constraint.updated_at,
      constraint.approved_at,
      constraint.approved_by,
      constraint.ignored_at,
      constraint.ignore_reason,
      constraint.tags,
      constraint.notes
    );
    return constraint.id;
  }

  async read(id: string): Promise<DbConstraint | null> {
    return (this.db.prepare('SELECT * FROM constraints WHERE id = ?').get(id) as DbConstraint) ?? null;
  }

  async update(id: string, updates: Partial<DbConstraint>): Promise<void> {
    const fields = Object.keys(updates).filter((k) => k !== 'id');
    if (fields.length === 0) return;

    // Always update updated_at
    const now = new Date().toISOString();
    const allFields = [...fields, 'updated_at'];
    const allValues = [...fields.map((f) => (updates as Record<string, unknown>)[f]), now];

    const setClause = allFields.map((f) => `${f} = ?`).join(', ');
    this.db.prepare(`UPDATE constraints SET ${setClause} WHERE id = ?`).run(...allValues, id);
  }

  async delete(id: string): Promise<boolean> {
    const result = this.db.prepare('DELETE FROM constraints WHERE id = ?').run(id);
    return result.changes > 0;
  }

  async exists(id: string): Promise<boolean> {
    return this.db.prepare('SELECT 1 FROM constraints WHERE id = ? LIMIT 1').get(id) !== undefined;
  }

  async count(filter?: Partial<DbConstraint>): Promise<number> {
    if (!filter || Object.keys(filter).length === 0) {
      return (this.db.prepare('SELECT COUNT(*) as count FROM constraints').get() as { count: number }).count;
    }

    const conditions = Object.keys(filter).map((k) => `${k} = ?`);
    const values = Object.values(filter);
    const result = this.db
      .prepare(`SELECT COUNT(*) as count FROM constraints WHERE ${conditions.join(' AND ')}`)
      .get(...values) as { count: number };
    return result.count;
  }

  // ==========================================================================
  // Queries
  // ==========================================================================

  async findByCategory(category: string): Promise<DbConstraint[]> {
    return this.db
      .prepare('SELECT * FROM constraints WHERE category = ?')
      .all(category) as DbConstraint[];
  }

  async findByStatus(status: DbConstraintStatus): Promise<DbConstraint[]> {
    return this.db
      .prepare('SELECT * FROM constraints WHERE status = ?')
      .all(status) as DbConstraint[];
  }

  async findByLanguage(language: string): Promise<DbConstraint[]> {
    return this.db
      .prepare("SELECT * FROM constraints WHERE language = ? OR language = 'all'")
      .all(language) as DbConstraint[];
  }

  async findForFile(filePath: string): Promise<DbConstraint[]> {
    // Get file extension to determine language
    const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
    const languageMap: Record<string, string> = {
      ts: 'typescript',
      tsx: 'typescript',
      js: 'javascript',
      jsx: 'javascript',
      py: 'python',
      java: 'java',
      cs: 'csharp',
      php: 'php',
      go: 'go',
    };
    const language = languageMap[ext] ?? 'all';

    return this.db
      .prepare(`
        SELECT * FROM constraints 
        WHERE (language = ? OR language = 'all')
        AND status IN ('approved', 'custom')
      `)
      .all(language) as DbConstraint[];
  }

  // ==========================================================================
  // State Transitions
  // ==========================================================================

  async approve(id: string, approvedBy?: string): Promise<void> {
    const now = new Date().toISOString();
    this.db
      .prepare(`
        UPDATE constraints 
        SET status = 'approved', approved_at = ?, approved_by = ?, updated_at = ?
        WHERE id = ?
      `)
      .run(now, approvedBy ?? null, now, id);
  }

  async ignore(id: string, reason?: string): Promise<void> {
    const now = new Date().toISOString();
    this.db
      .prepare(`
        UPDATE constraints 
        SET status = 'ignored', ignored_at = ?, ignore_reason = ?, updated_at = ?
        WHERE id = ?
      `)
      .run(now, reason ?? null, now, id);
  }

  // ==========================================================================
  // Aggregations
  // ==========================================================================

  async getCounts(): Promise<DbConstraintCounts> {
    const total = (this.db.prepare('SELECT COUNT(*) as count FROM constraints').get() as { count: number }).count;

    const byStatusRows = this.db
      .prepare('SELECT status, COUNT(*) as count FROM constraints GROUP BY status')
      .all() as Array<{ status: DbConstraintStatus; count: number }>;

    const byCategoryRows = this.db
      .prepare('SELECT category, COUNT(*) as count FROM constraints GROUP BY category')
      .all() as Array<{ category: string; count: number }>;

    const byLanguageRows = this.db
      .prepare('SELECT language, COUNT(*) as count FROM constraints GROUP BY language')
      .all() as Array<{ language: string; count: number }>;

    const byEnforcementRows = this.db
      .prepare('SELECT enforcement_level, COUNT(*) as count FROM constraints GROUP BY enforcement_level')
      .all() as Array<{ enforcement_level: 'error' | 'warning' | 'info'; count: number }>;

    const byStatus: Record<DbConstraintStatus, number> = {
      discovered: 0,
      approved: 0,
      ignored: 0,
      custom: 0,
    };
    for (const row of byStatusRows) {
      byStatus[row.status] = row.count;
    }

    const byCategory: Record<string, number> = {};
    for (const row of byCategoryRows) {
      byCategory[row.category] = row.count;
    }

    const byLanguage: Record<string, number> = {};
    for (const row of byLanguageRows) {
      byLanguage[row.language] = row.count;
    }

    const byEnforcement: Record<'error' | 'warning' | 'info', number> = {
      error: 0,
      warning: 0,
      info: 0,
    };
    for (const row of byEnforcementRows) {
      byEnforcement[row.enforcement_level] = row.count;
    }

    return {
      total,
      byStatus,
      byCategory,
      byLanguage,
      byEnforcement,
    };
  }
}
