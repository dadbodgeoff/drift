/**
 * Entity Framework Core Pattern Matcher
 *
 * Matches EF Core patterns:
 * - _context.Users.ToListAsync()
 * - _context.Users.Where(u => u.Active).FirstOrDefaultAsync()
 * - _context.Users.Add(user)
 * - _context.Users.Remove(user)
 * - _context.SaveChangesAsync()
 */

import { BaseMatcher } from './base-matcher.js';

import type { DataOperation } from '../../boundaries/types.js';
import type { UnifiedCallChain, PatternMatchResult, UnifiedLanguage } from '../types.js';

/**
 * Entity Framework Core pattern matcher
 */
export class EFCoreMatcher extends BaseMatcher {
  readonly id = 'efcore';
  readonly name = 'Entity Framework Core';
  readonly languages: UnifiedLanguage[] = ['csharp'];
  readonly priority = 95;

  private readonly readMethods = [
    'ToList', 'ToListAsync', 'ToArray', 'ToArrayAsync',
    'First', 'FirstAsync', 'FirstOrDefault', 'FirstOrDefaultAsync',
    'Single', 'SingleAsync', 'SingleOrDefault', 'SingleOrDefaultAsync',
    'Find', 'FindAsync', 'Count', 'CountAsync', 'Any', 'AnyAsync',
    'All', 'AllAsync', 'Sum', 'SumAsync', 'Average', 'AverageAsync',
    'Min', 'MinAsync', 'Max', 'MaxAsync',
  ];

  private readonly writeMethods = [
    'Add', 'AddAsync', 'AddRange', 'AddRangeAsync',
    'Update', 'UpdateRange', 'Attach', 'AttachRange',
    'SaveChanges', 'SaveChangesAsync',
  ];

  private readonly deleteMethods = [
    'Remove', 'RemoveRange',
  ];

  private readonly queryMethods = [
    'Where', 'Select', 'OrderBy', 'OrderByDescending',
    'ThenBy', 'ThenByDescending', 'Include', 'ThenInclude',
    'Skip', 'Take', 'GroupBy', 'Join', 'AsNoTracking',
  ];

  match(chain: UnifiedCallChain): PatternMatchResult | null {
    // Look for DbContext pattern: _context.DbSet or context.DbSet
    const receiver = chain.receiver.toLowerCase();
    if (!receiver.includes('context') && !receiver.includes('db')) {
      return null;
    }

    if (chain.segments.length < 1) {return null;}

    // First segment should be the DbSet (table name)
    const dbSetSegment = chain.segments[0];
    if (!dbSetSegment) {return null;}

    // DbSet access is typically not a call (property access)
    // e.g., _context.Users.Where(...)
    const tableName = this.inferTableName(dbSetSegment.name);

    // Determine operation from chain methods
    let operation: DataOperation = 'read';
    const fields: string[] = [];

    for (const segment of chain.segments) {
      if (this.writeMethods.includes(segment.name)) {
        operation = 'write';
      } else if (this.deleteMethods.includes(segment.name)) {
        operation = 'delete';
      } else if (segment.name === 'Select' && segment.args.length > 0) {
        // Try to extract selected fields from lambda
        // This is complex in C# due to lambda syntax
      }
    }

    // Check if this looks like an EF Core query
    const hasEfMethod = chain.segments.some(s =>
      this.readMethods.includes(s.name) ||
      this.writeMethods.includes(s.name) ||
      this.deleteMethods.includes(s.name) ||
      this.queryMethods.includes(s.name)
    );

    if (!hasEfMethod) {
      return null;
    }

    return this.createMatch({
      table: tableName,
      fields,
      operation,
      confidence: 0.9,
      metadata: { dbSetName: dbSetSegment.name },
    });
  }
}
