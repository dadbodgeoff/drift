/**
 * Mongoose Pattern Matcher
 *
 * Matches Mongoose ODM patterns:
 * - User.find({})
 * - User.findOne({ email: 'test@example.com' })
 * - User.findById(id)
 * - User.create({ name: 'John' })
 * - User.updateOne({ _id: id }, { name: 'Jane' })
 * - User.deleteOne({ _id: id })
 * - new User({ name: 'John' }).save()
 */

import { BaseMatcher } from './base-matcher.js';

import type { DataOperation } from '../../boundaries/types.js';
import type { UnifiedCallChain, PatternMatchResult, UnifiedLanguage, NormalizedArg } from '../types.js';

/**
 * Mongoose pattern matcher
 */
export class MongooseMatcher extends BaseMatcher {
  readonly id = 'mongoose';
  readonly name = 'Mongoose';
  readonly languages: UnifiedLanguage[] = ['typescript', 'javascript'];
  readonly priority = 86;

  private readonly readMethods = [
    'find', 'findOne', 'findById', 'findOneAndUpdate', 'findByIdAndUpdate',
    'countDocuments', 'estimatedDocumentCount', 'distinct', 'exists',
    'aggregate', 'populate', 'lean', 'exec',
  ];

  private readonly writeMethods = [
    'create', 'insertMany', 'save', 'updateOne', 'updateMany',
    'findOneAndUpdate', 'findByIdAndUpdate', 'replaceOne', 'bulkWrite',
  ];

  private readonly deleteMethods = [
    'deleteOne', 'deleteMany', 'findOneAndDelete', 'findByIdAndDelete',
    'findOneAndRemove', 'findByIdAndRemove', 'remove',
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

    // Infer collection name from model (MongoDB uses collections)
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
    // Some methods can be both read and write (findOneAndUpdate)
    // We categorize by primary intent
    if (this.deleteMethods.includes(methodName)) {return 'delete';}
    if (this.writeMethods.includes(methodName)) {return 'write';}
    if (this.readMethods.includes(methodName)) {return 'read';}
    return null;
  }

  private extractFields(args: NormalizedArg[], methodName: string): string[] {
    if (args.length === 0) {return [];}

    const fields: string[] = [];

    // For create/insertMany, first arg is the document(s)
    if (methodName === 'create' || methodName === 'insertMany' || methodName === 'save') {
      const dataArg = args[0];
      if (dataArg?.type === 'object' && dataArg.properties) {
        fields.push(...Object.keys(dataArg.properties));
      }
      if (dataArg?.type === 'array' && dataArg.elements?.[0]?.type === 'object') {
        fields.push(...Object.keys(dataArg.elements[0].properties ?? {}));
      }
      return [...new Set(fields)];
    }

    // For update methods, second arg is the update document
    if (methodName.includes('update') || methodName.includes('Update')) {
      // First arg is filter
      if (args[0]?.type === 'object' && args[0].properties) {
        fields.push(...Object.keys(args[0].properties));
      }
      // Second arg is update
      if (args[1]?.type === 'object' && args[1].properties) {
        // Handle $set, $inc, etc.
        for (const [key, value] of Object.entries(args[1].properties)) {
          if (key.startsWith('$') && value.type === 'object' && value.properties) {
            fields.push(...Object.keys(value.properties));
          } else {
            fields.push(key);
          }
        }
      }
      return [...new Set(fields)];
    }

    // For find methods, first arg is the query/filter
    const queryArg = args[0];
    if (queryArg?.type === 'object' && queryArg.properties) {
      fields.push(...Object.keys(queryArg.properties));
    }

    // Second arg might be projection
    if (args[1]) {
      const projArg = args[1];
      if (projArg.type === 'object' && projArg.properties) {
        fields.push(...Object.keys(projArg.properties));
      } else if (projArg.stringValue) {
        // String projection: 'name email -password'
        const projFields = projArg.stringValue.split(/\s+/)
          .filter(f => f && !f.startsWith('-'));
        fields.push(...projFields);
      }
    }

    return [...new Set(fields)];
  }
}
