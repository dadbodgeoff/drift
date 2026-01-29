/**
 * Drizzle Pattern Matcher
 *
 * Matches Drizzle ORM patterns:
 * - db.select().from(users)
 * - db.select({ id: users.id }).from(users)
 * - db.insert(users).values({ name: 'John' })
 * - db.update(users).set({ name: 'Jane' }).where(eq(users.id, 1))
 * - db.delete(users).where(eq(users.id, 1))
 */

import { BaseMatcher } from './base-matcher.js';

import type { DataOperation } from '../../boundaries/types.js';
import type { UnifiedCallChain, PatternMatchResult, UnifiedLanguage } from '../types.js';

/**
 * Drizzle pattern matcher
 */
export class DrizzleMatcher extends BaseMatcher {
  readonly id = 'drizzle';
  readonly name = 'Drizzle';
  readonly languages: UnifiedLanguage[] = ['typescript', 'javascript'];
  readonly priority = 92;

  match(chain: UnifiedCallChain): PatternMatchResult | null {
    // Look for Drizzle patterns
    const hasSelect = chain.segments.some(s => s.name === 'select' || s.name === 'selectDistinct');
    const hasInsert = chain.segments.some(s => s.name === 'insert');
    const hasUpdate = chain.segments.some(s => s.name === 'update');
    const hasDelete = chain.segments.some(s => s.name === 'delete');

    if (!hasSelect && !hasInsert && !hasUpdate && !hasDelete) {
      return null;
    }

    // Determine operation
    let operation: DataOperation = 'read';
    if (hasInsert) {operation = 'write';}
    if (hasUpdate) {operation = 'write';}
    if (hasDelete) {operation = 'delete';}

    // Find table name
    const table = this.extractTableName(chain, operation);
    if (!table) {return null;}

    // Extract fields
    const fields = this.extractFields(chain, operation);

    return this.createMatch({
      table,
      fields,
      operation,
      confidence: 0.9,
    });
  }

  private extractTableName(chain: UnifiedCallChain, operation: DataOperation): string | null {
    // For select: look for .from(table)
    if (operation === 'read') {
      const fromIndex = chain.segments.findIndex(s => s.name === 'from');
      if (fromIndex !== -1) {
        const fromSegment = chain.segments[fromIndex];
        if (fromSegment?.args[0]) {
          const arg = fromSegment.args[0];
          if (arg.type === 'identifier') {
            return this.inferTableName(arg.value);
          }
          if (arg.stringValue) {
            return arg.stringValue;
          }
        }
      }
    }

    // For insert/update/delete: table is first arg to the method
    const methodIndex = chain.segments.findIndex(s =>
      s.name === 'insert' || s.name === 'update' || s.name === 'delete'
    );

    if (methodIndex !== -1) {
      const methodSegment = chain.segments[methodIndex];
      if (methodSegment?.args[0]) {
        const arg = methodSegment.args[0];
        if (arg.type === 'identifier') {
          return this.inferTableName(arg.value);
        }
        if (arg.stringValue) {
          return arg.stringValue;
        }
      }
    }

    return null;
  }

  private extractFields(chain: UnifiedCallChain, operation: DataOperation): string[] {
    const fields: string[] = [];

    // For select: check select() args
    if (operation === 'read') {
      const selectIndex = chain.segments.findIndex(s =>
        s.name === 'select' || s.name === 'selectDistinct'
      );
      if (selectIndex !== -1) {
        const selectSegment = chain.segments[selectIndex];
        if (selectSegment?.args[0]?.type === 'object' && selectSegment.args[0].properties) {
          fields.push(...Object.keys(selectSegment.args[0].properties));
        }
      }
    }

    // For insert: check values() args
    if (operation === 'write') {
      const valuesIndex = chain.segments.findIndex(s => s.name === 'values');
      if (valuesIndex !== -1) {
        const valuesSegment = chain.segments[valuesIndex];
        if (valuesSegment?.args[0]?.type === 'object' && valuesSegment.args[0].properties) {
          fields.push(...Object.keys(valuesSegment.args[0].properties));
        }
      }

      // For update: check set() args
      const setIndex = chain.segments.findIndex(s => s.name === 'set');
      if (setIndex !== -1) {
        const setSegment = chain.segments[setIndex];
        if (setSegment?.args[0]?.type === 'object' && setSegment.args[0].properties) {
          fields.push(...Object.keys(setSegment.args[0].properties));
        }
      }
    }

    // Extract fields from where clauses
    const whereIndex = chain.segments.findIndex(s => s.name === 'where');
    if (whereIndex !== -1) {
      // Drizzle where clauses use eq(table.field, value) pattern
      // We can't easily extract these without deeper analysis
      // For now, we'll skip where field extraction
    }

    return [...new Set(fields)];
  }
}
