/**
 * Constants Analysis Module Tests
 */

import { describe, it, expect } from 'vitest';
import { ConstantReferenceFinder } from '../analysis/reference-finder.js';
import { MagicValueDetector } from '../analysis/magic-detector.js';
import { DeadConstantDetector } from '../analysis/dead-constant-detector.js';
import { ConsistencyAnalyzer } from '../analysis/consistency-analyzer.js';
import { ConstantSecurityScanner } from '../analysis/security-scanner.js';
import type { ConstantExtraction, EnumExtraction, ConstantReference } from '../types.js';

describe('ConstantReferenceFinder', () => {
  const finder = new ConstantReferenceFinder();

  const mockConstant: ConstantExtraction = {
    id: 'config.ts:MAX_RETRIES:5',
    name: 'MAX_RETRIES',
    qualifiedName: 'MAX_RETRIES',
    file: 'config.ts',
    line: 5,
    column: 1,
    endLine: 5,
    language: 'typescript',
    kind: 'primitive',
    category: 'limit',
    value: 3,
    isExported: true,
    decorators: [],
    modifiers: ['const'],
    confidence: 0.9,
  };

  it('should find references in files', () => {
    const files = new Map<string, string>([
      ['config.ts', 'export const MAX_RETRIES = 3;'],
      ['service.ts', `
import { MAX_RETRIES } from './config';

function retry() {
  for (let i = 0; i < MAX_RETRIES; i++) {
    // do something
  }
}
`],
      ['utils.ts', `
const retries = MAX_RETRIES;
if (count > MAX_RETRIES) {
  throw new Error('Too many retries');
}
`],
    ]);

    const result = finder.findReferences(mockConstant, files);

    expect(result.totalCount).toBeGreaterThan(0);
    expect(result.filesWithReferences.length).toBeGreaterThan(0);
  });

  it('should exclude definition file same line', () => {
    const files = new Map<string, string>([
      ['config.ts', 'export const MAX_RETRIES = 3;'],
    ]);

    const result = finder.findReferences(mockConstant, files);

    // Should not include the definition itself
    expect(result.references.filter(r => r.file === 'config.ts' && r.line === 5)).toHaveLength(0);
  });

  it('should detect reference types', () => {
    const files = new Map<string, string>([
      ['test.ts', `
const x = MAX_RETRIES;
if (count === MAX_RETRIES) {}
doSomething(MAX_RETRIES);
`],
    ]);

    const result = finder.findReferences(mockConstant, files);

    // Should find references
    expect(result.totalCount).toBeGreaterThan(0);
  });

  it('should handle enum references', () => {
    const mockEnum: EnumExtraction = {
      id: 'types.ts:Status:10',
      name: 'Status',
      qualifiedName: 'Status',
      file: 'types.ts',
      line: 10,
      endLine: 14,
      language: 'typescript',
      isExported: true,
      members: [
        { name: 'PENDING', value: 0, line: 11, isAutoValue: true },
        { name: 'ACTIVE', value: 1, line: 12, isAutoValue: true },
      ],
      isFlags: false,
      isStringEnum: false,
      decorators: [],
      modifiers: [],
      confidence: 0.9,
    };

    const files = new Map<string, string>([
      ['service.ts', `
if (status === Status.PENDING) {
  return Status.ACTIVE;
}
`],
    ]);

    const result = finder.findReferences(mockEnum, files);

    expect(result.totalCount).toBeGreaterThan(0);
  });
});

