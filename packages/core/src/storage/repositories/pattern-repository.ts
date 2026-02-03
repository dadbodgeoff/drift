/**
 * Pattern Repository - SQLite implementation
 *
 * Provides CRUD operations and queries for patterns stored in SQLite.
 * Replaces the JSON-based PatternStore with a more efficient database backend.
 *
 * @module storage/repositories/pattern-repository
 */

import type Database from 'better-sqlite3';
import type {
  IPatternRepository,
  DbPattern,
  DbPatternLocation,
  DbPatternExample,
  PatternSearchQuery,
} from '../types.js';
import type { PatternCategory, PatternStatus } from '../../store/types.js';

// ============================================================================
// Pattern Repository Implementation
// ============================================================================

export class PatternRepository implements IPatternRepository {
  private readonly db: Database.Database;

  // Prepared statements (lazy initialized)
  private stmts: {
    insert?: Database.Statement;
    select?: Database.Statement;
    update?: Database.Statement;
    delete?: Database.Statement;
    exists?: Database.Statement;
    count?: Database.Statement;
    insertLocation?: Database.Statement;
    selectLocations?: Database.Statement;
    deleteLocation?: Database.Statement;
    insertExample?: Database.Statement;
    selectExamples?: Database.Statement;
  } = {};

  constructor(db: Database.Database) {
    this.db = db;
  }

  // ==========================================================================
  // CRUD Operations
  // ==========================================================================

  async create(pattern: DbPattern): Promise<string> {
    const stmt = this.getInsertStmt();
    stmt.run(
      pattern.id,
      pattern.name,
      pattern.description,
      pattern.category,
      pattern.subcategory,
      pattern.status,
      pattern.confidence_score,
      pattern.confidence_level,
      pattern.confidence_frequency,
      pattern.confidence_consistency,
      pattern.confidence_age,
      pattern.confidence_spread,
      pattern.detector_type,
      pattern.detector_config,
      pattern.severity,
      pattern.auto_fixable,
      pattern.first_seen,
      pattern.last_seen,
      pattern.approved_at,
      pattern.approved_by,
      pattern.tags,
      pattern.source
    );
    return pattern.id;
  }

  async read(id: string): Promise<DbPattern | null> {
    if (!this.stmts.select) {
      this.stmts.select = this.db.prepare('SELECT * FROM patterns WHERE id = ?');
    }
    return (this.stmts.select.get(id) as DbPattern) ?? null;
  }

  async update(id: string, updates: Partial<DbPattern>): Promise<void> {
    const fields = Object.keys(updates).filter((k) => k !== 'id');
    if (fields.length === 0) return;

    const setClause = fields.map((f) => `${f} = ?`).join(', ');
    const values = fields.map((f) => (updates as Record<string, unknown>)[f]);

    this.db.prepare(`UPDATE patterns SET ${setClause} WHERE id = ?`).run(...values, id);
  }

  async delete(id: string): Promise<boolean> {
    if (!this.stmts.delete) {
      this.stmts.delete = this.db.prepare('DELETE FROM patterns WHERE id = ?');
    }
    const result = this.stmts.delete.run(id);
    return result.changes > 0;
  }

  async exists(id: string): Promise<boolean> {
    if (!this.stmts.exists) {
      this.stmts.exists = this.db.prepare('SELECT 1 FROM patterns WHERE id = ? LIMIT 1');
    }
    return this.stmts.exists.get(id) !== undefined;
  }

  async count(filter?: Partial<DbPattern>): Promise<number> {
    if (!filter || Object.keys(filter).length === 0) {
      if (!this.stmts.count) {
        this.stmts.count = this.db.prepare('SELECT COUNT(*) as count FROM patterns');
      }
      return (this.stmts.count.get() as { count: number }).count;
    }

    const conditions = Object.keys(filter).map((k) => `${k} = ?`);
    const values = Object.values(filter);
    const result = this.db
      .prepare(`SELECT COUNT(*) as count FROM patterns WHERE ${conditions.join(' AND ')}`)
      .get(...values) as { count: number };
    return result.count;
  }

