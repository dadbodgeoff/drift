/**
 * Sequelize Pattern Matcher
 *
 * Matches Sequelize patterns:
 * - User.findAll()
 * - User.findOne({ where: { id: 1 } })
 * - User.create({ name: 'John' })
 * - User.update({ name: 'Jane' }, { where: { id: 1 } })
 * - User.destroy({ where: { id: 1 } })
 */

import { BaseMatcher } from './base-matcher.js';

import type { DataOperation } from '../../boundaries/types.js';
import type { UnifiedCallChain, PatternMatchResult, UnifiedLanguage, NormalizedArg } from '../types.js';

/**
 * Sequelize pattern matcher
 */
export class SequelizeMatcher extends BaseMatcher {
  readonly id = 'sequelize';
  readonly name = 'Sequelize';
  readonly languages: UnifiedLanguage[] = ['typescript', 'javascript'];
  readonly priority = 88;

  private readonly readMethods = [
    'findAll', 'findOne', 'findByPk', 'findOrCreate', 'findAndCountAll',
    'findCreateFind', 'count', 'max', 'min', 'sum', 'aggregate',
  ];

  private readonly writeMethods = [
    'create', 'bulkCreate', 'update', 'upsert', 'increment', 'decrement',
  ];

  private readonly deleteMethods = [
    'destroy', 'truncate',
  ];

  match(chain: UnifiedCallChain): PatternMatchResult | null {
    // Model must be PascalCase
    if (!/^[A-Z][a-zA-Z0-9]*$/.test(chain.receiver)) {return null;}

    // Skip common JS classes
    const commonClasses = [
      'Array', 'Object', 'String', 'Number', 'Boolean', 'Promise',
      'Map', 'Set', 'Date', 'Error', 'RegExp', 'JSON', 'Math',
    ];
    if (commonClasses.includes(chain.receiver)) {return null;}

    if (chain.segments.length < 1) {return null;}

    const methodSegment = chain.segments[0];
    if (!methodSegment?.isCall) {return null;}

    const operation = this.getOperation(methodSegment.name);
    if (!operation) {return null;}

    const table = this.inferTableName(chain.receiver);
    const fields = this.extractFields(methodSegment.args, methodSegment.name);

    return this.createMatch({
      table,
      fields,
      operation,
      confidence: 0.85,
      metadata: { modelName: chain.receiver },
    });
  }

  private getOperation(methodName: string): DataOperation | null {
    if (this.readMethods.includes(methodName)) {return 'read';}
    if (this.writeMethods.includes(methodName)) {return 'write';}
    if (this.deleteMethods.includes(methodName)) {return 'delete';}
    return null;
  }

  private extractFields(args: NormalizedArg[], methodName: string): string[] {
    if (args.length === 0) {return [];}

    const fields: string[] = [];

    // For update, first arg is data, second is options
    if (methodName === 'update' && args.length >= 1) {
      const dataArg = args[0];
      if (dataArg?.type === 'object' && dataArg.properties) {
        fields.push(...Object.keys(dataArg.properties));
      }
      // Options with where clause
      if (args[1]?.type === 'object' && args[1].properties) {
        const whereArg = args[1].properties['where'];
        if (whereArg?.type === 'object' && whereArg.properties) {
          fields.push(...Object.keys(whereArg.properties));
        }
      }
      return [...new Set(fields)];
    }

    const firstArg = args[0];
    if (!firstArg) {return [];}

    // For create, the arg is the data object
    if (methodName === 'create' || methodName === 'bulkCreate') {
      if (firstArg.type === 'object' && firstArg.properties) {
        return Object.keys(firstArg.properties);
      }
      if (firstArg.type === 'array' && firstArg.elements?.[0]?.type === 'object') {
        return Object.keys(firstArg.elements[0].properties ?? {});
      }
      return [];
    }

    // For find methods, extract from options object
    if (firstArg.type !== 'object' || !firstArg.properties) {
      return [];
    }

    // Extract from 'where' option
    const whereArg = firstArg.properties['where'];
    if (whereArg?.type === 'object' && whereArg.properties) {
      fields.push(...Object.keys(whereArg.properties));
    }

    // Extract from 'attributes' option
    const attrsArg = firstArg.properties['attributes'];
    if (attrsArg?.type === 'array' && attrsArg.elements) {
      for (const elem of attrsArg.elements) {
        if (elem.stringValue) {fields.push(elem.stringValue);}
      }
    }

    // Extract from 'include' option (relations)
    const includeArg = firstArg.properties['include'];
    if (includeArg?.type === 'array' && includeArg.elements) {
      for (const elem of includeArg.elements) {
        if (elem.type === 'object' && elem.properties?.['model']) {
          const modelArg = elem.properties['model'];
          if (modelArg.type === 'identifier') {
            fields.push(modelArg.value);
          }
        }
      }
    }

    return [...new Set(fields)];
  }
}
