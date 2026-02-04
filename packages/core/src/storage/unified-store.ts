/**
 * Unified Store - Main SQLite storage implementation
 *
 * This class provides the main interface for all database operations.
 * It manages the SQLite connection and provides access to all repositories.
 *
 * @module storage/unified-store
 */

import Database from 'better-sqlite3';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import type {
  IUnifiedStore,
  IPatternRepository,
  IContractRepository,
  IConstraintRepository,
  IBoundaryRepository,
  IEnvironmentRepository,
  ICallGraphRepository,
  IAuditRepository,
  IDNARepository,
  ITestTopologyRepository,
  UnifiedStoreConfig,
  SyncLogEntry,
  StoreStats,
} from './types.js';
import { DEFAULT_UNIFIED_STORE_CONFIG } from './types.js';
import { PatternRepository } from './repositories/pattern-repository.js';
import { ContractRepository } from './repositories/contract-repository.js';
import { ConstraintRepository } from './repositories/constraint-repository.js';
import { BoundaryRepository } from './repositories/boundary-repository.js';
import { EnvironmentRepository } from './repositories/environment-repository.js';
import { CallGraphRepository } from './repositories/callgraph-repository.js';
import { AuditRepository } from './repositories/audit-repository.js';
import { DNARepository } from './repositories/dna-repository.js';
import { TestTopologyRepository } from './repositories/test-topology-repository.js';

// ============================================================================
// Constants
// ============================================================================

const DRIFT_DIR = '.drift';
const SCHEMA_FILE = 'schema.sql';

// ============================================================================
// Unified Store Implementation
// ============================================================================

/**
 * UnifiedStore - Main SQLite storage implementation
 *
 * Provides a unified interface for all Drift metadata storage.
 * Uses SQLite with WAL mode for performance and reliability.
 */
export class UnifiedStore implements IUnifiedStore {
  private readonly config: Required<UnifiedStoreConfig>;
  private db: Database.Database | null = null;
  private initialized = false;

  // Repositories
  private _patterns: PatternRepository | null = null;
  private _contracts: ContractRepository | null = null;
  private _constraints: ConstraintRepository | null = null;
  private _boundaries: BoundaryRepository | null = null;
  private _environment: EnvironmentRepository | null = null;
  private _callGraph: CallGraphRepository | null = null;
  private _audit: AuditRepository | null = null;
  private _dna: DNARepository | null = null;
  private _testTopology: TestTopologyRepository | null = null;

  constructor(config: Partial<UnifiedStoreConfig> = {}) {
    this.config = { ...DEFAULT_UNIFIED_STORE_CONFIG, ...config };
  }

  // ==========================================================================
  // Lifecycle
  // ==========================================================================

  /**
   * Initialize the unified store
   *
   * Creates the database file and schema if they don't exist.
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    // Ensure .drift directory exists
    const driftDir = path.join(this.config.rootDir, DRIFT_DIR);
    if (!fs.existsSync(driftDir)) {
      fs.mkdirSync(driftDir, { recursive: true });
    }

    // Open database
    const dbPath = path.join(driftDir, this.config.dbFileName);
    this.db = new Database(dbPath, {
      verbose: this.config.verbose ? console.log : undefined,
      timeout: this.config.timeout,
    });

    // Configure database
    if (this.config.walMode) {
      this.db.pragma('journal_mode = WAL');
    }
    if (this.config.foreignKeys) {
      this.db.pragma('foreign_keys = ON');
    }
    this.db.pragma('synchronous = NORMAL');

    // Initialize schema
    await this.initializeSchema();

    // Initialize repositories
    this.initializeRepositories();

    this.initialized = true;
  }

  /**
   * Initialize the database schema
   */
  private async initializeSchema(): Promise<void> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    // Read schema file (ESM-compatible path resolution)
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const schemaPath = path.join(__dirname, SCHEMA_FILE);
    let schema: string;

    if (fs.existsSync(schemaPath)) {
      schema = fs.readFileSync(schemaPath, 'utf-8');
    } else {
      // Fallback: use embedded schema
      schema = this.getEmbeddedSchema();
    }

