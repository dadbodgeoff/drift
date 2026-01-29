/**
 * Knex Pattern Matcher
 *
 * Matches Knex query builder patterns:
 * - knex('users').select('*')
 * - knex('users').where('id', 1).first()
 * - knex('users').insert({ name: 'John' })
 * - knex('users').where('id', 1).update({ name: 'Jane' })
 * - knex('users').where('id', 1).delete()
 */

import { BaseMatcher } from './base-matcher.js';

import type { DataOperation } from '../../boundaries/types.js';
import type { UnifiedCallChain, PatternMatchResult, UnifiedLanguage } from '../types.js';

/**
 * Knex pattern matcher
 */
export class KnexMatcher extends BaseMatcher {
  readonly id = 'knex';
  readonly name = 'Knex';
  readonly languages: UnifiedLanguage[] = ['typescript', 'javascript'];
  readonly priority = 85;

  // Read methods - used for documentation, actual detection uses segment names
  // private readonly readMethods = ['select', 'first', 'pluck', 'count', 'min', 'max', 'sum', 'avg', 'countDistinct', 'sumDistinct', 'avgDistinct'];

  private readonly writeMethods = [
    'insert', 'update', 'increment', 'decrement',
  ];

  private readonly deleteMethods = [
    'delete', 'del', 'truncate',
  ];

  // Methods that indicate raw SQL, not Knex query builder
  private readonly rawSqlMethods = [
    'query', 'execute', 'raw', 'rawQuery', 'sql',
    '$queryRaw', '$executeRaw', '$queryRawUnsafe', '$executeRawUnsafe',
  ];

  match(chain: UnifiedCallChain): PatternMatchResult | null {
    // Pattern: knex('table') or db('table')
    const receiver = chain.receiver.toLowerCase();
    if (!receiver.includes('knex') && !receiver.includes('db')) {
      return null;
    }

    // First segment should be the table call: knex('users')
    if (chain.segments.length < 1) {return null;}

    const firstSegment = chain.segments[0];
    if (!firstSegment?.isCall) {return null;}

    // Skip if this looks like raw SQL (query, execute, etc.)
    if (this.rawSqlMethods.includes(firstSegment.name)) {
      return null;
    }

    // Check if first segment is the table name call
    // knex('users') appears as receiver='knex', segments=[{name:'knex', args:['users']}]
    // OR as receiver='knex', segments=[{name:'users', args:[]}] depending on parsing

    let table: string | null = null;

    // If first segment has a string arg, that's the table
    if (firstSegment.args[0]?.stringValue) {
      table = firstSegment.args[0].stringValue;
      // But skip if it looks like SQL
      if (/^\s*(SELECT|INSERT|UPDATE|DELETE|MERGE)\s/i.test(table)) {
        return null;
      }
    }
    // If receiver is called with table name
    else if (firstSegment.name === chain.receiver && firstSegment.args[0]?.stringValue) {
      table = firstSegment.args[0].stringValue;
      // But skip if it looks like SQL
      if (/^\s*(SELECT|INSERT|UPDATE|DELETE|MERGE)\s/i.test(table)) {
        return null;
      }
    }

    if (!table) {return null;}

    // Determine operation from chain methods
    let operation: DataOperation = 'read';
    const fields: string[] = [];

    for (const segment of chain.segments) {
      if (this.writeMethods.includes(segment.name)) {
        operation = 'write';
        // Extract fields from insert/update
        if (segment.args[0]?.type === 'object' && segment.args[0].properties) {
          fields.push(...Object.keys(segment.args[0].properties));
        }
      } else if (this.deleteMethods.includes(segment.name)) {
        operation = 'delete';
      } else if (segment.name === 'select' && segment.args.length > 0) {
        // Extract selected fields
        for (const arg of segment.args) {
          if (arg.stringValue && arg.stringValue !== '*') {
            fields.push(...this.extractFieldsFromString(arg.stringValue));
          }
        }
      } else if (this.isWhereMethod(segment.name) && segment.args[0]) {
        // Extract field from where clause
        const field = segment.args[0].stringValue ?? segment.args[0].value;
        if (field && typeof field === 'string') {
          fields.push(field);
        }
      }
    }

    return this.createMatch({
      table,
      fields: [...new Set(fields)],
      operation,
      confidence: 0.9,
    });
  }
}
