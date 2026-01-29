/**
 * database/sql Pattern Matcher
 *
 * Matches Go standard library database/sql patterns:
 * - db.Query("SELECT * FROM users")
 * - db.QueryRow("SELECT * FROM users WHERE id = ?", id)
 * - db.Exec("INSERT INTO users ...")
 * - db.Prepare("SELECT * FROM users WHERE id = ?")
 * - stmt.Query(args...)
 * - rows.Scan(&user.Name, &user.Email)
 *
 * @requirements Go Language Support
 */

import { BaseMatcher } from './base-matcher.js';

import type { DataOperation } from '../../boundaries/types.js';
import type { UnifiedCallChain, PatternMatchResult, UnifiedLanguage, NormalizedArg } from '../types.js';

/**
 * database/sql pattern matcher
 */
export class DatabaseSqlMatcher extends BaseMatcher {
  readonly id = 'database-sql';
  readonly name = 'database/sql';
  readonly languages: UnifiedLanguage[] = ['go'];
  readonly priority = 80; // Lower priority than GORM and sqlx

  private readonly readMethods = [
    'Query', 'QueryRow', 'QueryContext', 'QueryRowContext',
  ];

  private readonly writeMethods = [
    'Exec', 'ExecContext',
  ];

  private readonly prepareMethods = [
    'Prepare', 'PrepareContext',
  ];

  match(chain: UnifiedCallChain): PatternMatchResult | null {
    // Pattern 1: db.Method() where db is a sql.DB instance
    const dbMatch = this.matchDbPattern(chain);
    if (dbMatch) {return dbMatch;}

    // Pattern 2: tx.Method() for transaction patterns
    const txMatch = this.matchTransactionPattern(chain);
    if (txMatch) {return txMatch;}

    // Pattern 3: stmt.Method() for prepared statement patterns
    const stmtMatch = this.matchStatementPattern(chain);
    if (stmtMatch) {return stmtMatch;}

    return null;
  }

  private matchDbPattern(chain: UnifiedCallChain): PatternMatchResult | null {
    const receiver = chain.receiver.toLowerCase();

    // Common database/sql receiver names
    const dbReceivers = ['db', 'database', 'conn', 'connection', 'pool'];
    if (!dbReceivers.some(r => receiver.includes(r))) {
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

  private matchStatementPattern(chain: UnifiedCallChain): PatternMatchResult | null {
    const receiver = chain.receiver.toLowerCase();

    // Prepared statement receiver names
    const stmtReceivers = ['stmt', 'statement', 'prepared'];
    if (!stmtReceivers.some(r => receiver.includes(r))) {
      return null;
    }

    return this.analyzeChain(chain);
  }

  private analyzeChain(chain: UnifiedCallChain): PatternMatchResult | null {
    if (chain.segments.length < 1) {return null;}

    const segment = chain.segments[0];
    if (!segment?.isCall) {return null;}

    const methodName = segment.name;
    let operation = this.getOperation(methodName);

    // For Exec methods, determine operation from SQL
    if (methodName === 'Exec' || methodName === 'ExecContext') {
      const sqlOp = this.getOperationFromSql(segment.args);
      if (sqlOp) {operation = sqlOp;}
    }

    // For Prepare methods, try to determine operation from SQL
    if (this.prepareMethods.includes(methodName)) {
      const sqlOp = this.getOperationFromSql(segment.args);
      operation = sqlOp ?? 'read'; // Default to read for prepared statements
    }

    if (!operation) {return null;}

    // Extract table and fields from SQL query
    const { table, fields } = this.extractFromSql(segment.args);

    return this.createMatch({
      table: table ?? 'unknown',
      fields,
      operation,
      confidence: table ? 0.8 : 0.6,
      metadata: {
        pattern: 'database-sql',
        method: methodName,
      },
    });
  }

  private getOperation(methodName: string): DataOperation | null {
    if (this.readMethods.includes(methodName)) {return 'read';}
    if (this.writeMethods.includes(methodName)) {return 'write';}
    return null;
  }

  private getOperationFromSql(args: NormalizedArg[]): DataOperation | null {
    const sql = this.extractSqlString(args);
    if (!sql) {return null;}

    const upperSql = sql.toUpperCase().trim();

    if (upperSql.startsWith('SELECT')) {return 'read';}
    if (upperSql.startsWith('INSERT')) {return 'write';}
    if (upperSql.startsWith('UPDATE')) {return 'write';}
    if (upperSql.startsWith('DELETE')) {return 'delete';}
    if (upperSql.startsWith('UPSERT')) {return 'write';}
    if (upperSql.startsWith('MERGE')) {return 'write';}
    if (upperSql.startsWith('CREATE')) {return 'write';}
    if (upperSql.startsWith('ALTER')) {return 'write';}
    if (upperSql.startsWith('DROP')) {return 'delete';}
    if (upperSql.startsWith('TRUNCATE')) {return 'delete';}

    return null;
  }

  private extractFromSql(args: NormalizedArg[]): { table: string | null; fields: string[] } {
    const sql = this.extractSqlString(args);
    if (!sql) {return { table: null, fields: [] };}

    const table = this.extractTableFromSql(sql);
    const fields = this.extractFieldsFromSql(sql);

    return { table, fields };
  }

  private extractSqlString(args: NormalizedArg[]): string | null {
    // SQL is typically the first argument
    if (args.length === 0) {return null;}

    const firstArg = args[0]!;

    if (firstArg.stringValue) {
      const value = this.unquoteString(firstArg.stringValue);
      if (this.looksLikeSql(value)) {
        return value;
      }
    }

    if (firstArg.type === 'string') {
      const value = this.unquoteString(firstArg.value);
      if (this.looksLikeSql(value)) {
        return value;
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
           upperStr.startsWith('WITH') ||
           upperStr.startsWith('CREATE') ||
           upperStr.startsWith('ALTER') ||
           upperStr.startsWith('DROP') ||
           upperStr.startsWith('TRUNCATE');
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

    // CREATE TABLE table
    const createMatch = upperSql.match(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(["`]?[\w.]+["`]?)/i);
    if (createMatch) {
      return this.cleanTableName(createMatch[1]!);
    }

    // DROP TABLE table
    const dropMatch = upperSql.match(/DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?(["`]?[\w.]+["`]?)/i);
    if (dropMatch) {
      return this.cleanTableName(dropMatch[1]!);
    }

    // TRUNCATE TABLE table
    const truncateMatch = upperSql.match(/TRUNCATE\s+(?:TABLE\s+)?(["`]?[\w.]+["`]?)/i);
    if (truncateMatch) {
      return this.cleanTableName(truncateMatch[1]!);
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

    // Extract from INSERT columns
    const insertMatch = sql.match(/INSERT\s+INTO\s+[\w.]+\s*\(([^)]+)\)/i);
    if (insertMatch) {
      const columns = insertMatch[1]!.split(',');
      for (const col of columns) {
        const field = col.trim().replace(/["`]/g, '');
        if (field) {fields.push(field);}
      }
    }

    // Extract from UPDATE SET clause
    const updateMatch = sql.match(/SET\s+(.+?)(?:WHERE|$)/i);
    if (updateMatch) {
      const setClause = updateMatch[1]!;
      const setParts = setClause.split(',');
      for (const part of setParts) {
        const field = part.split('=')[0]?.trim().replace(/["`]/g, '');
        if (field) {fields.push(field);}
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
