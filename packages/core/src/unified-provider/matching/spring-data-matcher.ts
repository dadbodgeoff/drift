/**
 * Spring Data JPA Pattern Matcher
 *
 * Matches Spring Data JPA patterns:
 * - userRepository.findAll()
 * - userRepository.findById(id)
 * - userRepository.save(user)
 * - userRepository.delete(user)
 * - userRepository.findByEmailAndActive(email, true)
 */

import { BaseMatcher } from './base-matcher.js';

import type { DataOperation } from '../../boundaries/types.js';
import type { UnifiedCallChain, PatternMatchResult, UnifiedLanguage } from '../types.js';

/**
 * Spring Data JPA pattern matcher
 */
export class SpringDataMatcher extends BaseMatcher {
  readonly id = 'spring-data';
  readonly name = 'Spring Data JPA';
  readonly languages: UnifiedLanguage[] = ['java'];
  readonly priority = 92;

  private readonly readMethods = [
    'findAll', 'findById', 'findOne', 'findAllById',
    'existsById', 'exists', 'count', 'getOne', 'getById',
    // Query derivation patterns
    'findBy', 'findAllBy', 'findFirstBy', 'findTopBy',
    'readBy', 'readAllBy', 'getBy', 'getAllBy',
    'queryBy', 'queryAllBy', 'searchBy', 'searchAllBy',
    'streamBy', 'streamAllBy',
    'countBy', 'existsBy',
  ];

  private readonly writeMethods = [
    'save', 'saveAll', 'saveAndFlush', 'saveAllAndFlush',
    'flush',
  ];

  private readonly deleteMethods = [
    'delete', 'deleteById', 'deleteAll', 'deleteAllById',
    'deleteInBatch', 'deleteAllInBatch', 'deleteAllByIdInBatch',
    'removeBy', 'deleteBy',
  ];

  match(chain: UnifiedCallChain): PatternMatchResult | null {
    // Look for repository pattern
    const receiver = chain.receiver.toLowerCase();
    if (!receiver.includes('repository') && !receiver.includes('repo') && !receiver.includes('dao')) {
      return null;
    }

    if (chain.segments.length < 1) {return null;}

    const methodSegment = chain.segments[0];
    if (!methodSegment?.isCall) {return null;}

    const methodName = methodSegment.name;
    const operation = this.getOperation(methodName);
    if (!operation) {return null;}

    // Infer table from repository name
    const table = this.inferTableName(chain.receiver);

    // Extract fields from query derivation method names
    const fields = this.extractFieldsFromMethodName(methodName);

    return this.createMatch({
      table,
      fields,
      operation,
      confidence: 0.9,
      metadata: { methodName },
    });
  }

  private getOperation(methodName: string): DataOperation | null {
    // Check exact matches first
    if (this.readMethods.includes(methodName)) {return 'read';}
    if (this.writeMethods.includes(methodName)) {return 'write';}
    if (this.deleteMethods.includes(methodName)) {return 'delete';}

    // Check prefix patterns for query derivation
    for (const prefix of this.readMethods) {
      if (methodName.startsWith(prefix)) {return 'read';}
    }
    for (const prefix of this.deleteMethods) {
      if (methodName.startsWith(prefix)) {return 'delete';}
    }

    return null;
  }

  /**
   * Extract field names from Spring Data query derivation method names
   * e.g., findByEmailAndActiveTrue -> ['email', 'active']
   */
  private extractFieldsFromMethodName(methodName: string): string[] {
    const fields: string[] = [];

    // Remove common prefixes
    const remaining = methodName
      .replace(/^(find|read|get|query|search|stream|count|exists|delete|remove)(All|First|Top\d*)?By/, '')
      .replace(/^(OrderBy.*)$/, ''); // Remove OrderBy suffix

    if (!remaining) {return fields;}

    // Split by And/Or
    const parts = remaining.split(/(?:And|Or)/);

    for (const part of parts) {
      // Remove comparison suffixes
      const fieldPart = part
        .replace(/(Is|Equals|Not|IsNot|NotNull|Null|True|False|Before|After|LessThan|LessThanEqual|GreaterThan|GreaterThanEqual|Between|Like|NotLike|StartingWith|EndingWith|Containing|In|NotIn|IgnoreCase|OrderBy.*)$/, '');

      if (fieldPart) {
        // Convert to camelCase field name
        const fieldName = fieldPart.charAt(0).toLowerCase() + fieldPart.slice(1);
        fields.push(fieldName);
      }
    }

    return [...new Set(fields)];
  }
}