describe('MagicValueDetector', () => {
  const detector = new MagicValueDetector();

  it('should detect repeated string literals', () => {
    const files = new Map<string, string>([
      ['file1.ts', 'fetch("repeated-value-here");'],
      ['file2.ts', 'axios.get("repeated-value-here");'],
      ['file3.ts', 'request("repeated-value-here");'],
    ]);

    const result = detector.detect(files);

    // Should detect the repeated string
    expect(result.magicValues.some(mv => 
      typeof mv.value === 'string' && mv.value === 'repeated-value-here'
    )).toBe(true);
  });

  it('should detect repeated numeric literals', () => {
    const files = new Map<string, string>([
      ['file1.ts', 'setTimeout(() => {}, 30000);'],
      ['file2.ts', 'setTimeout(() => {}, 30000);'],
      ['file3.ts', 'setTimeout(() => {}, 30000);'],
    ]);

    const result = detector.detect(files);

    expect(result.magicValues.some(mv => mv.value === 30000)).toBe(true);
  });

  it('should ignore common values', () => {
    const files = new Map<string, string>([
      ['file1.ts', `
const a = 0;
const b = 1;
const c = -1;
const d = "";
`],
      ['file2.ts', `
const x = 0;
const y = 1;
`],
    ]);

    const result = detector.detect(files);

    // Common values like 0, 1, -1 should be ignored
    expect(result.magicValues.some(mv => mv.value === 0)).toBe(false);
    expect(result.magicValues.some(mv => mv.value === 1)).toBe(false);
  });

  it('should skip constant definitions', () => {
    const files = new Map<string, string>([
      ['config.ts', `
export const API_URL = "https://api.example.com";
export const MAX_SIZE = 1000;
`],
    ]);

    const result = detector.detect(files);

    // Constant definitions should not be flagged as magic values
    expect(result.magicValues).toHaveLength(0);
  });

  it('should suggest constant names', () => {
    const files = new Map<string, string>([
      ['file1.ts', 'setTimeout(() => {}, 3600);'],
      ['file2.ts', 'setTimeout(() => {}, 3600);'],
      ['file3.ts', 'setTimeout(() => {}, 3600);'],
    ]);

    const result = detector.detect(files);

    const magicValue = result.magicValues.find(mv => mv.value === 3600);
    // Should have a suggested name
    expect(magicValue?.suggestedName).toBeDefined();
  });
});

describe('DeadConstantDetector', () => {
  const detector = new DeadConstantDetector();

  it('should detect unused constants', () => {
    const constants: ConstantExtraction[] = [
      {
        id: 'config.ts:UNUSED_CONST:5',
        name: 'UNUSED_CONST',
        qualifiedName: 'UNUSED_CONST',
        file: 'config.ts',
        line: 5,
        column: 1,
        endLine: 5,
        language: 'typescript',
        kind: 'primitive',
        category: 'uncategorized',
        value: 'unused',
        isExported: false,
        decorators: [],
        modifiers: [],
        confidence: 0.9,
      },
    ];

    const references = new Map<string, ConstantReference[]>();

    const result = detector.detect(constants, [], references);

    expect(result.deadConstants).toHaveLength(1);
    expect(result.deadConstants[0].reason).toBe('no_references');
  });

  it('should detect constants with only test references', () => {
    const constants: ConstantExtraction[] = [
      {
        id: 'config.ts:TEST_ONLY:5',
        name: 'TEST_ONLY',
        qualifiedName: 'TEST_ONLY',
        file: 'config.ts',
        line: 5,
        column: 1,
        endLine: 5,
        language: 'typescript',
        kind: 'primitive',
        category: 'uncategorized',
        value: 'test',
        isExported: false,
        decorators: [],
        modifiers: [],
        confidence: 0.9,
      },
    ];

    const references = new Map<string, ConstantReference[]>([
      ['config.ts:TEST_ONLY:5', [
        {
          constantId: 'config.ts:TEST_ONLY:5',
          constantName: 'TEST_ONLY',
          file: 'config.test.ts',
          line: 10,
          column: 5,
          referenceType: 'read',
        },
      ]],
    ]);

    const result = detector.detect(constants, [], references);

    expect(result.deadConstants).toHaveLength(1);
    expect(result.deadConstants[0].reason).toBe('only_test_references');
  });

  it('should detect deprecated constants', () => {
    const constants: ConstantExtraction[] = [
      {
        id: 'config.ts:OLD_CONST:5',
        name: 'OLD_CONST',
        qualifiedName: 'OLD_CONST',
        file: 'config.ts',
        line: 5,
        column: 1,
        endLine: 5,
        language: 'typescript',
        kind: 'primitive',
        category: 'uncategorized',
        value: 'old',
        isExported: true,
        decorators: ['@deprecated'],
        modifiers: [],
        confidence: 0.9,
      },
    ];

    const references = new Map<string, ConstantReference[]>();

    const result = detector.detect(constants, [], references);

    expect(result.deadConstants.some(dc => dc.reason === 'deprecated_annotation')).toBe(true);
  });

  it('should not flag used constants', () => {
    const constants: ConstantExtraction[] = [
      {
        id: 'config.ts:USED_CONST:5',
        name: 'USED_CONST',
        qualifiedName: 'USED_CONST',
        file: 'config.ts',
        line: 5,
        column: 1,
        endLine: 5,
        language: 'typescript',
        kind: 'primitive',
        category: 'uncategorized',
        value: 'used',
        isExported: true,
        decorators: [],
        modifiers: [],
        confidence: 0.9,
      },
    ];

    const references = new Map<string, ConstantReference[]>([
      ['config.ts:USED_CONST:5', [
        {
          constantId: 'config.ts:USED_CONST:5',
          constantName: 'USED_CONST',
          file: 'service.ts',
          line: 10,
          column: 5,
          referenceType: 'read',
        },
      ]],
    ]);

    const result = detector.detect(constants, [], references);

    expect(result.deadConstants).toHaveLength(0);
  });
});

