/**
 * Raw SQL Pattern Matcher
 *
 * Matches raw SQL query patterns across all languages:
 * - db.query('SELECT * FROM users')
 * - connection.execute('INSERT INTO users...')
 * - sql`SELECT * FROM users`
 * - cursor.execute("SELECT * FROM users")
 */

import { BaseMatcher } from './base-matcher.js';

import type { DataOperation } from '../../boundaries/types.js';
import type { UnifiedCallChain, PatternMatchResult, UnifiedLanguage } from '../types.js';

/**
 * Raw SQL pattern matcher
 */
export class RawSqlMatcher extends BaseMatcher {
  readonly id = 'raw-sql';
  readonly name = 'Raw SQL';
  readonly languages: UnifiedLanguage[] = ['typescript', 'javascript', 'python', 'java', 'csharp', 'php'];
  readonly priority = 10; // Low priority - check after ORM-specific matchers

  // Methods that typically execute raw SQL
  private readonly queryMethods = [
    'query', 'execute', 'raw', 'rawQuery', 'sql',
    '$queryRaw', '$executeRaw', '$queryRawUnsafe', '$executeRawUnsafe',
    'executeSql', 'runSql', 'execSql',
  ];

  match(chain: UnifiedCallChain): PatternMatchResult | null {
    // Find a query method in the chain
    const queryIndex = chain.segments.findIndex(s =>
      this.queryMethods.includes(s.name) && s.isCall
    );

    if (queryIndex === -1) {return null;}

    const segment = chain.segments[queryIndex];
    if (!segment || segment.args.length === 0) {return null;}

    // Get the SQL string from the first argument
    const firstArg = segment.args[0];
    if (!firstArg) {return null;}

    let sqlText: string | null = null;

    if (firstArg.type === 'string' && firstArg.stringValue) {
      sqlText = firstArg.stringValue;
    } else if (firstArg.type === 'unknown') {
      // Could be a template string or other expression
      sqlText = firstArg.value;
    }

    if (!sqlText) {return null;}

    // Parse the SQL to extract table, operation, and fields
    const parsed = this.parseSql(sqlText);
    if (!parsed.table || parsed.table === 'unknown') {
      return null;
    }

    return this.createMatch({
      table: parsed.table,
      fields: parsed.fields,
      operation: parsed.operation,
      confidence: 0.8,
      isRawSql: true,
      metadata: {
        sqlText: sqlText.slice(0, 200),
      },
    });
  }

  /**
   * Parse SQL statement to extract table, operation, and fields
   */
  private parseSql(sql: string): { table: string; operation: DataOperation; fields: string[] } {
    const upperSql = sql.toUpperCase().trim();
    let operation: DataOperation = 'unknown';
    let table = 'unknown';
    const fields: string[] = [];

    // Determine operation
    if (upperSql.startsWith('SELECT')) {
      operation = 'read';
    } else if (upperSql.startsWith('INSERT')) {
      operation = 'write';
    } else if (upperSql.startsWith('UPDATE')) {
      operation = 'write';
    } else if (upperSql.startsWith('DELETE')) {
      operation = 'delete';
    } else if (upperSql.startsWith('MERGE')) {
      operation = 'write';
    }

    // Extract table name
    // FROM table, INTO table, UPDATE table
    const fromMatch = sql.match(/FROM\s+["'`\[]?(\w+)["'`\]]?/i);
    const intoMatch = sql.match(/INTO\s+["'`\[]?(\w+)["'`\]]?/i);
    const updateMatch = sql.match(/UPDATE\s+["'`\[]?(\w+)["'`\]]?/i);
    const mergeMatch = sql.match(/MERGE\s+(?:INTO\s+)?["'`\[]?(\w+)["'`\]]?/i);

    if (fromMatch?.[1]) {
      table = fromMatch[1];
    } else if (intoMatch?.[1]) {
      table = intoMatch[1];
    } else if (updateMatch?.[1]) {
      table = updateMatch[1];
    } else if (mergeMatch?.[1]) {
      table = mergeMatch[1];
    }

    // Extract fields for SELECT
    if (operation === 'read') {
      const selectMatch = sql.match(/SELECT\s+(.+?)\s+FROM/i);
      if (selectMatch?.[1] && selectMatch[1].trim() !== '*') {
        const fieldList = selectMatch[1].split(',').map(f => f.trim());
        for (const field of fieldList) {
          // Handle 'field as alias', 'table.field', aggregates
          const fieldName = this.extractFieldName(field);
          if (fieldName) {
            fields.push(fieldName);
          }
        }
      }
    }

    // Extract fields for INSERT
    if (operation === 'write' && upperSql.startsWith('INSERT')) {
      const columnsMatch = sql.match(/INSERT\s+INTO\s+\w+\s*\(([^)]+)\)/i);
      if (columnsMatch?.[1]) {
        const columnList = columnsMatch[1].split(',').map(c => c.trim().replace(/["'`\[\]]/g, ''));
        fields.push(...columnList);
      }
    }

    // Extract fields for UPDATE
    if (operation === 'write' && upperSql.startsWith('UPDATE')) {
      const setMatch = sql.match(/SET\s+(.+?)(?:\s+WHERE|$)/i);
      if (setMatch?.[1]) {
        const assignments = setMatch[1].split(',');
        for (const assignment of assignments) {
          const fieldMatch = assignment.match(/["'`\[]?(\w+)["'`\]]?\s*=/);
          if (fieldMatch?.[1]) {
            fields.push(fieldMatch[1]);
          }
        }
      }
    }

    return { table, operation, fields };
  }

  /**
   * Extract field name from a SELECT column expression
   */
  private extractFieldName(expr: string): string | null {
    // Skip aggregate functions without alias
    if (/^\s*(COUNT|SUM|AVG|MIN|MAX|COALESCE)\s*\(/i.test(expr)) {
      // Check for alias
      const aliasMatch = expr.match(/\s+AS\s+["'`\[]?(\w+)["'`\]]?\s*$/i);
      if (aliasMatch?.[1]) {
        return aliasMatch[1];
      }
      return null;
    }

    // Handle 'field AS alias'
    const aliasMatch = expr.match(/\s+AS\s+["'`\[]?(\w+)["'`\]]?\s*$/i);
    if (aliasMatch?.[1]) {
      return aliasMatch[1];
    }

    // Handle 'table.field'
    const dotMatch = expr.match(/\.["'`\[]?(\w+)["'`\]]?\s*$/);
    if (dotMatch?.[1]) {
      return dotMatch[1];
    }

    // Simple field name
    const simpleMatch = expr.match(/^["'`\[]?(\w+)["'`\]]?\s*$/);
    if (simpleMatch?.[1]) {
      return simpleMatch[1];
    }

    return null;
  }
}
