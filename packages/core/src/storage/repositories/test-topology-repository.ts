/**
 * Test Topology Repository - SQLite implementation
 *
 * Provides operations for test files and coverage tracking.
 *
 * @module storage/repositories/test-topology-repository
 */

import type Database from 'better-sqlite3';
import type {
  ITestTopologyRepository,
  DbTestFile,
  DbTestCoverage,
} from '../types.js';

// ============================================================================
// Test Topology Repository Implementation
// ============================================================================

export class TestTopologyRepository implements ITestTopologyRepository {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  // ==========================================================================
  // Test Files
  // ==========================================================================

  async addTestFile(file: DbTestFile): Promise<void> {
    this.db.prepare(`
      INSERT OR REPLACE INTO test_files 
      (file, test_framework, test_count, last_run, status)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      file.file,
      file.test_framework,
      file.test_count,
      file.last_run,
      file.status
    );
  }

  async getTestFiles(): Promise<DbTestFile[]> {
    return this.db.prepare('SELECT * FROM test_files').all() as DbTestFile[];
  }

  async getTestFile(file: string): Promise<DbTestFile | null> {
    return (this.db
      .prepare('SELECT * FROM test_files WHERE file = ?')
      .get(file) as DbTestFile) ?? null;
  }

  // ==========================================================================
  // Coverage
  // ==========================================================================

  async addCoverage(coverage: DbTestCoverage): Promise<void> {
    this.db.prepare(`
      INSERT OR REPLACE INTO test_coverage 
      (test_file, source_file, function_id, coverage_type, confidence)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      coverage.test_file,
      coverage.source_file,
      coverage.function_id,
      coverage.coverage_type,
      coverage.confidence
    );
  }

  async getCoverage(sourceFile: string): Promise<DbTestCoverage[]> {
    return this.db
      .prepare('SELECT * FROM test_coverage WHERE source_file = ?')
      .all(sourceFile) as DbTestCoverage[];
  }

  async getTestsForFile(sourceFile: string): Promise<string[]> {
    const rows = this.db
      .prepare('SELECT DISTINCT test_file FROM test_coverage WHERE source_file = ?')
      .all(sourceFile) as Array<{ test_file: string }>;
    return rows.map((r) => r.test_file);
  }

  async getUncoveredFiles(): Promise<string[]> {
    // Get all source files from functions that are not in test_coverage
    const rows = this.db
      .prepare(`
        SELECT DISTINCT f.file 
        FROM functions f
        WHERE f.file NOT LIKE '%test%'
        AND f.file NOT LIKE '%spec%'
        AND f.file NOT IN (SELECT DISTINCT source_file FROM test_coverage)
      `)
      .all() as Array<{ file: string }>;
    return rows.map((r) => r.file);
  }
}
