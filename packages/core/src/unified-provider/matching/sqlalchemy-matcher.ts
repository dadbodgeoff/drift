/**
 * SQLAlchemy Pattern Matcher
 *
 * Matches SQLAlchemy patterns:
 * - session.query(User).filter(User.id == 1).all()
 * - session.query(User).filter_by(id=1).first()
 * - session.add(user)
 * - session.delete(user)
 * - select(User).where(User.id == 1)
 * - insert(users).values(name='John')
 * - update(users).where(users.c.id == 1).values(name='Jane')
 * - delete(users).where(users.c.id == 1)
 */

import { BaseMatcher } from './base-matcher.js';

import type { DataOperation } from '../../boundaries/types.js';
import type { UnifiedCallChain, PatternMatchResult, UnifiedLanguage } from '../types.js';

/**
 * SQLAlchemy pattern matcher
 */
export class SQLAlchemyMatcher extends BaseMatcher {
  readonly id = 'sqlalchemy';
  readonly name = 'SQLAlchemy';
  readonly languages: UnifiedLanguage[] = ['python'];
  readonly priority = 93;

  // Method lists for reference - actual detection uses inline checks
  // Read: query, get, filter, filter_by, all, first, one, one_or_none, scalar, count, exists, select, join, outerjoin
  // Write: add, add_all, merge, flush, commit, insert, update
  // Delete: delete

  match(chain: UnifiedCallChain): PatternMatchResult | null {
    // Pattern 1: session.query(Model)
    const sessionMatch = this.matchSessionPattern(chain);
    if (sessionMatch) {return sessionMatch;}

    // Pattern 2: select(Model) / insert(table) / update(table) / delete(table)
    const coreMatch = this.matchCorePattern(chain);
    if (coreMatch) {return coreMatch;}

    return null;
  }

  private matchSessionPattern(chain: UnifiedCallChain): PatternMatchResult | null {
    const receiver = chain.receiver.toLowerCase();
    if (!receiver.includes('session') && !receiver.includes('db')) {
      return null;
    }

    // Look for query() or add/delete
    const queryIndex = chain.segments.findIndex(s => s.name === 'query');
    const addIndex = chain.segments.findIndex(s => s.name === 'add' || s.name === 'add_all');
    const deleteIndex = chain.segments.findIndex(s => s.name === 'delete');

    if (queryIndex !== -1) {
      return this.handleQueryPattern(chain, queryIndex);
    }

    if (addIndex !== -1) {
      return this.handleAddPattern(chain, addIndex);
    }

    if (deleteIndex !== -1) {
      return this.handleDeletePattern(chain, deleteIndex);
    }

    return null;
  }

  private handleQueryPattern(chain: UnifiedCallChain, queryIndex: number): PatternMatchResult | null {
    const querySegment = chain.segments[queryIndex];
    if (!querySegment?.args[0]) {return null;}

    // Get model name from query(Model)
    const modelArg = querySegment.args[0];
    const modelName = modelArg.type === 'identifier'
      ? modelArg.value
      : 'unknown';

    // Determine operation from subsequent methods
    let operation: DataOperation = 'read';
    const fields: string[] = [];

    for (let i = queryIndex + 1; i < chain.segments.length; i++) {
      const segment = chain.segments[i];
      if (!segment) {continue;}

      if (segment.name === 'delete') {
        operation = 'delete';
      } else if (segment.name === 'update') {
        operation = 'write';
      } else if (segment.name === 'filter_by') {
        // Extract fields from filter_by kwargs
        this.extractKwargs(segment.args, fields);
      } else if (segment.name === 'filter') {
        // filter() uses expressions, harder to extract
      }
    }

    const table = this.inferTableName(modelName);

    return this.createMatch({
      table,
      fields: [...new Set(fields)],
      operation,
      confidence: 0.9,
      metadata: { pattern: 'session.query', modelName },
    });
  }

  private handleAddPattern(chain: UnifiedCallChain, addIndex: number): PatternMatchResult | null {
    const addSegment = chain.segments[addIndex];
    if (!addSegment?.args[0]) {return null;}

    // Try to infer model from the argument
    const arg = addSegment.args[0];
    let modelName = 'unknown';

    if (arg.type === 'identifier') {
      // Might be a variable name like 'user'
      modelName = arg.value;
    }

    const table = this.inferTableName(modelName);

    return this.createMatch({
      table,
      fields: [],
      operation: 'write',
      confidence: 0.8,
      metadata: { pattern: 'session.add' },
    });
  }

  private handleDeletePattern(chain: UnifiedCallChain, deleteIndex: number): PatternMatchResult | null {
    const deleteSegment = chain.segments[deleteIndex];
    if (!deleteSegment?.args[0]) {return null;}

    const arg = deleteSegment.args[0];
    let modelName = 'unknown';

    if (arg.type === 'identifier') {
      modelName = arg.value;
    }

    const table = this.inferTableName(modelName);

    return this.createMatch({
      table,
      fields: [],
      operation: 'delete',
      confidence: 0.8,
      metadata: { pattern: 'session.delete' },
    });
  }

  private matchCorePattern(chain: UnifiedCallChain): PatternMatchResult | null {
    // Look for select/insert/update/delete as first segment
    const firstSegment = chain.segments[0];
    if (!firstSegment?.isCall) {return null;}

    const method = firstSegment.name;
    if (!['select', 'insert', 'update', 'delete'].includes(method)) {
      return null;
    }

    // Get table/model from first argument
    const tableArg = firstSegment.args[0];
    if (!tableArg) {return null;}

    const tableName = tableArg.type === 'identifier'
      ? this.inferTableName(tableArg.value)
      : tableArg.stringValue ?? 'unknown';

    let operation: DataOperation;
    const fields: string[] = [];

    switch (method) {
      case 'select':
        operation = 'read';
        break;
      case 'insert':
        operation = 'write';
        // Look for values()
        const valuesIndex = chain.segments.findIndex(s => s.name === 'values');
        if (valuesIndex !== -1) {
          this.extractKwargs(chain.segments[valuesIndex]?.args ?? [], fields);
        }
        break;
      case 'update':
        operation = 'write';
        // Look for values()
        const updateValuesIndex = chain.segments.findIndex(s => s.name === 'values');
        if (updateValuesIndex !== -1) {
          this.extractKwargs(chain.segments[updateValuesIndex]?.args ?? [], fields);
        }
        break;
      case 'delete':
        operation = 'delete';
        break;
      default:
        return null;
    }

    return this.createMatch({
      table: tableName,
      fields: [...new Set(fields)],
      operation,
      confidence: 0.9,
      metadata: { pattern: 'core' },
    });
  }

  private extractKwargs(args: import('../types.js').NormalizedArg[], fields: string[]): void {
    for (const arg of args) {
      if (arg.value.includes('=')) {
        const match = arg.value.match(/^(\w+)=/);
        if (match?.[1]) {
          fields.push(match[1]);
        }
      }
      if (arg.type === 'object' && arg.properties) {
        fields.push(...Object.keys(arg.properties));
      }
    }
  }
}
