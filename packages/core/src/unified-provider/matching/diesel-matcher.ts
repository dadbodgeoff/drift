/**
 * Diesel Pattern Matcher
 *
 * Matches Diesel ORM (Rust) patterns:
 * - users::table.filter(users::id.eq(1)).load::<User>(&conn)
 * - diesel::insert_into(users::table).values(&new_user).execute(&conn)
 * - diesel::update(users::table).set(users::name.eq("new")).execute(&conn)
 * - diesel::delete(users::table.filter(...)).execute(&conn)
 * - users::table.select(users::name).first::<String>(&conn)
 *
 * @requirements Rust Language Support
 */

import { BaseMatcher } from './base-matcher.js';

import type { DataOperation } from '../../boundaries/types.js';
import type { UnifiedCallChain, PatternMatchResult, UnifiedLanguage, NormalizedArg } from '../types.js';

/**
 * Diesel pattern matcher
 */
export class DieselMatcher extends BaseMatcher {
  readonly id = 'diesel';
  readonly name = 'Diesel';
  readonly languages: UnifiedLanguage[] = ['rust'];
  readonly priority = 90;

  private readonly loadMethods = [
    'load', 'first', 'get_result', 'get_results',
  ];

  private readonly executeMethods = [
    'execute',
  ];

  match(chain: UnifiedCallChain): PatternMatchResult | null {
    // Pattern 1: diesel::* functions
    const dieselMatch = this.matchDieselPattern(chain);
    if (dieselMatch) {return dieselMatch;}

    // Pattern 2: table::table.* chains
    const tableMatch = this.matchTablePattern(chain);
    if (tableMatch) {return tableMatch;}

    return null;
  }

  private matchDieselPattern(chain: UnifiedCallChain): PatternMatchResult | null {
    // Check if receiver is diesel or starts with diesel::
    if (chain.receiver !== 'diesel' && !chain.receiver.startsWith('diesel::')) {
      return null;
    }

    return this.analyzeChain(chain);
  }

  private matchTablePattern(chain: UnifiedCallChain): PatternMatchResult | null {
    // Check if receiver looks like a Diesel table (ends with ::table)
    if (!chain.receiver.endsWith('::table')) {
      return null;
    }

    // Check if any segment is a Diesel method
    const hasDieselMethod = chain.segments.some(s =>
      this.loadMethods.includes(s.name) ||
      this.executeMethods.includes(s.name) ||
      s.name === 'filter' ||
      s.name === 'select' ||
      s.name === 'order' ||
      s.name === 'limit' ||
      s.name === 'offset'
    );

    if (!hasDieselMethod) {
      return null;
    }

    return this.analyzeChain(chain);
  }

  private analyzeChain(chain: UnifiedCallChain): PatternMatchResult | null {
    if (chain.segments.length < 1) {return null;}

    let operation: DataOperation | null = null;
    let table: string | null = null;
    const fields: string[] = [];

    // Try to extract table from receiver
    if (chain.receiver.endsWith('::table')) {
      table = this.extractTableFromPath(chain.receiver);
    }

    for (const segment of chain.segments) {
      if (!segment.isCall) {continue;}

      const methodName = segment.name;

      // Check for insert_into
      if (methodName === 'insert_into') {
        operation = 'write';
        if (segment.args.length > 0) {
          const argTable = this.extractTableFromArg(segment.args[0]!);
          if (argTable) {table = argTable;}
        }
      }

      // Check for update
      if (methodName === 'update') {
        operation = 'write';
        if (segment.args.length > 0) {
          const argTable = this.extractTableFromArg(segment.args[0]!);
          if (argTable) {table = argTable;}
        }
      }

      // Check for delete
      if (methodName === 'delete') {
        operation = 'delete';
        if (segment.args.length > 0) {
          const argTable = this.extractTableFromArg(segment.args[0]!);
          if (argTable) {table = argTable;}
        }
      }

      // Check for select (indicates read)
      if (methodName === 'select') {
        if (!operation) {operation = 'read';}
        // Extract fields from select
        for (const arg of segment.args) {
          const field = this.extractFieldFromArg(arg);
          if (field) {fields.push(field);}
        }
      }

      // Check for filter (might contain field references)
      if (methodName === 'filter') {
        if (!operation) {operation = 'read';}
        for (const arg of segment.args) {
          const field = this.extractFieldFromArg(arg);
          if (field) {fields.push(field);}
        }
      }

      // Check for set (update fields)
      if (methodName === 'set') {
        for (const arg of segment.args) {
          const field = this.extractFieldFromArg(arg);
          if (field) {fields.push(field);}
        }
      }

      // Check for values (insert fields)
      if (methodName === 'values') {
        // Values typically contain struct, harder to extract fields
      }

      // Check for load methods (read operation)
      if (this.loadMethods.includes(methodName)) {
        if (!operation) {operation = 'read';}
      }

      // Check for execute method
      if (this.executeMethods.includes(methodName)) {
        if (!operation) {operation = 'write';}
      }

      // Check for order, limit, offset (read indicators)
      if (methodName === 'order' || methodName === 'order_by' ||
          methodName === 'limit' || methodName === 'offset') {
        if (!operation) {operation = 'read';}
      }
    }

    if (!operation) {return null;}

    return this.createMatch({
      table: table ?? 'unknown',
      fields: [...new Set(fields)],
      operation,
      confidence: table ? 0.9 : 0.7,
      metadata: {
        pattern: 'diesel',
        chainLength: chain.segments.length,
      },
    });
  }

  private extractTableFromPath(path: string): string | null {
    // users::table -> users
    const match = path.match(/^(\w+)::table$/);
    if (match) {
      return match[1]!;
    }
    // schema::users::table -> users
    const schemaMatch = path.match(/::(\w+)::table$/);
    if (schemaMatch) {
      return schemaMatch[1]!;
    }
    return null;
  }

  private extractTableFromArg(arg: NormalizedArg): string | null {
    if (arg.type === 'identifier') {
      // users::table -> users
      const match = arg.value.match(/^(\w+)::table$/);
      if (match) {
        return match[1]!;
      }
      // Just table name
      if (arg.value.endsWith('::table')) {
        return arg.value.replace('::table', '').split('::').pop() ?? null;
      }
    }
    return null;
  }

  private extractFieldFromArg(arg: NormalizedArg): string | null {
    if (arg.type === 'identifier') {
      // users::id -> id
      const parts = arg.value.split('::');
      if (parts.length >= 2) {
        const field = parts[parts.length - 1];
        // Skip if it's 'table' or looks like a method
        if (field && field !== 'table' && !field.includes('(')) {
          return field;
        }
      }
    }
    return null;
  }
}
