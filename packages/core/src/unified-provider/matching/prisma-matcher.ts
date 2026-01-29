/**
 * Prisma Pattern Matcher
 *
 * Matches Prisma client patterns:
 * - prisma.user.findMany()
 * - prisma.user.findUnique({ where: { id: 1 } })
 * - prisma.user.create({ data: {...} })
 * - prisma.user.update({ where: {...}, data: {...} })
 * - prisma.user.delete({ where: {...} })
 */

import { BaseMatcher } from './base-matcher.js';

import type { DataOperation } from '../../boundaries/types.js';
import type { UnifiedCallChain, PatternMatchResult, UnifiedLanguage, NormalizedArg } from '../types.js';

/**
 * Prisma pattern matcher
 */
export class PrismaMatcher extends BaseMatcher {
  readonly id = 'prisma';
  readonly name = 'Prisma';
  readonly languages: UnifiedLanguage[] = ['typescript', 'javascript'];
  readonly priority = 95;

  // Prisma client methods that aren't model accessors
  private readonly clientMethods = [
    '$connect', '$disconnect', '$transaction', '$queryRaw', '$executeRaw',
    '$queryRawUnsafe', '$executeRawUnsafe', '$on', '$use', '$extends',
  ];

  // Prisma model methods
  private readonly readMethods = [
    'findUnique', 'findUniqueOrThrow', 'findFirst', 'findFirstOrThrow',
    'findMany', 'count', 'aggregate', 'groupBy',
  ];

  private readonly writeMethods = [
    'create', 'createMany', 'update', 'updateMany', 'upsert',
  ];

  private readonly deleteMethods = [
    'delete', 'deleteMany',
  ];

  match(chain: UnifiedCallChain): PatternMatchResult | null {
    // Check if receiver looks like a Prisma client
    if (!this.receiverMatches(chain, ['prisma', 'db', 'client'])) {
      return null;
    }

    // Need at least 2 segments: model.method()
    if (chain.segments.length < 2) {
      return null;
    }

    // First segment should be the model name
    const modelSegment = chain.segments[0];
    if (!modelSegment) {return null;}

    const modelName = modelSegment.name;

    // Skip if it's a client method, not a model
    if (this.clientMethods.includes(modelName)) {
      return null;
    }

    // Second segment should be the operation method
    const methodSegment = chain.segments[1];
    if (!methodSegment?.isCall) {
      return null;
    }

    const methodName = methodSegment.name;

    // Determine operation
    let operation: DataOperation;
    if (this.readMethods.includes(methodName)) {
      operation = 'read';
    } else if (this.writeMethods.includes(methodName)) {
      operation = 'write';
    } else if (this.deleteMethods.includes(methodName)) {
      operation = 'delete';
    } else {
      return null;
    }

    // Extract fields from the options object
    const fields = this.extractPrismaFields(methodSegment.args);

    // Infer table name from model name
    const table = this.inferTableName(modelName);

    return this.createMatch({
      table,
      fields,
      operation,
      confidence: 0.95,
      metadata: {
        modelName,
        methodName,
      },
    });
  }

  /**
   * Extract fields from Prisma method arguments
   */
  private extractPrismaFields(args: NormalizedArg[]): string[] {
    if (args.length === 0) {return [];}

    const firstArg = args[0];
    if (firstArg?.type !== 'object' || !firstArg.properties) {
      return [];
    }

    const fields: string[] = [];

    // Extract from 'select' option
    const selectArg = firstArg.properties['select'];
    if (selectArg?.type === 'object' && selectArg.properties) {
      fields.push(...Object.keys(selectArg.properties));
    }

    // Extract from 'include' option
    const includeArg = firstArg.properties['include'];
    if (includeArg?.type === 'object' && includeArg.properties) {
      fields.push(...Object.keys(includeArg.properties));
    }

    // Extract from 'data' option (for create/update)
    const dataArg = firstArg.properties['data'];
    if (dataArg?.type === 'object' && dataArg.properties) {
      fields.push(...Object.keys(dataArg.properties));
    }

    // Extract from 'where' option
    const whereArg = firstArg.properties['where'];
    if (whereArg?.type === 'object' && whereArg.properties) {
      fields.push(...Object.keys(whereArg.properties));
    }

    return [...new Set(fields)];
  }
}