  // ==========================================================================
  // Bulk Operations
  // ==========================================================================

  async bulkCreate(patterns: DbPattern[]): Promise<string[]> {
    const stmt = this.getInsertStmt();
    const insertMany = this.db.transaction((items: DbPattern[]) => {
      for (const pattern of items) {
        stmt.run(
          pattern.id,
          pattern.name,
          pattern.description,
          pattern.category,
          pattern.subcategory,
          pattern.status,
          pattern.confidence_score,
          pattern.confidence_level,
          pattern.confidence_frequency,
          pattern.confidence_consistency,
          pattern.confidence_age,
          pattern.confidence_spread,
          pattern.detector_type,
          pattern.detector_config,
          pattern.severity,
          pattern.auto_fixable,
          pattern.first_seen,
          pattern.last_seen,
          pattern.approved_at,
          pattern.approved_by,
          pattern.tags,
          pattern.source
        );
      }
    });

    insertMany(patterns);
    return patterns.map((p) => p.id);
  }

  async bulkUpdate(updates: Array<{ id: string; updates: Partial<DbPattern> }>): Promise<void> {
    const updateMany = this.db.transaction((items: Array<{ id: string; updates: Partial<DbPattern> }>) => {
      for (const { id, updates: u } of items) {
        const fields = Object.keys(u).filter((k) => k !== 'id');
        if (fields.length === 0) continue;

        const setClause = fields.map((f) => `${f} = ?`).join(', ');
        const values = fields.map((f) => (u as Record<string, unknown>)[f]);

        this.db.prepare(`UPDATE patterns SET ${setClause} WHERE id = ?`).run(...values, id);
      }
    });

    updateMany(updates);
  }

  // ==========================================================================
  // Queries
  // ==========================================================================

  async findByCategory(category: PatternCategory): Promise<DbPattern[]> {
    return this.db
      .prepare('SELECT * FROM patterns WHERE category = ?')
      .all(category) as DbPattern[];
  }

  async findByStatus(status: PatternStatus): Promise<DbPattern[]> {
    return this.db
      .prepare('SELECT * FROM patterns WHERE status = ?')
      .all(status) as DbPattern[];
  }

  async findByFile(file: string): Promise<DbPattern[]> {
    return this.db
      .prepare(`
        SELECT DISTINCT p.* FROM patterns p
        JOIN pattern_locations pl ON p.id = pl.pattern_id
        WHERE pl.file = ?
      `)
      .all(file) as DbPattern[];
  }

  async findByConfidence(min: number, max?: number): Promise<DbPattern[]> {
    if (max !== undefined) {
      return this.db
        .prepare('SELECT * FROM patterns WHERE confidence_score >= ? AND confidence_score <= ?')
        .all(min, max) as DbPattern[];
    }
    return this.db
      .prepare('SELECT * FROM patterns WHERE confidence_score >= ?')
      .all(min) as DbPattern[];
  }

