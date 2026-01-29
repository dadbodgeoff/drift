/**
 * Laravel Eloquent Pattern Matcher
 *
 * Matches Eloquent ORM patterns:
 * - User::all()
 * - User::find(1)
 * - User::where('active', true)->get()
 * - User::create(['name' => 'John'])
 * - $user->save()
 * - $user->delete()
 */

import { BaseMatcher } from './base-matcher.js';

import type { DataOperation } from '../../boundaries/types.js';
import type { UnifiedCallChain, PatternMatchResult, UnifiedLanguage, NormalizedArg } from '../types.js';

/**
 * Laravel Eloquent pattern matcher
 */
export class EloquentMatcher extends BaseMatcher {
  readonly id = 'eloquent';
  readonly name = 'Laravel Eloquent';
  readonly languages: UnifiedLanguage[] = ['php'];
  readonly priority = 95;

  private readonly readMethods = [
    'all', 'get', 'first', 'firstOrFail', 'find', 'findOrFail',
    'findMany', 'pluck', 'value', 'count', 'max', 'min', 'avg', 'sum',
    'exists', 'doesntExist', 'paginate', 'simplePaginate', 'cursor',
  ];

  private readonly writeMethods = [
    'create', 'insert', 'insertOrIgnore', 'upsert',
    'update', 'updateOrCreate', 'updateOrInsert',
    'save', 'push', 'increment', 'decrement',
    'fill', 'forceFill',
  ];

  private readonly deleteMethods = [
    'delete', 'destroy', 'forceDelete', 'truncate',
  ];

  private readonly queryMethods = [
    'where', 'orWhere', 'whereIn', 'whereNotIn', 'whereBetween',
    'whereNull', 'whereNotNull', 'whereDate', 'whereMonth', 'whereYear',
    'orderBy', 'orderByDesc', 'latest', 'oldest',
    'select', 'addSelect', 'distinct',
    'with', 'withCount', 'has', 'whereHas', 'doesntHave',
    'skip', 'take', 'limit', 'offset',
    'groupBy', 'having', 'join', 'leftJoin', 'rightJoin',
  ];

  match(chain: UnifiedCallChain): PatternMatchResult | null {
    // Pattern 1: Model::method() - static calls
    const staticMatch = this.matchStaticPattern(chain);
    if (staticMatch) {return staticMatch;}

    // Pattern 2: $model->method() - instance calls
    const instanceMatch = this.matchInstancePattern(chain);
    if (instanceMatch) {return instanceMatch;}

    return null;
  }

  private matchStaticPattern(chain: UnifiedCallChain): PatternMatchResult | null {
    // Model must be PascalCase
    if (!/^[A-Z][a-zA-Z0-9]*$/.test(chain.receiver)) {return null;}

    // Skip common PHP classes
    const commonClasses = [
      'App', 'Auth', 'Cache', 'Config', 'DB', 'Event', 'Log',
      'Mail', 'Queue', 'Request', 'Response', 'Route', 'Session',
      'Storage', 'URL', 'Validator', 'View',
    ];
    if (commonClasses.includes(chain.receiver)) {return null;}

    if (chain.segments.length < 1) {return null;}

    // Check if any segment is an Eloquent method
    const hasEloquentMethod = chain.segments.some(s =>
      this.readMethods.includes(s.name) ||
      this.writeMethods.includes(s.name) ||
      this.deleteMethods.includes(s.name) ||
      this.queryMethods.includes(s.name)
    );

    if (!hasEloquentMethod) {return null;}

    const table = this.inferTableName(chain.receiver);
    let operation: DataOperation = 'read';
    const fields: string[] = [];

    for (const segment of chain.segments) {
      if (this.writeMethods.includes(segment.name)) {
        operation = 'write';
        this.extractFieldsFromArgs(segment.args, fields);
      } else if (this.deleteMethods.includes(segment.name)) {
        operation = 'delete';
      } else if (segment.name === 'select' && segment.args.length > 0) {
        this.extractSelectFields(segment.args, fields);
      } else if (this.queryMethods.includes(segment.name) && segment.args.length > 0) {
        // First arg to where/orderBy is often the field name
        const firstArg = segment.args[0];
        if (firstArg?.stringValue) {
          fields.push(firstArg.stringValue);
        }
      }
    }

    return this.createMatch({
      table,
      fields: [...new Set(fields)],
      operation,
      confidence: 0.9,
      metadata: { modelName: chain.receiver },
    });
  }

  private matchInstancePattern(chain: UnifiedCallChain): PatternMatchResult | null {
    // Instance pattern: $user->save(), $post->delete()
    // Receiver would be a variable name (lowercase)
    if (/^[A-Z]/.test(chain.receiver)) {return null;}

    if (chain.segments.length < 1) {return null;}

    const firstSegment = chain.segments[0];
    if (!firstSegment?.isCall) {return null;}

    // Check for instance methods
    if (!this.writeMethods.includes(firstSegment.name) &&
        !this.deleteMethods.includes(firstSegment.name)) {
      return null;
    }

    // Infer table from variable name
    const table = this.inferTableName(chain.receiver);

    let operation: DataOperation = 'read';
    const fields: string[] = [];

    if (this.writeMethods.includes(firstSegment.name)) {
      operation = 'write';
      this.extractFieldsFromArgs(firstSegment.args, fields);
    } else if (this.deleteMethods.includes(firstSegment.name)) {
      operation = 'delete';
    }

    return this.createMatch({
      table,
      fields: [...new Set(fields)],
      operation,
      confidence: 0.75, // Lower confidence for instance pattern
      metadata: { pattern: 'instance' },
    });
  }

  private extractFieldsFromArgs(args: NormalizedArg[], fields: string[]): void {
    for (const arg of args) {
      if (arg.type === 'object' && arg.properties) {
        fields.push(...Object.keys(arg.properties));
      }
    }
  }

  private extractSelectFields(args: NormalizedArg[], fields: string[]): void {
    for (const arg of args) {
      if (arg.stringValue) {
        fields.push(arg.stringValue);
      } else if (arg.type === 'array' && arg.elements) {
        for (const elem of arg.elements) {
          if (elem.stringValue) {
            fields.push(elem.stringValue);
          }
        }
      }
    }
  }
}
