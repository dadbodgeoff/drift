/**
 * Boundary Repository - SQLite implementation
 *
 * Provides operations for data models, sensitive fields, and access points.
 *
 * @module storage/repositories/boundary-repository
 */

import type Database from 'better-sqlite3';
import type {
  IBoundaryRepository,
  DbDataModel,
  DbSensitiveField,
  DbDataAccessPoint,
  DbTableAccess,
  DbSensitiveAccess,
} from '../types.js';

// ============================================================================
// Boundary Repository Implementation
// ============================================================================

export class BoundaryRepository implements IBoundaryRepository {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  // ==========================================================================
  // Models
  // ==========================================================================

  async addModel(model: DbDataModel): Promise<number> {
    const result = this.db.prepare(`
      INSERT OR REPLACE INTO data_models 
      (name, table_name, file, line, framework, confidence, fields)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      model.name,
      model.table_name,
      model.file,
      model.line,
      model.framework,
      model.confidence,
      model.fields
    );
    return result.lastInsertRowid as number;
  }

  async getModels(): Promise<DbDataModel[]> {
    return this.db.prepare('SELECT * FROM data_models').all() as DbDataModel[];
  }

  async getModelByTable(tableName: string): Promise<DbDataModel | null> {
    return (this.db.prepare('SELECT * FROM data_models WHERE table_name = ?').get(tableName) as DbDataModel) ?? null;
  }

  // ==========================================================================
  // Sensitive Fields
  // ==========================================================================

  async addSensitiveField(field: DbSensitiveField): Promise<number> {
    const result = this.db.prepare(`
      INSERT OR REPLACE INTO sensitive_fields 
      (table_name, field_name, sensitivity, reason)
      VALUES (?, ?, ?, ?)
    `).run(
      field.table_name,
      field.field_name,
      field.sensitivity,
      field.reason
    );
    return result.lastInsertRowid as number;
  }

  async getSensitiveFields(tableName?: string): Promise<DbSensitiveField[]> {
    if (tableName) {
      return this.db
        .prepare('SELECT * FROM sensitive_fields WHERE table_name = ?')
        .all(tableName) as DbSensitiveField[];
    }
    return this.db.prepare('SELECT * FROM sensitive_fields').all() as DbSensitiveField[];
  }

  // ==========================================================================
  // Access Points
  // ==========================================================================

  async addAccessPoint(point: DbDataAccessPoint): Promise<void> {
    this.db.prepare(`
      INSERT OR REPLACE INTO data_access_points 
      (id, table_name, operation, file, line, column_num, context, fields, is_raw_sql, confidence, function_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      point.id,
      point.table_name,
      point.operation,
      point.file,
      point.line,
      point.column_num,
      point.context,
      point.fields,
      point.is_raw_sql,
      point.confidence,
      point.function_id
    );
  }

  async getAccessPoints(tableName?: string): Promise<DbDataAccessPoint[]> {
    if (tableName) {
      return this.db
        .prepare('SELECT * FROM data_access_points WHERE table_name = ?')
        .all(tableName) as DbDataAccessPoint[];
    }
    return this.db.prepare('SELECT * FROM data_access_points').all() as DbDataAccessPoint[];
  }

  async getAccessPointsByFile(file: string): Promise<DbDataAccessPoint[]> {
    return this.db
      .prepare('SELECT * FROM data_access_points WHERE file = ?')
      .all(file) as DbDataAccessPoint[];
  }

  // ==========================================================================
  // Queries
  // ==========================================================================

  async getTableAccess(tableName: string): Promise<DbTableAccess> {
    const model = await this.getModelByTable(tableName);
    const sensitiveFields = await this.getSensitiveFields(tableName);
    const accessPoints = await this.getAccessPoints(tableName);

    // Extract all fields from access points
    const fieldsSet = new Set<string>();
    for (const ap of accessPoints) {
      if (ap.fields) {
        const fields = JSON.parse(ap.fields) as string[];
        for (const f of fields) {
          fieldsSet.add(f);
        }
      }
    }

    return {
      table_name: tableName,
      model,
      fields: Array.from(fieldsSet),
      sensitive_fields: sensitiveFields,
      access_points: accessPoints,
    };
  }

  async getSensitiveAccess(): Promise<DbSensitiveAccess[]> {
    const sensitiveFields = await this.getSensitiveFields();
    const result: DbSensitiveAccess[] = [];

    for (const sf of sensitiveFields) {
      const accessPoints = this.db
        .prepare(`
          SELECT * FROM data_access_points 
          WHERE table_name = ? AND fields LIKE ?
        `)
        .all(sf.table_name, `%"${sf.field_name}"%`) as DbDataAccessPoint[];

      result.push({
        table_name: sf.table_name,
        field_name: sf.field_name,
        sensitivity: sf.sensitivity,
        access_points: accessPoints,
      });
    }

    return result;
  }
}
