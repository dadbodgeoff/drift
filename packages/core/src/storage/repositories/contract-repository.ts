/**
 * Contract Repository - SQLite implementation
 *
 * Provides CRUD operations and queries for API contracts stored in SQLite.
 *
 * @module storage/repositories/contract-repository
 */

import type Database from 'better-sqlite3';
import type {
  IContractRepository,
  DbContract,
  DbContractFrontend,
  DbHttpMethod,
  DbContractStatus,
} from '../types.js';

// ============================================================================
// Contract Repository Implementation
// ============================================================================

export class ContractRepository implements IContractRepository {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  // ==========================================================================
  // CRUD Operations
  // ==========================================================================

  async create(contract: DbContract): Promise<string> {
    this.db.prepare(`
      INSERT INTO contracts (
        id, method, endpoint, normalized_endpoint, status,
        backend_method, backend_path, backend_normalized_path, backend_file, backend_line, backend_framework, backend_response_fields,
        confidence_score, confidence_level, match_confidence, field_extraction_confidence,
        mismatches, first_seen, last_seen, verified_at, verified_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      contract.id,
      contract.method,
      contract.endpoint,
      contract.normalized_endpoint,
      contract.status,
      contract.backend_method,
      contract.backend_path,
      contract.backend_normalized_path,
      contract.backend_file,
      contract.backend_line,
      contract.backend_framework,
      contract.backend_response_fields,
      contract.confidence_score,
      contract.confidence_level,
      contract.match_confidence,
      contract.field_extraction_confidence,
      contract.mismatches,
      contract.first_seen,
      contract.last_seen,
      contract.verified_at,
      contract.verified_by
    );
    return contract.id;
  }

  async read(id: string): Promise<DbContract | null> {
    return (this.db.prepare('SELECT * FROM contracts WHERE id = ?').get(id) as DbContract) ?? null;
  }

  async update(id: string, updates: Partial<DbContract>): Promise<void> {
    const fields = Object.keys(updates).filter((k) => k !== 'id');
    if (fields.length === 0) return;

    const setClause = fields.map((f) => `${f} = ?`).join(', ');
    const values = fields.map((f) => (updates as Record<string, unknown>)[f]);

    this.db.prepare(`UPDATE contracts SET ${setClause} WHERE id = ?`).run(...values, id);
  }

  async delete(id: string): Promise<boolean> {
    const result = this.db.prepare('DELETE FROM contracts WHERE id = ?').run(id);
    return result.changes > 0;
  }

  async exists(id: string): Promise<boolean> {
    return this.db.prepare('SELECT 1 FROM contracts WHERE id = ? LIMIT 1').get(id) !== undefined;
  }

  async count(filter?: Partial<DbContract>): Promise<number> {
    if (!filter || Object.keys(filter).length === 0) {
      return (this.db.prepare('SELECT COUNT(*) as count FROM contracts').get() as { count: number }).count;
    }

    const conditions = Object.keys(filter).map((k) => `${k} = ?`);
    const values = Object.values(filter);
    const result = this.db
      .prepare(`SELECT COUNT(*) as count FROM contracts WHERE ${conditions.join(' AND ')}`)
      .get(...values) as { count: number };
    return result.count;
  }

  // ==========================================================================
  // Queries
  // ==========================================================================

  async findByStatus(status: DbContractStatus): Promise<DbContract[]> {
    return this.db
      .prepare('SELECT * FROM contracts WHERE status = ?')
      .all(status) as DbContract[];
  }

  async findByMethod(method: DbHttpMethod): Promise<DbContract[]> {
    return this.db
      .prepare('SELECT * FROM contracts WHERE method = ?')
      .all(method) as DbContract[];
  }

  async findByEndpoint(endpoint: string): Promise<DbContract[]> {
    return this.db
      .prepare('SELECT * FROM contracts WHERE normalized_endpoint LIKE ?')
      .all(`%${endpoint}%`) as DbContract[];
  }

  async findWithMismatches(): Promise<DbContract[]> {
    return this.db
      .prepare("SELECT * FROM contracts WHERE status = 'mismatch' OR mismatches IS NOT NULL")
      .all() as DbContract[];
  }

  // ==========================================================================
  // State Transitions
  // ==========================================================================

  async verify(id: string, verifiedBy?: string): Promise<void> {
    const now = new Date().toISOString();
    this.db
      .prepare(`
        UPDATE contracts 
        SET status = 'verified', verified_at = ?, verified_by = ?, last_seen = ?
        WHERE id = ?
      `)
      .run(now, verifiedBy ?? null, now, id);
  }

  async markMismatch(id: string): Promise<void> {
    const now = new Date().toISOString();
    this.db
      .prepare(`
        UPDATE contracts 
        SET status = 'mismatch', last_seen = ?
        WHERE id = ?
      `)
      .run(now, id);
  }

  async ignore(id: string): Promise<void> {
    const now = new Date().toISOString();
    this.db
      .prepare(`
        UPDATE contracts 
        SET status = 'ignored', last_seen = ?
        WHERE id = ?
      `)
      .run(now, id);
  }

  // ==========================================================================
  // Frontends
  // ==========================================================================

  async addFrontend(contractId: string, frontend: DbContractFrontend): Promise<void> {
    this.db.prepare(`
      INSERT INTO contract_frontends 
      (contract_id, method, path, normalized_path, file, line, library, response_fields)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      contractId,
      frontend.method,
      frontend.path,
      frontend.normalized_path,
      frontend.file,
      frontend.line,
      frontend.library,
      frontend.response_fields
    );
  }

  async getFrontends(contractId: string): Promise<DbContractFrontend[]> {
    return this.db
      .prepare('SELECT * FROM contract_frontends WHERE contract_id = ?')
      .all(contractId) as DbContractFrontend[];
  }
}
