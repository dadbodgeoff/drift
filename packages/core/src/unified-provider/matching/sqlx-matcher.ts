/**
 * SQLx Pattern Matcher
 *
 * Matches SQLx (Rust async SQL toolkit) patterns:
 * - sqlx::query("SELECT ...").fetch_all(&pool)
 * - sqlx::query_as::<_, User>("SELECT ...").fetch_one(&pool)
 * - sqlx::query!("SELECT ...").fetch_optional(&pool)
 * - sqlx::query_scalar("SELECT count(*)").fetch_one(&pool)
 * - pool.execute("INSERT ...").await
 * - Transaction patterns
 *
 * @requirements Rust Language Support
 */

import { BaseMatcher } from './base-matcher.js';

import type { DataOperation } from '../../boundaries/types.js';
import type { UnifiedCallChain, PatternMatchResult, UnifiedLanguage, NormalizedArg } from '../types.js';

/**
 * SQLx pattern matcher
 */
export class SQLxMatcher extends BaseMatcher {
  readonly id = 'sqlx';
  readonly name = 'SQLx';
  readonly languages: UnifiedLanguage[] = ['rust'];
  readonly priority = 90;

  private readonly fetchMethods = [
    'fetch_one', 'fetch_optional', 'fetch_all', 'fetch',
  ];

  private readonly executeMethods = [
    'execute',
  ];

  match(chain: UnifiedCallChain): PatternMatchResult | null {
    // Pattern 1: sqlx::query*() chains
    const sqlxMatch = this.matchSqlxPattern(chain);
    if (sqlxMatch) {return sqlxMatch;}

    // Pattern 2: pool.execute() or pool.fetch*()
    const poolMatch = this.matchPoolPattern(chain);
    if (poolMatch) {return poolMatch;}

    // Pattern 3: Transaction patterns
    const txMatch = this.matchTransactionPattern(chain);
    if (txMatch) {return txMatch;}

    return null;
  }

  private matchSqlxPattern(chain: UnifiedCallChain): PatternMatchResult | null {
    // Check if receiver is sqlx or starts with sqlx::
    if (chain.receiver !== 'sqlx' && !chain.receiver.startsWith('sqlx::')) {
      return null;
    }

    return this.analyzeChain(chain);
  }

  private matchPoolPattern(chain: UnifiedCallChain): PatternMatchResult | null {
    const receiver = chain.receiver.toLowerCase();

    // Common pool receiver names
    const poolReceivers = ['pool', 'db', 'conn', 'connection', 'pg_pool', 'mysql_pool', 'sqlite_pool'];
    if (!poolReceivers.some(r => receiver.includes(r))) {
      return null;
    }

    // Check if any segment is a fetch or execute method
    const hasSqlxMethod = chain.segments.some(s =>
      this.fetchMethods.includes(s.name) || this.executeMethods.includes(s.name)
    );

    if (!hasSqlxMethod) {
      return null;
    }

    return this.analyzeChain(chain);
  }

  private matchTransactionPattern(chain: UnifiedCallChain): PatternMatchResult | null {
    const receiver = chain.receiver.toLowerCase();

    // Transaction receiver names
    const txReceivers = ['tx', 'transaction', 'txn'];
    if (!txReceivers.some(r => receiver === r || receiver.endsWith(r))) {
      return null;
    }

    return this.analyzeChain(chain);
  }

