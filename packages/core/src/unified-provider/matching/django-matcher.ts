/**
 * Django ORM Pattern Matcher
 *
 * Matches Django ORM patterns:
 * - User.objects.all()
 * - User.objects.filter(active=True)
 * - User.objects.get(id=1)
 * - User.objects.create(name='John')
 * - User.objects.filter(id=1).update(name='Jane')
 * - User.objects.filter(id=1).delete()
 */

import { BaseMatcher } from './base-matcher.js';

import type { DataOperation } from '../../boundaries/types.js';
import type { UnifiedCallChain, PatternMatchResult, UnifiedLanguage } from '../types.js';

/**
 * Django ORM pattern matcher
 */
export class DjangoMatcher extends BaseMatcher {
  readonly id = 'django';
  readonly name = 'Django ORM';
  readonly languages: UnifiedLanguage[] = ['python'];
  readonly priority = 95;

  private readonly readMethods = [
    'get', 'filter', 'exclude', 'all', 'first', 'last',
    'values', 'values_list', 'annotate', 'aggregate',
    'count', 'exists', 'distinct', 'order_by', 'reverse',
    'select_related', 'prefetch_related', 'defer', 'only',
  ];

  private readonly writeMethods = [
    'create', 'update', 'bulk_create', 'bulk_update',
    'get_or_create', 'update_or_create', 'save',
  ];

  private readonly deleteMethods = [
    'delete',
  ];

  match(chain: UnifiedCallChain): PatternMatchResult | null {
    // Look for .objects. pattern
    const objectsIndex = chain.segments.findIndex(s => s.name === 'objects');
    if (objectsIndex === -1) {return null;}

    // Model should be before .objects
    let modelName: string;
    if (objectsIndex === 0) {
      // receiver.objects.method()
      modelName = chain.receiver;
    } else {
      // Something else - not a typical Django pattern
      return null;
    }

    // Model must be PascalCase
    if (!/^[A-Z][a-zA-Z0-9]*$/.test(modelName)) {return null;}

    // Find the operation method
    let operation: DataOperation = 'read';
    const fields: string[] = [];

    for (let i = objectsIndex + 1; i < chain.segments.length; i++) {
      const segment = chain.segments[i];
      if (!segment) {continue;}

      if (this.deleteMethods.includes(segment.name)) {
        operation = 'delete';
      } else if (this.writeMethods.includes(segment.name)) {
        operation = 'write';
        // Extract fields from create/update kwargs
        this.extractKwargs(segment.args, fields);
      } else if (this.readMethods.includes(segment.name)) {
        // Extract fields from filter/get kwargs
        this.extractKwargs(segment.args, fields);
      }
    }

    const table = this.inferTableName(modelName);

    return this.createMatch({
      table,
      fields: [...new Set(fields)],
      operation,
      confidence: 0.95,
      metadata: { modelName },
    });
  }

  /**
   * Extract field names from Django-style keyword arguments
   * Django uses field=value or field__lookup=value patterns
   */
  private extractKwargs(args: import('../types.js').NormalizedArg[], fields: string[]): void {
    for (const arg of args) {
      // In Python, kwargs appear as 'key=value' in the value string
      if (arg.value.includes('=')) {
        const match = arg.value.match(/^(\w+)(?:__\w+)?=/);
        if (match?.[1]) {
          fields.push(match[1]);
        }
      }
      // Object-style args
      if (arg.type === 'object' && arg.properties) {
        for (const key of Object.keys(arg.properties)) {
          // Handle Django lookups: field__gte, field__contains, etc.
          const fieldName = key.split('__')[0];
          if (fieldName) {
            fields.push(fieldName);
          }
        }
      }
    }
  }
}
