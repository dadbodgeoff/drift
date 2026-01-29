/**
 * Base Pattern Matcher
 *
 * Shared utilities for ORM/database pattern matchers.
 */

import type { DataOperation } from '../../boundaries/types.js';
import type {
  UnifiedLanguage,
  UnifiedCallChain,
  PatternMatchResult,
  PatternMatcher,
  NormalizedArg,
} from '../types.js';

/**
 * Base class for pattern matchers
 */
export abstract class BaseMatcher implements PatternMatcher {
  abstract readonly id: string;
  abstract readonly name: string;
  abstract readonly languages: UnifiedLanguage[];
  abstract readonly priority: number;

  /**
   * Attempt to match a call chain against this pattern
   */
  abstract match(chain: UnifiedCallChain): PatternMatchResult | null;

  // ============================================================================
  // Shared Utilities
  // ============================================================================

  /**
   * Create a successful match result
   */
  protected createMatch(opts: {
    table: string;
    fields?: string[];
    operation: DataOperation;
    confidence?: number;
    isRawSql?: boolean;
    metadata?: Record<string, unknown>;
  }): PatternMatchResult {
    return {
      matched: true,
      orm: this.id,
      table: opts.table,
      fields: opts.fields ?? [],
      operation: opts.operation,
      confidence: opts.confidence ?? 0.9,
      isRawSql: opts.isRawSql ?? false,
      metadata: opts.metadata,
    };
  }

  /**
   * Check if the chain receiver matches expected patterns
   */
  protected receiverMatches(chain: UnifiedCallChain, patterns: string[]): boolean {
    const receiver = chain.receiver.toLowerCase();
    return patterns.some(p => receiver.includes(p.toLowerCase()));
  }

  /**
   * Find a segment by name in the chain
   */
  protected findSegment(chain: UnifiedCallChain, name: string): number {
    return chain.segments.findIndex(s => s.name === name);
  }

  /**
   * Find segments matching any of the given names
   */
  protected findSegments(chain: UnifiedCallChain, names: string[]): number[] {
    const indices: number[] = [];
    chain.segments.forEach((s, i) => {
      if (names.includes(s.name)) {
        indices.push(i);
      }
    });
    return indices;
  }

  /**
   * Get the first string argument from a segment
   */
  protected getFirstStringArg(chain: UnifiedCallChain, segmentIndex: number): string | null {
    const segment = chain.segments[segmentIndex];
    if (!segment || segment.args.length === 0) {return null;}

    const firstArg = segment.args[0];
    if (!firstArg) {return null;}

    if (firstArg.type === 'string' && firstArg.stringValue) {
      return firstArg.stringValue;
    }

    return null;
  }

  /**
   * Get all string arguments from a segment
   */
  protected getStringArgs(chain: UnifiedCallChain, segmentIndex: number): string[] {
    const segment = chain.segments[segmentIndex];
    if (!segment) {return [];}

    return segment.args
      .filter(a => a.type === 'string' && a.stringValue)
      .map(a => a.stringValue!);
  }

  /**
   * Extract fields from a string argument (comma-separated)
   */
  protected extractFieldsFromString(str: string): string[] {
    if (str === '*') {return [];}

    return str
      .split(',')
      .map(f => f.trim())
      .filter(f => f && f !== '*')
      .map(f => {
        // Handle 'field as alias' or 'table.field'
        const parts = f.split(/\s+as\s+/i);
        const fieldPart = parts[0]?.trim() ?? f;
        const dotParts = fieldPart.split('.');
        return dotParts[dotParts.length - 1]?.trim() ?? fieldPart;
      });
  }

  /**
   * Extract fields from an object argument
   */
  protected extractFieldsFromObject(arg: NormalizedArg): string[] {
    if (arg.type !== 'object' || !arg.properties) {return [];}
    return Object.keys(arg.properties);
  }

  /**
   * Extract fields from an array argument
   */
  protected extractFieldsFromArray(arg: NormalizedArg): string[] {
    if (arg.type !== 'array' || !arg.elements) {return [];}

    return arg.elements
      .filter(e => e.type === 'string' && e.stringValue)
      .map(e => e.stringValue!);
  }

  /**
   * Detect operation from method name
   */
  protected detectOperation(methodName: string): DataOperation | null {
    const lower = methodName.toLowerCase();

    // Read operations
    if (/^(get|find|fetch|load|read|select|query|search|list|count|exists|single|first|one|many|all)/.test(lower)) {
      return 'read';
    }

    // Write operations
    if (/^(create|insert|add|save|update|upsert|put|set|write|store|merge|bulk)/.test(lower)) {
      return 'write';
    }

    // Delete operations
    if (/^(delete|remove|destroy|drop|truncate|clear)/.test(lower)) {
      return 'delete';
    }

    return null;
  }

  /**
   * Infer table name from a variable/class name
   */
  protected inferTableName(name: string): string {
    const cleaned = name
      .replace(/Repository$/i, '')
      .replace(/Model$/i, '')
      .replace(/Service$/i, '')
      .replace(/DAO$/i, '')
      .replace(/Entity$/i, '')
      .replace(/Manager$/i, '')
      .replace(/^_+/, '');

    // Convert to snake_case
    const snakeCase = cleaned
      .replace(/([A-Z])/g, '_$1')
      .toLowerCase()
      .replace(/^_/, '');

    // Simple pluralization
    if (!snakeCase.endsWith('s')) {
      return snakeCase + 's';
    }
    return snakeCase;
  }

  /**
   * Check if a method name is a where clause method
   */
  protected isWhereMethod(name: string): boolean {
    const whereMethods = [
      'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'is', 'in',
      'contains', 'containedBy', 'overlaps', 'match', 'not', 'or', 'filter',
      'where', 'andWhere', 'orWhere', 'whereIn', 'whereNotIn', 'whereNull',
      'whereNotNull', 'whereBetween', 'whereNotBetween', 'whereRaw',
      'equals', 'ne', 'nin', 'regex',
    ];
    return whereMethods.includes(name);
  }

  /**
   * Extract field from a where clause segment
   */
  protected extractWhereField(chain: UnifiedCallChain, segmentIndex: number): string | null {
    const segment = chain.segments[segmentIndex];
    if (!segment || segment.args.length === 0) {return null;}

    const firstArg = segment.args[0];
    if (!firstArg) {return null;}

    // String argument: .eq('field', value)
    if (firstArg.type === 'string' && firstArg.stringValue) {
      return firstArg.stringValue;
    }

    // Object argument: .where({ field: value })
    if (firstArg.type === 'object' && firstArg.properties) {
      const keys = Object.keys(firstArg.properties);
      return keys[0] ?? null;
    }

    // Identifier: .where(field, value)
    if (firstArg.type === 'identifier') {
      return firstArg.value;
    }

    return null;
  }
}
