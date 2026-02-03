/**
 * Call Graph Repository - SQLite implementation
 *
 * Provides operations for functions, calls, and data access tracking.
 *
 * @module storage/repositories/callgraph-repository
 */

import type Database from 'better-sqlite3';
import type {
  ICallGraphRepository,
  DbFunction,
  DbFunctionCall,
  DbFunctionDataAccess,
  DbCallChainNode,
} from '../types.js';

// ============================================================================
// Call Graph Repository Implementation
// ============================================================================

export class CallGraphRepository implements ICallGraphRepository {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  // ==========================================================================
  // Functions
  // ==========================================================================

  async addFunction(func: DbFunction): Promise<void> {
    this.db.prepare(`
      INSERT OR REPLACE INTO functions 
      (id, name, qualified_name, file, start_line, end_line, language, 
       is_exported, is_entry_point, is_data_accessor, is_constructor, is_async,
       decorators, parameters, signature)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      func.id,
      func.name,
      func.qualified_name,
      func.file,
      func.start_line,
      func.end_line,
      func.language,
      func.is_exported,
      func.is_entry_point,
      func.is_data_accessor,
      func.is_constructor,
      func.is_async,
      func.decorators,
      func.parameters,
      func.signature
    );
  }

  async getFunction(id: string): Promise<DbFunction | null> {
    return (this.db.prepare('SELECT * FROM functions WHERE id = ?').get(id) as DbFunction) ?? null;
  }

  async getFunctionByName(name: string, file?: string): Promise<DbFunction | null> {
    if (file) {
      return (this.db
        .prepare('SELECT * FROM functions WHERE name = ? AND file = ?')
        .get(name, file) as DbFunction) ?? null;
    }
    return (this.db.prepare('SELECT * FROM functions WHERE name = ?').get(name) as DbFunction) ?? null;
  }

  async getFunctionsByFile(file: string): Promise<DbFunction[]> {
    return this.db
      .prepare('SELECT * FROM functions WHERE file = ? ORDER BY start_line')
      .all(file) as DbFunction[];
  }

  async getEntryPoints(): Promise<DbFunction[]> {
    return this.db
      .prepare('SELECT * FROM functions WHERE is_entry_point = 1')
      .all() as DbFunction[];
  }

  async getDataAccessors(): Promise<DbFunction[]> {
    return this.db
      .prepare('SELECT * FROM functions WHERE is_data_accessor = 1')
      .all() as DbFunction[];
  }

  // ==========================================================================
  // Calls
  // ==========================================================================

  async addCall(call: DbFunctionCall): Promise<void> {
    this.db.prepare(`
      INSERT INTO function_calls 
      (caller_id, callee_id, callee_name, line, column_num, resolved, confidence, argument_count)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      call.caller_id,
      call.callee_id,
      call.callee_name,
      call.line,
      call.column_num,
      call.resolved,
      call.confidence,
      call.argument_count
    );
  }

  async getCallers(functionId: string): Promise<DbFunctionCall[]> {
    return this.db
      .prepare('SELECT * FROM function_calls WHERE callee_id = ?')
      .all(functionId) as DbFunctionCall[];
  }

  async getCallees(functionId: string): Promise<DbFunctionCall[]> {
    return this.db
      .prepare('SELECT * FROM function_calls WHERE caller_id = ?')
      .all(functionId) as DbFunctionCall[];
  }

  // ==========================================================================
  // Data Access
  // ==========================================================================

  async addDataAccess(access: DbFunctionDataAccess): Promise<void> {
    this.db.prepare(`
      INSERT INTO function_data_access 
      (function_id, table_name, operation, fields, line, confidence)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      access.function_id,
      access.table_name,
      access.operation,
      access.fields,
      access.line,
      access.confidence
    );
  }

  async getDataAccess(functionId: string): Promise<DbFunctionDataAccess[]> {
    return this.db
      .prepare('SELECT * FROM function_data_access WHERE function_id = ?')
      .all(functionId) as DbFunctionDataAccess[];
  }

  // ==========================================================================
  // Analysis
  // ==========================================================================

  async getCallChain(functionId: string, maxDepth = 10): Promise<DbCallChainNode[]> {
    const result: DbCallChainNode[] = [];
    const visited = new Set<string>();

    const traverse = (id: string, depth: number, path: string[]): void => {
      if (depth > maxDepth || visited.has(id)) return;
      visited.add(id);

      const func = this.db.prepare('SELECT * FROM functions WHERE id = ?').get(id) as DbFunction | undefined;
      if (!func) return;

      result.push({
        function: func,
        depth,
        path: [...path, func.name],
      });

      // Get callees
      const calls = this.db
        .prepare('SELECT callee_id FROM function_calls WHERE caller_id = ? AND callee_id IS NOT NULL')
        .all(id) as Array<{ callee_id: string }>;

      for (const call of calls) {
        traverse(call.callee_id, depth + 1, [...path, func.name]);
      }
    };

    traverse(functionId, 0, []);
    return result;
  }

  async getReachableTables(functionId: string): Promise<string[]> {
    const tables = new Set<string>();
    const visited = new Set<string>();

    const traverse = (id: string, depth: number): void => {
      if (depth > 10 || visited.has(id)) return;
      visited.add(id);

      // Get direct data access
      const access = this.db
        .prepare('SELECT DISTINCT table_name FROM function_data_access WHERE function_id = ?')
        .all(id) as Array<{ table_name: string }>;

      for (const a of access) {
        tables.add(a.table_name);
      }

      // Get callees and recurse
      const calls = this.db
        .prepare('SELECT callee_id FROM function_calls WHERE caller_id = ? AND callee_id IS NOT NULL')
        .all(id) as Array<{ callee_id: string }>;

      for (const call of calls) {
        traverse(call.callee_id, depth + 1);
      }
    };

    traverse(functionId, 0);
    return Array.from(tables);
  }
}