  async search(query: PatternSearchQuery): Promise<DbPattern[]> {
    const conditions: string[] = [];
    const values: unknown[] = [];

    // Build WHERE clause from query
    if (query.ids && query.ids.length > 0) {
      conditions.push(`id IN (${query.ids.map(() => '?').join(', ')})`);
      values.push(...query.ids);
    }

    if (query.category) {
      const categories = Array.isArray(query.category) ? query.category : [query.category];
      conditions.push(`category IN (${categories.map(() => '?').join(', ')})`);
      values.push(...categories);
    }

    if (query.subcategory) {
      const subcategories = Array.isArray(query.subcategory) ? query.subcategory : [query.subcategory];
      conditions.push(`subcategory IN (${subcategories.map(() => '?').join(', ')})`);
      values.push(...subcategories);
    }

    if (query.status) {
      const statuses = Array.isArray(query.status) ? query.status : [query.status];
      conditions.push(`status IN (${statuses.map(() => '?').join(', ')})`);
      values.push(...statuses);
    }

    if (query.minConfidence !== undefined) {
      conditions.push('confidence_score >= ?');
      values.push(query.minConfidence);
    }

    if (query.maxConfidence !== undefined) {
      conditions.push('confidence_score <= ?');
      values.push(query.maxConfidence);
    }

    if (query.confidenceLevel) {
      const levels = Array.isArray(query.confidenceLevel) ? query.confidenceLevel : [query.confidenceLevel];
      conditions.push(`confidence_level IN (${levels.map(() => '?').join(', ')})`);
      values.push(...levels);
    }

    if (query.severity) {
      const severities = Array.isArray(query.severity) ? query.severity : [query.severity];
      conditions.push(`severity IN (${severities.map(() => '?').join(', ')})`);
      values.push(...severities);
    }

    if (query.autoFixable !== undefined) {
      conditions.push('auto_fixable = ?');
      values.push(query.autoFixable ? 1 : 0);
    }

    if (query.hasOutliers !== undefined) {
      if (query.hasOutliers) {
        conditions.push('outlier_count > 0');
      } else {
        conditions.push('outlier_count = 0');
      }
    }

    if (query.minOutliers !== undefined) {
      conditions.push('outlier_count >= ?');
      values.push(query.minOutliers);
    }

    if (query.search) {
      conditions.push('(name LIKE ? OR description LIKE ?)');
      const searchPattern = `%${query.search}%`;
      values.push(searchPattern, searchPattern);
    }

    if (query.createdAfter) {
      conditions.push('first_seen > ?');
      values.push(query.createdAfter);
    }

    if (query.createdBefore) {
      conditions.push('first_seen < ?');
      values.push(query.createdBefore);
    }

    if (query.seenAfter) {
      conditions.push('last_seen > ?');
      values.push(query.seenAfter);
    }

    if (query.seenBefore) {
      conditions.push('last_seen < ?');
      values.push(query.seenBefore);
    }

    // Handle file filter (requires join)
    let sql = 'SELECT DISTINCT p.* FROM patterns p';
    if (query.file || query.files) {
      sql += ' JOIN pattern_locations pl ON p.id = pl.pattern_id';
      if (query.file) {
        conditions.push('pl.file = ?');
        values.push(query.file);
      }
      if (query.files && query.files.length > 0) {
        conditions.push(`pl.file IN (${query.files.map(() => '?').join(', ')})`);
        values.push(...query.files);
      }
    }

    if (conditions.length > 0) {
      sql += ` WHERE ${conditions.join(' AND ')}`;
    }

    // Order by
    const orderField = query.orderBy ?? 'confidence_score';
    const orderDir = query.orderDir ?? 'desc';
    const fieldMap: Record<string, string> = {
      name: 'name',
      confidence: 'confidence_score',
      severity: 'severity',
      firstSeen: 'first_seen',
      lastSeen: 'last_seen',
      outlierCount: 'outlier_count',
      locationCount: 'location_count',
    };
    sql += ` ORDER BY p.${fieldMap[orderField] ?? 'confidence_score'} ${orderDir.toUpperCase()}`;

    // Pagination
    if (query.limit !== undefined) {
      sql += ' LIMIT ?';
      values.push(query.limit);
    }
    if (query.offset !== undefined) {
      sql += ' OFFSET ?';
      values.push(query.offset);
    }

    return this.db.prepare(sql).all(...values) as DbPattern[];
  }

  // ==========================================================================
  // Aggregations
  // ==========================================================================

  async countByCategory(): Promise<Record<PatternCategory, number>> {
    const rows = this.db
      .prepare('SELECT category, COUNT(*) as count FROM patterns GROUP BY category')
      .all() as Array<{ category: PatternCategory; count: number }>;

    const result: Record<string, number> = {};
    for (const row of rows) {
      result[row.category] = row.count;
    }
    return result as Record<PatternCategory, number>;
  }

  async countByStatus(): Promise<Record<PatternStatus, number>> {
    const rows = this.db
      .prepare('SELECT status, COUNT(*) as count FROM patterns GROUP BY status')
      .all() as Array<{ status: PatternStatus; count: number }>;

    const result: Record<string, number> = {
      discovered: 0,
      approved: 0,
      ignored: 0,
    };
    for (const row of rows) {
      result[row.status] = row.count;
    }
    return result as Record<PatternStatus, number>;
  }

