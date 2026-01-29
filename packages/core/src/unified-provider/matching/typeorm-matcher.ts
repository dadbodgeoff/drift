/**
 * TypeORM Pattern Matcher
 *
 * Matches TypeORM patterns:
 * - repository.find()
 * - repository.findOne({ where: { id: 1 } })
 * - repository.save(entity)
 * - repository.delete({ id: 1 })
 * - Entity.find()
 * - getRepository(Entity).find()
 */

import { BaseMatcher } from './base-matcher.js';

import type { DataOperation } from '../../boundaries/types.js';
import type { UnifiedCallChain, PatternMatchResult, UnifiedLanguage, NormalizedArg } from '../types.js';

/**
 * TypeORM pattern matcher
 */
export class TypeORMMatcher extends BaseMatcher {
  readonly id = 'typeorm';
  readonly name = 'TypeORM';
  readonly languages: UnifiedLanguage[] = ['typescript', 'javascript'];
  readonly priority = 90;

  private readonly readMethods = [
    'find', 'findOne', 'findOneBy', 'findBy', 'findAndCount',
    'findOneOrFail', 'findOneByOrFail', 'count', 'countBy',
    'exist', 'existsBy', 'query', 'createQueryBuilder',
  ];

  private readonly writeMethods = [
    'save', 'insert', 'update', 'upsert', 'increment', 'decrement',
  ];

  private readonly deleteMethods = [
    'delete', 'remove', 'softDelete', 'softRemove', 'restore',
  ];

  match(chain: UnifiedCallChain): PatternMatchResult | null {
    // Pattern 1: repository.method() where repository name contains 'repository' or 'repo'
    const repoMatch = this.matchRepositoryPattern(chain);
    if (repoMatch) {return repoMatch;}

    // Pattern 2: Entity.method() where Entity is PascalCase
    const entityMatch = this.matchEntityPattern(chain);
    if (entityMatch) {return entityMatch;}

    // Pattern 3: getRepository(Entity).method()
    const getRepoMatch = this.matchGetRepositoryPattern(chain);
    if (getRepoMatch) {return getRepoMatch;}

    return null;
  }

  private matchRepositoryPattern(chain: UnifiedCallChain): PatternMatchResult | null {
    const receiver = chain.receiver.toLowerCase();
    if (!receiver.includes('repository') && !receiver.includes('repo')) {
      return null;
    }

    if (chain.segments.length < 1) {return null;}

    const methodSegment = chain.segments[0];
    if (!methodSegment?.isCall) {return null;}

    const operation = this.getOperation(methodSegment.name);
    if (!operation) {return null;}

    const table = this.inferTableName(chain.receiver);
    const fields = this.extractFields(methodSegment.args);

    return this.createMatch({
      table,
      fields,
      operation,
      confidence: 0.85,
      metadata: { pattern: 'repository' },
    });
  }

  private matchEntityPattern(chain: UnifiedCallChain): PatternMatchResult | null {
    // Entity must be PascalCase and not a common JS class
    if (!/^[A-Z][a-zA-Z0-9]*$/.test(chain.receiver)) {return null;}

    const commonClasses = [
      'Array', 'Object', 'String', 'Number', 'Boolean', 'Promise',
      'Map', 'Set', 'Date', 'Error', 'RegExp', 'JSON', 'Math',
      'Console', 'Buffer', 'Process',
    ];
    if (commonClasses.includes(chain.receiver)) {return null;}

    if (chain.segments.length < 1) {return null;}

    const methodSegment = chain.segments[0];
    if (!methodSegment?.isCall) {return null;}

    const operation = this.getOperation(methodSegment.name);
    if (!operation) {return null;}

    const table = this.inferTableName(chain.receiver);
    const fields = this.extractFields(methodSegment.args);

    return this.createMatch({
      table,
      fields,
      operation,
      confidence: 0.75, // Lower confidence for entity pattern
      metadata: { pattern: 'entity' },
    });
  }

  private matchGetRepositoryPattern(chain: UnifiedCallChain): PatternMatchResult | null {
    // Look for getRepository in the chain
    const getRepoIndex = chain.segments.findIndex(s =>
      s.name === 'getRepository' && s.isCall
    );

    if (getRepoIndex === -1) {return null;}

    const getRepoSegment = chain.segments[getRepoIndex];
    if (!getRepoSegment || getRepoSegment.args.length === 0) {return null;}

    // Get entity name from argument
    const entityArg = getRepoSegment.args[0];
    if (!entityArg) {return null;}

    const entityName = entityArg.type === 'identifier'
      ? entityArg.value
      : entityArg.stringValue ?? 'unknown';

    // Find the method call after getRepository
    const methodSegment = chain.segments[getRepoIndex + 1];
    if (!methodSegment?.isCall) {return null;}

    const operation = this.getOperation(methodSegment.name);
    if (!operation) {return null;}

    const table = this.inferTableName(entityName);
    const fields = this.extractFields(methodSegment.args);

    return this.createMatch({
      table,
      fields,
      operation,
      confidence: 0.9,
      metadata: { pattern: 'getRepository', entityName },
    });
  }

  private getOperation(methodName: string): DataOperation | null {
    if (this.readMethods.includes(methodName)) {return 'read';}
    if (this.writeMethods.includes(methodName)) {return 'write';}
    if (this.deleteMethods.includes(methodName)) {return 'delete';}
    return null;
  }

  private extractFields(args: NormalizedArg[]): string[] {
    if (args.length === 0) {return [];}

    const firstArg = args[0];
    if (firstArg?.type !== 'object' || !firstArg.properties) {
      return [];
    }

    const fields: string[] = [];

    // Extract from 'where' option
    const whereArg = firstArg.properties['where'];
    if (whereArg?.type === 'object' && whereArg.properties) {
      fields.push(...Object.keys(whereArg.properties));
    }

    // Extract from 'select' option
    const selectArg = firstArg.properties['select'];
    if (selectArg?.type === 'object' && selectArg.properties) {
      fields.push(...Object.keys(selectArg.properties));
    }

    // Extract from 'relations' option
    const relationsArg = firstArg.properties['relations'];
    if (relationsArg?.type === 'array' && relationsArg.elements) {
      for (const elem of relationsArg.elements) {
        if (elem.stringValue) {fields.push(elem.stringValue);}
      }
    }

    return [...new Set(fields)];
  }
}
