/**
 * Environment Repository - SQLite implementation
 *
 * Provides operations for environment variables and their access points.
 *
 * @module storage/repositories/environment-repository
 */

import type Database from 'better-sqlite3';
import type {
  IEnvironmentRepository,
  DbEnvVariable,
  DbEnvAccessPoint,
  DbEnvSensitivity,
} from '../types.js';

// ============================================================================
// Environment Repository Implementation
// ============================================================================

export class EnvironmentRepository implements IEnvironmentRepository {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  // ==========================================================================
  // Variables
  // ==========================================================================

  async addVariable(variable: DbEnvVariable): Promise<void> {
    this.db.prepare(`
      INSERT OR REPLACE INTO env_variables 
      (name, sensitivity, has_default, is_required, default_value)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      variable.name,
      variable.sensitivity,
      variable.has_default,
      variable.is_required,
      variable.default_value
    );
  }

  async getVariable(name: string): Promise<DbEnvVariable | null> {
    return (this.db.prepare('SELECT * FROM env_variables WHERE name = ?').get(name) as DbEnvVariable) ?? null;
  }

  async getVariables(sensitivity?: DbEnvSensitivity): Promise<DbEnvVariable[]> {
    if (sensitivity) {
      return this.db
        .prepare('SELECT * FROM env_variables WHERE sensitivity = ?')
        .all(sensitivity) as DbEnvVariable[];
    }
    return this.db.prepare('SELECT * FROM env_variables').all() as DbEnvVariable[];
  }

  async getSecrets(): Promise<DbEnvVariable[]> {
    return this.db
      .prepare("SELECT * FROM env_variables WHERE sensitivity IN ('secret', 'credential')")
      .all() as DbEnvVariable[];
  }

  async getRequired(): Promise<DbEnvVariable[]> {
    return this.db
      .prepare('SELECT * FROM env_variables WHERE is_required = 1 AND has_default = 0')
      .all() as DbEnvVariable[];
  }

  // ==========================================================================
  // Access Points
  // ==========================================================================

  async addAccessPoint(point: DbEnvAccessPoint): Promise<void> {
    this.db.prepare(`
      INSERT OR REPLACE INTO env_access_points 
      (id, var_name, method, file, line, column_num, context, language, confidence, has_default, default_value, is_required)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      point.id,
      point.var_name,
      point.method,
      point.file,
      point.line,
      point.column_num,
      point.context,
      point.language,
      point.confidence,
      point.has_default,
      point.default_value,
      point.is_required
    );
  }

  async getAccessPoints(varName?: string): Promise<DbEnvAccessPoint[]> {
    if (varName) {
      return this.db
        .prepare('SELECT * FROM env_access_points WHERE var_name = ?')
        .all(varName) as DbEnvAccessPoint[];
    }
    return this.db.prepare('SELECT * FROM env_access_points').all() as DbEnvAccessPoint[];
  }

  async getAccessPointsByFile(file: string): Promise<DbEnvAccessPoint[]> {
    return this.db
      .prepare('SELECT * FROM env_access_points WHERE file = ?')
      .all(file) as DbEnvAccessPoint[];
  }
}