  // ==========================================================================
  // State Transitions
  // ==========================================================================

  async approve(id: string, approvedBy?: string): Promise<void> {
    const now = new Date().toISOString();
    this.db
      .prepare(`
        UPDATE patterns 
        SET status = 'approved', approved_at = ?, approved_by = ?, last_seen = ?
        WHERE id = ?
      `)
      .run(now, approvedBy ?? null, now, id);
  }

  async ignore(id: string): Promise<void> {
    const now = new Date().toISOString();
    this.db
      .prepare(`
        UPDATE patterns 
        SET status = 'ignored', last_seen = ?
        WHERE id = ?
      `)
      .run(now, id);
  }

  // ==========================================================================
  // Locations
  // ==========================================================================

  async addLocation(patternId: string, location: DbPatternLocation): Promise<void> {
    if (!this.stmts.insertLocation) {
      this.stmts.insertLocation = this.db.prepare(`
        INSERT OR REPLACE INTO pattern_locations 
        (pattern_id, file, line, column_num, end_line, end_column, is_outlier, outlier_reason, deviation_score, confidence, snippet)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
    }

    this.stmts.insertLocation.run(
      patternId,
      location.file,
      location.line,
      location.column_num,
      location.end_line,
      location.end_column,
      location.is_outlier,
      location.outlier_reason,
      location.deviation_score,
      location.confidence,
      location.snippet
    );
  }

  async removeLocation(patternId: string, file: string, line: number): Promise<void> {
    if (!this.stmts.deleteLocation) {
      this.stmts.deleteLocation = this.db.prepare(
        'DELETE FROM pattern_locations WHERE pattern_id = ? AND file = ? AND line = ?'
      );
    }
    this.stmts.deleteLocation.run(patternId, file, line);
  }

  async getLocations(patternId: string): Promise<DbPatternLocation[]> {
    if (!this.stmts.selectLocations) {
      this.stmts.selectLocations = this.db.prepare(
        'SELECT * FROM pattern_locations WHERE pattern_id = ? AND is_outlier = 0'
      );
    }
    return this.stmts.selectLocations.all(patternId) as DbPatternLocation[];
  }

  async getOutliers(patternId: string): Promise<DbPatternLocation[]> {
    return this.db
      .prepare('SELECT * FROM pattern_locations WHERE pattern_id = ? AND is_outlier = 1')
      .all(patternId) as DbPatternLocation[];
  }

  // ==========================================================================
  // Examples
  // ==========================================================================

  async addExample(patternId: string, example: DbPatternExample): Promise<void> {
    if (!this.stmts.insertExample) {
      this.stmts.insertExample = this.db.prepare(`
        INSERT INTO pattern_examples 
        (pattern_id, file, line, end_line, code, context, quality, is_outlier, extracted_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
    }

    this.stmts.insertExample.run(
      patternId,
      example.file,
      example.line,
      example.end_line,
      example.code,
      example.context,
      example.quality,
      example.is_outlier,
      example.extracted_at
    );
  }

  async getExamples(patternId: string, limit = 5): Promise<DbPatternExample[]> {
    return this.db
      .prepare('SELECT * FROM pattern_examples WHERE pattern_id = ? ORDER BY quality DESC LIMIT ?')
      .all(patternId, limit) as DbPatternExample[];
  }

  // ==========================================================================
  // Helpers
  // ==========================================================================

  private getInsertStmt(): Database.Statement {
    if (!this.stmts.insert) {
      this.stmts.insert = this.db.prepare(`
        INSERT INTO patterns (
          id, name, description, category, subcategory, status,
          confidence_score, confidence_level, confidence_frequency, confidence_consistency, confidence_age, confidence_spread,
          detector_type, detector_config, severity, auto_fixable,
          first_seen, last_seen, approved_at, approved_by, tags, source
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
    }
    return this.stmts.insert;
  }
}