describe('ConsistencyAnalyzer', () => {
  const analyzer = new ConsistencyAnalyzer();

  it('should detect inconsistent values', () => {
    const constants: ConstantExtraction[] = [
      {
        id: 'config1.ts:MAX_SIZE:5',
        name: 'MAX_SIZE',
        qualifiedName: 'MAX_SIZE',
        file: 'config1.ts',
        line: 5,
        column: 1,
        endLine: 5,
        language: 'typescript',
        kind: 'primitive',
        category: 'limit',
        value: 100,
        isExported: true,
        decorators: [],
        modifiers: [],
        confidence: 0.9,
      },
      {
        id: 'config2.ts:MAX_SIZE:10',
        name: 'MAX_SIZE',
        qualifiedName: 'MAX_SIZE',
        file: 'config2.ts',
        line: 10,
        column: 1,
        endLine: 10,
        language: 'typescript',
        kind: 'primitive',
        category: 'limit',
        value: 200, // Different value!
        isExported: true,
        decorators: [],
        modifiers: [],
        confidence: 0.9,
      },
    ];

    const result = analyzer.analyze(constants);

    expect(result.inconsistencies).toHaveLength(1);
    expect(result.inconsistencies[0].name).toBe('MAX_SIZE');
    expect(result.inconsistencies[0].instances).toHaveLength(2);
  });

  it('should not flag consistent values', () => {
    const constants: ConstantExtraction[] = [
      {
        id: 'config1.ts:MAX_SIZE:5',
        name: 'MAX_SIZE',
        qualifiedName: 'MAX_SIZE',
        file: 'config1.ts',
        line: 5,
        column: 1,
        endLine: 5,
        language: 'typescript',
        kind: 'primitive',
        category: 'limit',
        value: 100,
        isExported: true,
        decorators: [],
        modifiers: [],
        confidence: 0.9,
      },
      {
        id: 'config2.ts:MAX_SIZE:10',
        name: 'MAX_SIZE',
        qualifiedName: 'MAX_SIZE',
        file: 'config2.ts',
        line: 10,
        column: 1,
        endLine: 10,
        language: 'typescript',
        kind: 'primitive',
        category: 'limit',
        value: 100, // Same value
        isExported: true,
        decorators: [],
        modifiers: [],
        confidence: 0.9,
      },
    ];

    const result = analyzer.analyze(constants);

    expect(result.inconsistencies).toHaveLength(0);
  });

  it('should generate recommendations', () => {
    const constants: ConstantExtraction[] = [
      {
        id: 'a.ts:TIMEOUT:1',
        name: 'TIMEOUT',
        qualifiedName: 'TIMEOUT',
        file: 'a.ts',
        line: 1,
        column: 1,
        endLine: 1,
        language: 'typescript',
        kind: 'primitive',
        category: 'limit',
        value: 30,
        isExported: true,
        decorators: [],
        modifiers: [],
        confidence: 0.9,
      },
      {
        id: 'b.ts:TIMEOUT:1',
        name: 'TIMEOUT',
        qualifiedName: 'TIMEOUT',
        file: 'b.ts',
        line: 1,
        column: 1,
        endLine: 1,
        language: 'typescript',
        kind: 'primitive',
        category: 'limit',
        value: 60,
        isExported: true,
        decorators: [],
        modifiers: [],
        confidence: 0.9,
      },
    ];

    const result = analyzer.analyze(constants);

    // Should have a recommendation
    expect(result.inconsistencies[0].recommendation).toBeDefined();
    expect(result.inconsistencies[0].recommendation.length).toBeGreaterThan(0);
  });
});