  private analyzeChain(chain: UnifiedCallChain): PatternMatchResult | null {
    if (chain.segments.length < 1) {return null;}

    let operation: DataOperation | null = null;
    let table: string | null = null;
    const fields: string[] = [];
    let isRawSql = false;
    let sqlQuery: string | null = null;

    for (const segment of chain.segments) {
      if (!segment.isCall) {continue;}

      const methodName = segment.name;

      // Check for query methods
      if (methodName === 'query' || methodName === 'query_as' ||
          methodName === 'query_scalar' || methodName === 'query_unchecked') {
        isRawSql = true;
        if (segment.args.length > 0) {
          sqlQuery = this.extractSqlQuery(segment.args[0]!);
          if (sqlQuery) {
            const parsed = this.parseSqlQuery(sqlQuery);
            operation = parsed.operation;
            table = parsed.table;
            fields.push(...parsed.fields);
          }
        }
      }

      // Check for compile-time checked query macros
      if (methodName.endsWith('!')) {
        const macroName = methodName.slice(0, -1);
        if (macroName === 'query' || macroName === 'query_as' ||
            macroName === 'query_scalar' || macroName === 'query_file' ||
            macroName === 'query_file_as' || macroName === 'query_file_scalar') {
          isRawSql = true;
          if (segment.args.length > 0) {
            sqlQuery = this.extractSqlQuery(segment.args[0]!);
            if (sqlQuery) {
              const parsed = this.parseSqlQuery(sqlQuery);
              operation = parsed.operation;
              table = parsed.table;
              fields.push(...parsed.fields);
            }
          }
        }
      }

      // Check for fetch methods (read operation)
      if (this.fetchMethods.includes(methodName)) {
        if (!operation) {operation = 'read';}
      }

      // Check for execute method
      if (this.executeMethods.includes(methodName)) {
        if (!operation) {operation = 'write';}
      }

      // Check for bind() to extract potential field info
      if (methodName === 'bind' && segment.args.length > 0) {
        // Bind arguments might give hints about fields
      }
    }

    if (!operation) {return null;}

    return this.createMatch({
      table: table ?? 'unknown',
      fields: [...new Set(fields)],
      operation,
      confidence: table ? 0.9 : 0.7,
      isRawSql,
      metadata: {
        pattern: 'sqlx',
        chainLength: chain.segments.length,
        sqlQuery,
      },
    });
  }

  private extractSqlQuery(arg: NormalizedArg): string | null {
    if (arg.stringValue) {
      return this.unquoteString(arg.stringValue);
    }
    if (arg.type === 'string') {
      return this.unquoteString(arg.value);
    }
    return null;
  }

  private parseSqlQuery(sql: string): {
    operation: DataOperation;
    table: string | null;
    fields: string[];
  } {
    const upperSql = sql.toUpperCase().trim();
    let operation: DataOperation = 'read';
    let table: string | null = null;
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
    }

    // Extract table name
    const fromMatch = sql.match(/\bFROM\s+["'`]?(\w+)["'`]?/i);
    if (fromMatch) {
      table = fromMatch[1]!;
    }

    const intoMatch = sql.match(/\bINTO\s+["'`]?(\w+)["'`]?/i);
    if (intoMatch) {
      table = intoMatch[1]!;
    }

    const updateMatch = sql.match(/\bUPDATE\s+["'`]?(\w+)["'`]?/i);
    if (updateMatch) {
      table = updateMatch[1]!;
    }

    // Extract fields from SELECT
    if (operation === 'read') {
      const selectMatch = sql.match(/SELECT\s+(.+?)\s+FROM/i);
      if (selectMatch) {
        const fieldsStr = selectMatch[1]!;
        if (fieldsStr !== '*') {
          const fieldList = fieldsStr.split(',').map(f => {
            // Handle aliases: field AS alias
            const aliasMatch = f.trim().match(/^["'`]?(\w+)["'`]?(?:\s+AS\s+\w+)?$/i);
            return aliasMatch ? aliasMatch[1]! : f.trim();
          }).filter(f => f && f !== '*');
          fields.push(...fieldList);
        }
      }
    }

    // Extract fields from INSERT
    if (operation === 'write' && upperSql.startsWith('INSERT')) {
      const columnsMatch = sql.match(/\(([^)]+)\)\s*VALUES/i);
      if (columnsMatch) {
        const columnList = columnsMatch[1]!.split(',').map(c => c.trim().replace(/["'`]/g, ''));
        fields.push(...columnList);
      }
    }

    // Extract fields from UPDATE SET
    if (operation === 'write' && upperSql.startsWith('UPDATE')) {
      const setMatch = sql.match(/SET\s+(.+?)(?:\s+WHERE|$)/i);
      if (setMatch) {
        const assignments = setMatch[1]!.split(',');
        for (const assignment of assignments) {
          const fieldMatch = assignment.match(/["'`]?(\w+)["'`]?\s*=/);
          if (fieldMatch) {
            fields.push(fieldMatch[1]!);
          }
        }
      }
    }

    return { operation, table, fields };
  }

  private unquoteString(str: string): string {
    // Handle Rust raw strings: r#"..."#, r##"..."##, etc.
    const rawMatch = str.match(/^r#*"([\s\S]*)"#*$/);
    if (rawMatch) {
      return rawMatch[1]!;
    }
    // Handle regular strings
    return str.replace(/^["'`]|["'`]$/g, '');
  }
}
