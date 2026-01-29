/**
 * Supabase Pattern Matcher
 *
 * Matches Supabase client patterns:
 * - supabase.from('table').select('*')
 * - supabase.from('table').insert({...})
 * - supabase.from('table').update({...}).eq('id', 1)
 * - supabase.from('table').delete().eq('id', 1)
 */

import { BaseMatcher } from './base-matcher.js';

import type { DataOperation } from '../../boundaries/types.js';
import type { UnifiedCallChain, PatternMatchResult, UnifiedLanguage } from '../types.js';

/**
 * Supabase pattern matcher
 */
export class SupabaseMatcher extends BaseMatcher {
  readonly id = 'supabase';
  readonly name = 'Supabase';
  readonly languages: UnifiedLanguage[] = ['typescript', 'javascript', 'python'];
  readonly priority = 100;

  match(chain: UnifiedCallChain): PatternMatchResult | null {
    // Find .from() segment
    const fromIndex = this.findSegment(chain, 'from');
    if (fromIndex === -1) {
      // Also check for from_ (Python SDK uses this)
      const fromUnderscoreIndex = this.findSegment(chain, 'from_');
      if (fromUnderscoreIndex === -1) {return null;}
      return this.matchFromIndex(chain, fromUnderscoreIndex);
    }

    return this.matchFromIndex(chain, fromIndex);
  }

  private matchFromIndex(chain: UnifiedCallChain, fromIndex: number): PatternMatchResult | null {
    // Get table name from .from('table')
    const table = this.getFirstStringArg(chain, fromIndex);
    if (!table) {return null;}

    // Determine operation and extract fields
    let operation: DataOperation = 'read';
    let fields: string[] = [];
    const whereFields: string[] = [];

    for (let i = fromIndex + 1; i < chain.segments.length; i++) {
      const segment = chain.segments[i];
      if (!segment) {continue;}

      const method = segment.name;

      // Select operation
      if (method === 'select') {
        operation = 'read';
        const selectArg = this.getFirstStringArg(chain, i);
        if (selectArg) {
          fields = this.extractFieldsFromString(selectArg);
        }
      }
      // Insert operation
      else if (method === 'insert' || method === 'upsert') {
        operation = 'write';
        if (segment.args.length > 0 && segment.args[0]) {
          const arg = segment.args[0];
          if (arg.type === 'object') {
            fields = this.extractFieldsFromObject(arg);
          } else if (arg.type === 'array' && arg.elements?.[0]) {
            // Array of objects - get fields from first element
            fields = this.extractFieldsFromObject(arg.elements[0]);
          }
        }
      }
      // Update operation
      else if (method === 'update') {
        operation = 'write';
        if (segment.args.length > 0 && segment.args[0]) {
          fields = this.extractFieldsFromObject(segment.args[0]);
        }
      }
      // Delete operation
      else if (method === 'delete') {
        operation = 'delete';
      }
      // Where clause methods - extract field names
      else if (this.isSupabaseWhereMethod(method)) {
        const field = this.extractWhereField(chain, i);
        if (field) {
          whereFields.push(field);
        }
      }
    }

    // Merge fields with where clause fields (deduplicated)
    const allFields = [...new Set([...fields, ...whereFields])];

    return this.createMatch({
      table,
      fields: allFields,
      operation,
      confidence: 0.95,
      metadata: {
        fromIndex,
        hasWhereClause: whereFields.length > 0,
      },
    });
  }

  /**
   * Check if method is a Supabase where clause method
   */
  private isSupabaseWhereMethod(method: string): boolean {
    const supabaseWhereMethods = [
      // Comparison
      'eq', 'neq', 'gt', 'gte', 'lt', 'lte',
      // Pattern matching
      'like', 'ilike',
      // Null checks
      'is',
      // Array operations
      'in', 'contains', 'containedBy', 'overlaps',
      // Range operations
      'rangeGt', 'rangeGte', 'rangeLt', 'rangeLte', 'rangeAdjacent',
      // Text search
      'textSearch', 'match',
      // Logical
      'not', 'or', 'filter',
    ];
    return supabaseWhereMethods.includes(method);
  }
}