    // Execute schema
    this.db.exec(schema);
  }

  /**
   * Initialize all repositories
   */
  private initializeRepositories(): void {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    this._patterns = new PatternRepository(this.db);
    this._contracts = new ContractRepository(this.db);
    this._constraints = new ConstraintRepository(this.db);
    this._boundaries = new BoundaryRepository(this.db);
    this._environment = new EnvironmentRepository(this.db);
    this._callGraph = new CallGraphRepository(this.db);
    this._audit = new AuditRepository(this.db);
    this._dna = new DNARepository(this.db);
    this._testTopology = new TestTopologyRepository(this.db);
  }

  /**
   * Close the database connection
   */
  async close(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
    this.initialized = false;
  }

  // ==========================================================================
  // Repository Accessors
  // ==========================================================================

  get patterns(): IPatternRepository {
    this.ensureInitialized();
    return this._patterns!;
  }

  get contracts(): IContractRepository {
    this.ensureInitialized();
    return this._contracts!;
  }

  get constraints(): IConstraintRepository {
    this.ensureInitialized();
    return this._constraints!;
  }

  get boundaries(): IBoundaryRepository {
    this.ensureInitialized();
    return this._boundaries!;
  }

  get environment(): IEnvironmentRepository {
    this.ensureInitialized();
    return this._environment!;
  }

  get callGraph(): ICallGraphRepository {
    this.ensureInitialized();
    return this._callGraph!;
  }

  get audit(): IAuditRepository {
    this.ensureInitialized();
    return this._audit!;
  }

  get dna(): IDNARepository {
    this.ensureInitialized();
    return this._dna!;
  }

  get testTopology(): ITestTopologyRepository {
    this.ensureInitialized();
    return this._testTopology!;
  }

  // ==========================================================================
  // Transactions
  // ==========================================================================

  /**
   * Execute a function within a transaction
   */
  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    this.ensureInitialized();

    const db = this.db!;
    const runTransaction = db.transaction(() => {
      // Note: better-sqlite3 transactions are synchronous
      // We need to handle async operations carefully
      return fn();
    });

    return runTransaction() as T;
  }

  /**
   * Execute a synchronous function within a transaction
   */
  transactionSync<T>(fn: () => T): T {
    this.ensureInitialized();

    const db = this.db!;
    const runTransaction = db.transaction(fn);
    return runTransaction();
  }

  // ==========================================================================
  // Raw SQL Access (for sync service)
  // ==========================================================================

  /**
   * Run a raw SQL statement (INSERT, UPDATE, DELETE)
   */
  runRaw(sql: string, params: unknown[] = []): void {
    this.ensureInitialized();
    this.db!.prepare(sql).run(...params);
  }

  /**
   * Query raw SQL (SELECT)
   */
  queryRaw<T = unknown>(sql: string, params: unknown[] = []): T[] {
    this.ensureInitialized();
    return this.db!.prepare(sql).all(...params) as T[];
  }

  // ==========================================================================
  // Export/Import
  // ==========================================================================

  /**
   * Export the database
   */
  async export(format: 'json' | 'sqlite'): Promise<Buffer> {
    this.ensureInitialized();

    if (format === 'sqlite') {
      // Return the raw database file
      const dbPath = path.join(this.config.rootDir, DRIFT_DIR, this.config.dbFileName);
      return fs.readFileSync(dbPath);
    }

    // Export as JSON
    const data = {
      version: '1.0.0',
      exportedAt: new Date().toISOString(),
      patterns: await this.exportTable('patterns'),
      pattern_locations: await this.exportTable('pattern_locations'),
      pattern_examples: await this.exportTable('pattern_examples'),
      contracts: await this.exportTable('contracts'),
      contract_frontends: await this.exportTable('contract_frontends'),
      constraints: await this.exportTable('constraints'),
      data_models: await this.exportTable('data_models'),
      sensitive_fields: await this.exportTable('sensitive_fields'),
      data_access_points: await this.exportTable('data_access_points'),
      env_variables: await this.exportTable('env_variables'),
      env_access_points: await this.exportTable('env_access_points'),
      functions: await this.exportTable('functions'),
      function_calls: await this.exportTable('function_calls'),
      function_data_access: await this.exportTable('function_data_access'),
      audit_snapshots: await this.exportTable('audit_snapshots'),
      pattern_history: await this.exportTable('pattern_history'),
      health_trends: await this.exportTable('health_trends'),
      scan_history: await this.exportTable('scan_history'),
      dna_profile: await this.exportTable('dna_profile'),
      dna_genes: await this.exportTable('dna_genes'),
      dna_mutations: await this.exportTable('dna_mutations'),
      test_files: await this.exportTable('test_files'),
      test_coverage: await this.exportTable('test_coverage'),
    };

    return Buffer.from(JSON.stringify(data, null, 2));
  }

  /**
   * Import data into the database
   */
  async import(data: Buffer, format: 'json' | 'sqlite'): Promise<void> {
    this.ensureInitialized();

    if (format === 'sqlite') {
      // Close current connection
      await this.close();

      // Replace database file
      const dbPath = path.join(this.config.rootDir, DRIFT_DIR, this.config.dbFileName);
      fs.writeFileSync(dbPath, data);

      // Reinitialize
      await this.initialize();
      return;
    }

    // Import from JSON
    const jsonData = JSON.parse(data.toString());

    this.transactionSync(() => {
      // Clear existing data
      this.db!.exec('DELETE FROM patterns');
      this.db!.exec('DELETE FROM contracts');
      this.db!.exec('DELETE FROM constraints');
      // ... clear other tables

      // Import data
      for (const [table, rows] of Object.entries(jsonData)) {
        if (table === 'version' || table === 'exportedAt') continue;
        this.importTable(table, rows as Record<string, unknown>[]);
      }
    });
  }

  private async exportTable(table: string): Promise<unknown[]> {
    return this.db!.prepare(`SELECT * FROM ${table}`).all();
  }

  private importTable(table: string, rows: Record<string, unknown>[]): void {
    if (rows.length === 0) return;

    const firstRow = rows[0];
    if (!firstRow) return;
    
    const columns = Object.keys(firstRow);
    const placeholders = columns.map(() => '?').join(', ');
    const stmt = this.db!.prepare(
      `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`
    );

    for (const row of rows) {
      stmt.run(...columns.map((col) => row[col]));
    }
  }

  // ==========================================================================
  // Sync
  // ==========================================================================

  /**
   * Get sync log entries since a timestamp
   */
  async getSyncLog(since?: string): Promise<SyncLogEntry[]> {
    this.ensureInitialized();

    if (since) {
      return this.db!
        .prepare('SELECT * FROM sync_log WHERE timestamp > ? ORDER BY timestamp')
        .all(since) as SyncLogEntry[];
    }

    return this.db!
      .prepare('SELECT * FROM sync_log WHERE synced = 0 ORDER BY timestamp')
      .all() as SyncLogEntry[];
  }

  /**
   * Mark sync log entries as synced
   */
  async markSynced(ids: number[]): Promise<void> {
    this.ensureInitialized();

    if (ids.length === 0) return;

    const placeholders = ids.map(() => '?').join(', ');
    this.db!
      .prepare(`UPDATE sync_log SET synced = 1 WHERE id IN (${placeholders})`)
      .run(...ids);
  }

  // ==========================================================================
  // Maintenance
  // ==========================================================================

  /**
   * Run VACUUM to reclaim space
   */
  async vacuum(): Promise<void> {
    this.ensureInitialized();
    this.db!.exec('VACUUM');
  }

  /**
   * Checkpoint WAL file
   */
  async checkpoint(): Promise<void> {
    this.ensureInitialized();
    this.db!.pragma('wal_checkpoint(TRUNCATE)');
  }

  /**
   * Get store statistics
   */
  async getStats(): Promise<StoreStats> {
    this.ensureInitialized();

    const db = this.db!;
    const dbPath = path.join(this.config.rootDir, DRIFT_DIR, this.config.dbFileName);
    const stats = fs.statSync(dbPath);

    const lastScan = db
      .prepare('SELECT started_at FROM scan_history ORDER BY started_at DESC LIMIT 1')
      .get() as { started_at: string } | undefined;

    return {
      patterns: (db.prepare('SELECT COUNT(*) as count FROM patterns').get() as { count: number }).count,
      contracts: (db.prepare('SELECT COUNT(*) as count FROM contracts').get() as { count: number }).count,
      constraints: (db.prepare('SELECT COUNT(*) as count FROM constraints').get() as { count: number }).count,
      functions: (db.prepare('SELECT COUNT(*) as count FROM functions').get() as { count: number }).count,
      accessPoints: (db.prepare('SELECT COUNT(*) as count FROM data_access_points').get() as { count: number }).count,
      envVariables: (db.prepare('SELECT COUNT(*) as count FROM env_variables').get() as { count: number }).count,
      testFiles: (db.prepare('SELECT COUNT(*) as count FROM test_files').get() as { count: number }).count,
      dbSizeBytes: stats.size,
      lastScan: lastScan?.started_at ?? null,
    };
  }

  // ==========================================================================
  // Helpers
  // ==========================================================================

  private ensureInitialized(): void {
    if (!this.initialized || !this.db) {
      throw new Error('UnifiedStore not initialized. Call initialize() first.');
    }
  }

  /**
   * Get the raw database instance (for advanced operations)
   */
  getDatabase(): Database.Database {
    this.ensureInitialized();
    return this.db!;
  }

  /**
   * Get embedded schema (fallback if schema.sql not found)
   */
  private getEmbeddedSchema(): string {
    // This is a minimal schema - the full schema should be in schema.sql
    return `
      PRAGMA foreign_keys = ON;
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;

      CREATE TABLE IF NOT EXISTS project (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        root_path TEXT NOT NULL,
        drift_version TEXT NOT NULL,
        schema_version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `;
  }
}