describe('ConstantSecurityScanner', () => {
  const scanner = new ConstantSecurityScanner();

  it('should detect AWS keys', () => {
    const constants: ConstantExtraction[] = [
      {
        id: 'config.ts:AWS_KEY:5',
        name: 'AWS_ACCESS_KEY',
        qualifiedName: 'AWS_ACCESS_KEY',
        file: 'config.ts',
        line: 5,
        column: 1,
        endLine: 5,
        language: 'typescript',
        kind: 'primitive',
        category: 'api',
        value: 'AKIAIOSFODNN7EXAMPLE',
        isExported: true,
        decorators: [],
        modifiers: [],
        confidence: 0.9,
      },
    ];

    const result = scanner.scan(constants);

    expect(result.secrets).toHaveLength(1);
    expect(result.secrets[0].secretType).toBe('aws_key');
    expect(result.secrets[0].severity).toBe('critical');
  });

  it('should detect password constants', () => {
    const constants: ConstantExtraction[] = [
      {
        id: 'config.ts:DB_PASSWORD:5',
        name: 'DB_PASSWORD',
        qualifiedName: 'DB_PASSWORD',
        file: 'config.ts',
        line: 5,
        column: 1,
        endLine: 5,
        language: 'typescript',
        kind: 'primitive',
        category: 'config',
        value: 'supersecretpassword123',
        isExported: true,
        decorators: [],
        modifiers: [],
        confidence: 0.9,
      },
    ];

    const result = scanner.scan(constants);

    expect(result.secrets).toHaveLength(1);
    expect(result.secrets[0].secretType).toBe('password');
  });

  it('should detect Stripe keys', () => {
    const constants: ConstantExtraction[] = [
      {
        id: 'config.ts:STRIPE_KEY:5',
        name: 'STRIPE_SECRET_KEY',
        qualifiedName: 'STRIPE_SECRET_KEY',
        file: 'config.ts',
        line: 5,
        column: 1,
        endLine: 5,
        language: 'typescript',
        kind: 'primitive',
        category: 'api',
        value: 'sk_test_FAKEKEYFORTESTINGONLY1234',
        isExported: true,
        decorators: [],
        modifiers: [],
        confidence: 0.9,
      },
    ];

    const result = scanner.scan(constants);

    expect(result.secrets).toHaveLength(1);
    expect(result.secrets[0].secretType).toBe('stripe_key');
  });

  it('should mask secret values', () => {
    const constants: ConstantExtraction[] = [
      {
        id: 'config.ts:SECRET:5',
        name: 'API_SECRET',
        qualifiedName: 'API_SECRET',
        file: 'config.ts',
        line: 5,
        column: 1,
        endLine: 5,
        language: 'typescript',
        kind: 'primitive',
        category: 'api',
        value: 'verysecretvalue12345678901234567890',
        isExported: true,
        decorators: [],
        modifiers: [],
        confidence: 0.9,
      },
    ];

    const result = scanner.scan(constants);

    // Should detect and mask the secret
    if (result.secrets.length > 0) {
      expect(result.secrets[0].maskedValue).not.toBe('verysecretvalue12345678901234567890');
      expect(result.secrets[0].maskedValue).toContain('*');
    }
  });

  it('should skip test files', () => {
    const constants: ConstantExtraction[] = [
      {
        id: 'config.test.ts:TEST_PASSWORD:5',
        name: 'TEST_PASSWORD',
        qualifiedName: 'TEST_PASSWORD',
        file: 'config.test.ts',
        line: 5,
        column: 1,
        endLine: 5,
        language: 'typescript',
        kind: 'primitive',
        category: 'config',
        value: 'testpassword123',
        isExported: true,
        decorators: [],
        modifiers: [],
        confidence: 0.9,
      },
    ];

    const result = scanner.scan(constants);

    // Test files should be allowlisted
    expect(result.secrets).toHaveLength(0);
  });

  it('should skip placeholder values', () => {
    const constants: ConstantExtraction[] = [
      {
        id: 'config.ts:API_KEY:5',
        name: 'API_KEY',
        qualifiedName: 'API_KEY',
        file: 'config.ts',
        line: 5,
        column: 1,
        endLine: 5,
        language: 'typescript',
        kind: 'primitive',
        category: 'api',
        value: 'your_api_key_here',
        isExported: true,
        decorators: [],
        modifiers: [],
        confidence: 0.9,
      },
    ];

    const result = scanner.scan(constants);

    // Placeholder values should have low confidence or be skipped
    expect(result.secrets.length === 0 || result.secrets[0].confidence < 0.5).toBe(true);
  });

  it('should generate recommendations', () => {
    const constants: ConstantExtraction[] = [
      {
        id: 'config.ts:SECRET:5',
        name: 'SECRET_KEY',
        qualifiedName: 'SECRET_KEY',
        file: 'config.ts',
        line: 5,
        column: 1,
        endLine: 5,
        language: 'typescript',
        kind: 'primitive',
        category: 'api',
        value: 'realsecretvalue12345678',
        isExported: true,
        decorators: [],
        modifiers: [],
        confidence: 0.9,
      },
    ];

    const result = scanner.scan(constants);

    expect(result.secrets[0].recommendation).toContain('environment variables');
  });
});
