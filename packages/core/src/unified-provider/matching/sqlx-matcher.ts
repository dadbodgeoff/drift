/**
 * sqlx Pattern Matcher
 *
 * Matches sqlx (Go SQL extensions) patterns:
 * - db.Select(&users, "SELECT * FROM users")
 * - db.Get(&user, "SELECT * FROM users WHERE id = ?", id)
 * - db.Exec("INSERT INTO users ...")
 * - db.NamedExec("INSERT INTO users ...", user)
 * - db.Queryx("SELECT * FROM users")
 * - db.QueryRowx("SELECT * FROM users WHERE id = ?", id)
 *
 * @requirements Go Language Support
 */

import type { DataOperation } from '../../boundaries/types.js';
import type { UnifiedCallChain, PatternMatchResult, UnifiedLanguage, NormalizedArg } from '../types.js';
import { BaseMatcher } from './base-matcher.js';

/**
 * sqlx pattern matcher
 */
export class SqlxMatcher extends BaseMatcher {
  readonly id = 'sqlx';
  readonly name = 'sqlx';
  readonly languages: UnifiedLanguage[] = ['go'];
  readonly priority = 85;

  private readonly readMethods = [
    'Select', 'Get', 'Queryx', 'QueryRowx',
    'NamedQuery', 'PrepareNamed',
  ];

  private readonly writeMethods = [
    'Exec', 'NamedExec', 'MustExec',
  ];

  match(chain: UnifiedCallChain): PatternMatchResult | null {
    // Pattern 1: db.Method() where db is a sqlx database instance
    const dbMatch = this.matchDbPattern(chain);
    if (dbMatch) return dbMatch;

    // Pattern 2: tx.Method() for transaction patterns
    const txMatch = this.matchTransactionPattern(chain);
    if (txMatch) return txMatch;

    return null;
  }

  private matchDbPattern(chain: UnifiedCallChain): PatternMatchResult | null {
    const receiver = chain.receiver.toLowerCase();

    // Common sqlx receiver names
    const sqlxReceivers = ['db', 'sqlx', 'conn', 'connection', 'database'];
    if (!sqlxReceivers.some(r => receiver.includes(r))) {
      return null;
    }

    return this.analyzeChain(chain);
  }

  private matchTransactionPattern(chain: UnifiedCallChain): PatternMatchResult | null {
    const receiver = chain.receiver.toLowerCase();

    // Transaction receiver names
    const txReceivers = ['tx', 'transaction', 'trx'];
    if (!txReceivers.some(r => receiver === r || receiver.endsWith(r))) {
      return null;
    }

    return this.analyzeChain(chain);
  }

  private analyzeChain(chain: UnifiedCallChain): PatternMatchResult | null {
    if (chain.segments.length < 1) return null;

    const segment = chain.segments[0];
    if (!segment?.isCall) return null;

    const methodName = segment.name;
    let operation = this.getOperation(methodName);

    // For Exec methods, determine operation from SQL
    if (methodName === 'Exec' || methodName === 'NamedExec' || methodName === 'MustExec') {
      const sqlOp = this.getOperationFromSql(segment.args);
      if (sqlOp) operation = sqlOp;
    }

    if (!operation) return null;

    // Extract table and fields from SQL query
    const { table, fields } = this.extractFromSql(segment.args);

    return this.createMatch({
      table: table ?? 'unknown',
      fields,
      operation,
      confidence: table ? 0.85 : 0.65,
      metadata: {
        pattern: 'sqlx',
        method: methodName,
      },
    });
  }

  private getOperation(methodName: string): DataOperation | null {
    if (this.readMethods.includes(methodName)) return 'read';
    if (this.writeMethods.includes(methodName)) return 'write';
    return null;
  }

  private getOperationFromSql(args: NormalizedArg[]): DataOperation | null {
    const sql = this.extractSqlString(args);
    if (!sql) return null;

    const upperSql = sql.toUpperCase().trim();

    if (upperSql.startsWith('SELECT')) return 'read';
    if (upperSql.startsWith('INSERT')) return 'write';
    if (upperSql.startsWith('UPDATE')) return 'write';
    if (upperSql.startsWith('DELETE')) return 'delete';
    if (upperSql.startsWith('UPSERT')) return 'write';
    if (upperSql.startsWith('MERGE')) return 'write';

    return null;
  }

