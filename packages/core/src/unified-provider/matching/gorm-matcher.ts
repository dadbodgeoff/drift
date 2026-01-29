/**
 * GORM Pattern Matcher
 *
 * Matches GORM (Go ORM) patterns:
 * - db.Find(&users)
 * - db.First(&user, id)
 * - db.Create(&user)
 * - db.Save(&user)
 * - db.Delete(&user)
 * - db.Where("name = ?", name).Find(&users)
 * - db.Model(&User{}).Where(...).Update(...)
 * - db.Table("users").Select("name").Find(&users)
 *
 * @requirements Go Language Support
 */

import { BaseMatcher } from './base-matcher.js';

import type { DataOperation } from '../../boundaries/types.js';
import type { UnifiedCallChain, PatternMatchResult, UnifiedLanguage, NormalizedArg } from '../types.js';

/**
 * GORM pattern matcher
 */
export class GORMMatcher extends BaseMatcher {
  readonly id = 'gorm';
  readonly name = 'GORM';
  readonly languages: UnifiedLanguage[] = ['go'];
  readonly priority = 90;

  private readonly readMethods = [
    'Find', 'First', 'Last', 'Take', 'Scan',
    'Count', 'Pluck', 'Row', 'Rows',
    'FirstOrInit', 'FirstOrCreate',
  ];

  private readonly writeMethods = [
    'Create', 'Save', 'Update', 'Updates',
    'UpdateColumn', 'UpdateColumns',
  ];

  private readonly deleteMethods = [
    'Delete', 'Unscoped',
  ];

  match(chain: UnifiedCallChain): PatternMatchResult | null {
    // Pattern 1: db.Method() where db is a GORM database instance
    const dbMatch = this.matchDbPattern(chain);
    if (dbMatch) {return dbMatch;}

    // Pattern 2: tx.Method() for transaction patterns
    const txMatch = this.matchTransactionPattern(chain);
    if (txMatch) {return txMatch;}

    return null;
  }

  private matchDbPattern(chain: UnifiedCallChain): PatternMatchResult | null {
    const receiver = chain.receiver.toLowerCase();

    // Common GORM receiver names
    const gormReceivers = ['db', 'gdb', 'gorm', 'conn', 'connection', 'database'];
    if (!gormReceivers.some(r => receiver.includes(r))) {
      return null;
    }

    return this.analyzeChain(chain);
  }

  private matchTransactionPattern(chain: UnifiedCallChain): PatternMatchResult | null {
    const receiver = chain.receiver.toLowerCase();

    // Transaction receiver names
    const txReceivers = ['tx', 'transaction', 'trx'];
    if (!txReceivers.some(r => receiver === r || receiver.endsWith(r))) {
      return null;
    }

    return this.analyzeChain(chain);
  }

  private analyzeChain(chain: UnifiedCallChain): PatternMatchResult | null {
    if (chain.segments.length < 1) {return null;}

    // Find the terminal operation (last method that determines operation type)
    let operation: DataOperation | null = null;
    let operationSegmentIndex = -1;
    let table: string | null = null;
    const fields: string[] = [];

    for (let i = 0; i < chain.segments.length; i++) {
      const segment = chain.segments[i];
      if (!segment?.isCall) {continue;}

      const methodName = segment.name;

      // Check for Model() or Table() to get table name
      if (methodName === 'Model' && segment.args.length > 0) {
        table = this.extractModelName(segment.args[0]!);
      } else if (methodName === 'Table' && segment.args.length > 0) {
        table = this.extractTableName(segment.args[0]!);
      }

      // Check for Select() to get fields
      if (methodName === 'Select' && segment.args.length > 0) {
        fields.push(...this.extractSelectFields(segment.args));
      }

      // Check for Where() to get fields
      if (methodName === 'Where' && segment.args.length > 0) {
        fields.push(...this.extractWhereFields(segment.args));
      }

      // Check for terminal operation
      const op = this.getOperation(methodName);
      if (op) {
        operation = op;
        operationSegmentIndex = i;

        // Try to extract table from operation argument
        if (!table && segment.args.length > 0) {
          const argTable = this.extractModelName(segment.args[0]!);
          if (argTable) {table = argTable;}
        }
      }
    }

    if (!operation) {return null;}

    // If no table found, try to infer from receiver
    if (!table) {
      table = this.inferTableFromReceiver(chain.receiver);
    }

    return this.createMatch({
      table: table ?? 'unknown',
      fields: [...new Set(fields)],
      operation,
      confidence: table ? 0.9 : 0.7,
      metadata: {
        pattern: 'gorm',
        chainLength: chain.segments.length,
        operationIndex: operationSegmentIndex,
      },
    });
  }

