/**
 * SeaORM Pattern Matcher
 *
 * Matches SeaORM (Rust async ORM) patterns:
 * - Entity::find().filter(Column::Id.eq(1)).one(&db).await
 * - Entity::insert(model).exec(&db).await
 * - Entity::update(model).exec(&db).await
 * - Entity::delete_by_id(1).exec(&db).await
 * - Entity::find_by_id(1).one(&db).await
 *
 * @requirements Rust Language Support
 */

import { BaseMatcher } from './base-matcher.js';

import type { DataOperation } from '../../boundaries/types.js';
import type { UnifiedCallChain, PatternMatchResult, UnifiedLanguage, NormalizedArg } from '../types.js';

/**
 * SeaORM pattern matcher
 */
export class SeaORMMatcher extends BaseMatcher {
  readonly id = 'seaorm';
  readonly name = 'SeaORM';
  readonly languages: UnifiedLanguage[] = ['rust'];
  readonly priority = 90;

  private readonly findMethods = [
    'find', 'find_by_id', 'find_related', 'find_with_related',
    'find_also_related', 'find_also_linked',
  ];

  private readonly fetchMethods = [
    'one', 'all', 'stream', 'count', 'paginate',
  ];

  private readonly writeMethods = [
    'insert', 'insert_many', 'update', 'update_many',
    'save', 'exec', 'exec_with_returning',
  ];

  private readonly deleteMethods = [
    'delete', 'delete_by_id', 'delete_many',
  ];

  match(chain: UnifiedCallChain): PatternMatchResult | null {
    // Pattern 1: Entity::method() chains
    const entityMatch = this.matchEntityPattern(chain);
    if (entityMatch) {return entityMatch;}

    // Pattern 2: sea_orm::* patterns
    const seaOrmMatch = this.matchSeaOrmPattern(chain);
    if (seaOrmMatch) {return seaOrmMatch;}

    return null;
  }

  private matchEntityPattern(chain: UnifiedCallChain): PatternMatchResult | null {
    // Check if first segment is a SeaORM method
    if (chain.segments.length < 1) {return null;}

    const firstSegment = chain.segments[0]!;
    if (!firstSegment.isCall) {return null;}

    const isSeaOrmMethod =
      this.findMethods.includes(firstSegment.name) ||
      this.writeMethods.includes(firstSegment.name) ||
      this.deleteMethods.includes(firstSegment.name);

    if (!isSeaOrmMethod) {
      return null;
    }

    // Check if receiver looks like an Entity (PascalCase)
    if (!/^[A-Z][a-zA-Z0-9]*$/.test(chain.receiver)) {
      return null;
    }

    return this.analyzeChain(chain);
  }

  private matchSeaOrmPattern(chain: UnifiedCallChain): PatternMatchResult | null {
    // Check if receiver is sea_orm or starts with sea_orm::
    if (chain.receiver !== 'sea_orm' && !chain.receiver.startsWith('sea_orm::')) {
      return null;
    }

    return this.analyzeChain(chain);
  }

  private analyzeChain(chain: UnifiedCallChain): PatternMatchResult | null {
    if (chain.segments.length < 1) {return null;}

    let operation: DataOperation | null = null;
    let table: string | null = null;
    const fields: string[] = [];

    // Try to extract table from receiver (Entity name)
    if (/^[A-Z][a-zA-Z0-9]*$/.test(chain.receiver)) {
      table = this.entityToTable(chain.receiver);
    }

    for (const segment of chain.segments) {
      if (!segment.isCall) {continue;}

      const methodName = segment.name;

      // Check for find methods (read)
      if (this.findMethods.includes(methodName)) {
        operation = 'read';
        // find_by_id might have ID in args
      }

      // Check for insert methods (write)
      if (methodName === 'insert' || methodName === 'insert_many') {
        operation = 'write';
      }

      // Check for update methods (write)
      if (methodName === 'update' || methodName === 'update_many' || methodName === 'save') {
        operation = 'write';
      }

      // Check for delete methods
      if (this.deleteMethods.includes(methodName)) {
        operation = 'delete';
      }

      // Check for filter/select to extract fields
      if (methodName === 'filter') {
        for (const arg of segment.args) {
          const field = this.extractFieldFromArg(arg);
          if (field) {fields.push(field);}
        }
      }

      if (methodName === 'select' || methodName === 'column') {
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

      // Check for fetch methods (confirms read)
      if (this.fetchMethods.includes(methodName)) {
        if (!operation) {operation = 'read';}
      }

      // Check for exec (confirms write/delete)
      if (methodName === 'exec' || methodName === 'exec_with_returning') {
        if (!operation) {operation = 'write';}
      }

      // Check for order_by, limit, offset (read indicators)
      if (methodName === 'order_by' || methodName === 'order_by_asc' ||
          methodName === 'order_by_desc' || methodName === 'limit' ||
          methodName === 'offset') {
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
        pattern: 'seaorm',
        chainLength: chain.segments.length,
      },
    });
  }

  private entityToTable(entity: string): string {
    // Convert PascalCase to snake_case and pluralize
    // User -> users, UserProfile -> user_profiles
    const snakeCase = entity
      .replace(/([A-Z])/g, '_$1')
      .toLowerCase()
      .replace(/^_/, '');

    // Simple pluralization (not comprehensive)
    if (snakeCase.endsWith('y')) {
      return snakeCase.slice(0, -1) + 'ies';
    } else if (snakeCase.endsWith('s') || snakeCase.endsWith('x') ||
               snakeCase.endsWith('ch') || snakeCase.endsWith('sh')) {
      return snakeCase + 'es';
    } else {
      return snakeCase + 's';
    }
  }

  private extractFieldFromArg(arg: NormalizedArg): string | null {
    if (arg.type === 'identifier') {
      // Column::Name -> name
      const columnMatch = arg.value.match(/Column::(\w+)/);
      if (columnMatch) {
        return this.columnToField(columnMatch[1]!);
      }

      // entity::Column::Name -> name
      const fullMatch = arg.value.match(/::Column::(\w+)/);
      if (fullMatch) {
        return this.columnToField(fullMatch[1]!);
      }
    }
    return null;
  }

  private columnToField(column: string): string {
    // Convert PascalCase column name to snake_case field name
    return column
      .replace(/([A-Z])/g, '_$1')
      .toLowerCase()
      .replace(/^_/, '');
  }
}