  private extractFromSql(args: NormalizedArg[]): { table: string | null; fields: string[] } {
    const sql = this.extractSqlString(args);
    if (!sql) return { table: null, fields: [] };

    const table = this.extractTableFromSql(sql);
    const fields = this.extractFieldsFromSql(sql);

    return { table, fields };
  }

  private extractSqlString(args: NormalizedArg[]): string | null {
    // For Select/Get, SQL is typically the second argument
    // For Exec/NamedExec, SQL is typically the first argument
    for (const arg of args) {
      if (arg.stringValue) {
        const value = this.unquoteString(arg.stringValue);
        if (this.looksLikeSql(value)) {
          return value;
        }
      }
      if (arg.type === 'string') {
        const value = this.unquoteString(arg.value);
        if (this.looksLikeSql(value)) {
          return value;
        }
      }
    }
    return null;
  }

  private looksLikeSql(str: string): boolean {
    const upperStr = str.toUpperCase().trim();
    return upperStr.startsWith('SELECT') ||
           upperStr.startsWith('INSERT') ||
           upperStr.startsWith('UPDATE') ||
           upperStr.startsWith('DELETE') ||
           upperStr.startsWith('WITH');
  }

  private extractTableFromSql(sql: string): string | null {
    const upperSql = sql.toUpperCase();

    // SELECT ... FROM table
    const fromMatch = upperSql.match(/FROM\s+(["`]?[\w.]+["`]?)/i);
    if (fromMatch) {
      return this.cleanTableName(fromMatch[1]!);
    }

    // INSERT INTO table
    const insertMatch = upperSql.match(/INSERT\s+INTO\s+(["`]?[\w.]+["`]?)/i);
    if (insertMatch) {
      return this.cleanTableName(insertMatch[1]!);
    }

    // UPDATE table
    const updateMatch = upperSql.match(/UPDATE\s+(["`]?[\w.]+["`]?)/i);
    if (updateMatch) {
      return this.cleanTableName(updateMatch[1]!);
    }

    // DELETE FROM table
    const deleteMatch = upperSql.match(/DELETE\s+FROM\s+(["`]?[\w.]+["`]?)/i);
    if (deleteMatch) {
      return this.cleanTableName(deleteMatch[1]!);
    }

    return null;
  }

  private extractFieldsFromSql(sql: string): string[] {
    const fields: string[] = [];

    // Extract from SELECT clause
    const selectMatch = sql.match(/SELECT\s+(.+?)\s+FROM/i);
    if (selectMatch) {
      const selectClause = selectMatch[1]!;
      if (selectClause.trim() !== '*') {
        const fieldParts = selectClause.split(',');
        for (const part of fieldParts) {
          const field = part.trim()
            .replace(/\s+AS\s+\w+$/i, '') // Remove aliases
            .replace(/^[\w.]+\./, ''); // Remove table prefix
          if (field && field !== '*') {
            fields.push(field);
          }
        }
      }
    }

    // Extract from WHERE clause
    const whereMatch = sql.match(/WHERE\s+(.+?)(?:ORDER|GROUP|LIMIT|$)/i);
    if (whereMatch) {
      const whereClause = whereMatch[1]!;
      const fieldMatches = whereClause.match(/\b([a-z_][a-z0-9_]*)\s*(?:=|!=|<|>|<=|>=|LIKE|IN|IS)/gi);
      if (fieldMatches) {
        for (const match of fieldMatches) {
          const field = match.replace(/\s*(?:=|!=|<|>|<=|>=|LIKE|IN|IS).*/i, '').trim();
          if (field && !['AND', 'OR', 'NOT'].includes(field.toUpperCase())) {
            fields.push(field);
          }
        }
      }
    }

    return [...new Set(fields)];
  }

  private cleanTableName(name: string): string {
    return name.replace(/["`]/g, '').split('.').pop() ?? name;
  }

  private unquoteString(str: string): string {
    return str.replace(/^["'`]|["'`]$/g, '');
  }
}