  private getOperation(methodName: string): DataOperation | null {
    if (this.readMethods.includes(methodName)) {return 'read';}
    if (this.writeMethods.includes(methodName)) {return 'write';}
    if (this.deleteMethods.includes(methodName)) {return 'delete';}
    return null;
  }

  private extractModelName(arg: NormalizedArg): string | null {
    // Handle &User{} or User{} patterns
    if (arg.type === 'identifier') {
      // Remove pointer prefix if present
      const value = arg.value.replace(/^[&*]/, '');
      // Check if it looks like a struct name (PascalCase)
      if (/^[A-Z][a-zA-Z0-9]*$/.test(value)) {
        return this.inferTableName(value);
      }
    }

    // Handle string value
    if (arg.stringValue) {
      return arg.stringValue;
    }

    return null;
  }

  private extractTableName(arg: NormalizedArg): string | null {
    if (arg.stringValue) {
      return this.unquoteString(arg.stringValue);
    }
    if (arg.type === 'string') {
      return this.unquoteString(arg.value);
    }
    return null;
  }

  private extractSelectFields(args: NormalizedArg[]): string[] {
    const fields: string[] = [];

    for (const arg of args) {
      if (arg.stringValue) {
        // Handle "field1, field2" or "field1"
        const fieldStr = this.unquoteString(arg.stringValue);
        fields.push(...fieldStr.split(',').map(f => f.trim()).filter(Boolean));
      } else if (arg.type === 'string') {
        const fieldStr = this.unquoteString(arg.value);
        fields.push(...fieldStr.split(',').map(f => f.trim()).filter(Boolean));
      } else if (arg.type === 'array' && arg.elements) {
        for (const elem of arg.elements) {
          if (elem.stringValue) {
            fields.push(this.unquoteString(elem.stringValue));
          }
        }
      }
    }

    return fields;
  }

  private extractWhereFields(args: NormalizedArg[]): string[] {
    const fields: string[] = [];

    if (args.length === 0) {return fields;}

    const firstArg = args[0]!;

    // Handle string condition: Where("name = ?", name)
    if (firstArg.stringValue || firstArg.type === 'string') {
      const condition = this.unquoteString(firstArg.stringValue ?? firstArg.value);
      // Extract field names from condition
      const fieldMatches = condition.match(/\b([a-z_][a-z0-9_]*)\s*(?:=|!=|<|>|<=|>=|LIKE|IN|IS)/gi);
      if (fieldMatches) {
        for (const match of fieldMatches) {
          const field = match.replace(/\s*(?:=|!=|<|>|<=|>=|LIKE|IN|IS).*/i, '').trim();
          if (field && !['AND', 'OR', 'NOT'].includes(field.toUpperCase())) {
            fields.push(field);
          }
        }
      }
    }

    // Handle struct condition: Where(&User{Name: "john"})
    if (firstArg.type === 'object' && firstArg.properties) {
      fields.push(...Object.keys(firstArg.properties));
    }

    // Handle map condition: Where(map[string]interface{}{"name": "john"})
    if (firstArg.type === 'object' && firstArg.properties) {
      fields.push(...Object.keys(firstArg.properties));
    }

    return fields;
  }

  private inferTableFromReceiver(receiver: string): string | null {
    // Try to extract table name from receiver like userRepo, userDB, etc.
    const match = receiver.match(/^([a-z]+)(?:Repo|Repository|DB|Store|DAO)$/i);
    if (match) {
      return this.inferTableName(match[1]!);
    }
    return null;
  }

  private unquoteString(str: string): string {
    return str.replace(/^["'`]|["'`]$/g, '');
  }
}
