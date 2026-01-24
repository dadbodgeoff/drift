/**
 * Wrapper Detection Integration Tests
 *
 * Tests the full integration between call graph extraction and wrapper detection.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
  mapLanguage,
  buildDiscoveryContext,
  buildDetectionContext,
  filterExtractions,
  calculateExtractionStats,
} from '../integration/adapter.js';
import type { FileExtractionResult } from '../../call-graph/types.js';

// =============================================================================
// Test Data
// =============================================================================

const mockTypeScriptExtraction: FileExtractionResult = {
  file: 'src/hooks/useAuth.ts',
  language: 'typescript',
  functions: [
    {
      name: 'useAuth',
      qualifiedName: 'useAuth',
      startLine: 5,
      endLine: 25,
      startColumn: 0,
      endColumn: 1,
      parameters: [],
      returnType: 'AuthState',
      isMethod: false,
      isStatic: false,
      isExported: true,
      isConstructor: false,
      isAsync: false,
      decorators: [],
      bodyStartLine: 6,
      bodyEndLine: 24,
    },
    {
      name: 'useUser',
      qualifiedName: 'useUser',
      startLine: 30,
      endLine: 45,
      startColumn: 0,
      endColumn: 1,
      parameters: [{ name: 'userId', type: 'string', hasDefault: false, isRest: false }],
      returnType: 'User | null',
      isMethod: false,
      isStatic: false,
      isExported: true,
      isConstructor: false,
      isAsync: false,
      decorators: [],
      bodyStartLine: 31,
      bodyEndLine: 44,
    },
  ],
  calls: [
    {
      calleeName: 'useState',
      fullExpression: 'useState(null)',
      line: 7,
      column: 10,
      argumentCount: 1,
      isMethodCall: false,
      isConstructorCall: false,
    },
    {
      calleeName: 'useEffect',
      fullExpression: 'useEffect(() => {...})',
      line: 10,
      column: 2,
      argumentCount: 2,
      isMethodCall: false,
      isConstructorCall: false,
    },
    {
      calleeName: 'useState',
      fullExpression: 'useState(null)',
      line: 32,
      column: 10,
      argumentCount: 1,
      isMethodCall: false,
      isConstructorCall: false,
    },
    {
      calleeName: 'useQuery',
      fullExpression: 'useQuery([...])',
      line: 35,
      column: 10,
      argumentCount: 2,
      isMethodCall: false,
      isConstructorCall: false,
    },
  ],
  imports: [
    {
      source: 'react',
      names: [
        { imported: 'useState', local: 'useState', isDefault: false, isNamespace: false },
        { imported: 'useEffect', local: 'useEffect', isDefault: false, isNamespace: false },
      ],
      line: 1,
      isTypeOnly: false,
    },
    {
      source: '@tanstack/react-query',
      names: [
        { imported: 'useQuery', local: 'useQuery', isDefault: false, isNamespace: false },
      ],
      line: 2,
      isTypeOnly: false,
    },
  ],
  exports: [
    { name: 'useAuth', isDefault: false, isReExport: false, line: 5 },
    { name: 'useUser', isDefault: false, isReExport: false, line: 30 },
  ],
  classes: [],
  errors: [],
};

const mockPythonExtraction: FileExtractionResult = {
  file: 'src/services/user_service.py',
  language: 'python',
  functions: [
    {
      name: 'get_user',
      qualifiedName: 'UserService.get_user',
      startLine: 10,
      endLine: 20,
      startColumn: 4,
      endColumn: 0,
      parameters: [
        { name: 'self', hasDefault: false, isRest: false },
        { name: 'user_id', type: 'int', hasDefault: false, isRest: false },
      ],
      returnType: 'User',
      isMethod: true,
      isStatic: false,
      isExported: false,
      isConstructor: false,
      isAsync: true,
      className: 'UserService',
      decorators: ['@cache_result'],
      bodyStartLine: 11,
      bodyEndLine: 19,
    },
  ],
  calls: [
    {
      calleeName: 'execute',
      receiver: 'db',
      fullExpression: 'db.execute(...)',
      line: 15,
      column: 8,
      argumentCount: 2,
      isMethodCall: true,
      isConstructorCall: false,
    },
  ],
  imports: [
    {
      source: 'sqlalchemy',
      names: [
        { imported: 'select', local: 'select', isDefault: false, isNamespace: false },
      ],
      line: 1,
      isTypeOnly: false,
    },
  ],
  exports: [],
  classes: [
    {
      name: 'UserService',
      startLine: 5,
      endLine: 50,
      baseClasses: ['BaseService'],
      methods: ['get_user', 'create_user'],
      isExported: false,
    },
  ],
  errors: [],
};

const mockTestExtraction: FileExtractionResult = {
  file: 'src/hooks/__tests__/useAuth.test.ts',
  language: 'typescript',
  functions: [
    {
      name: 'testUseAuth',
      qualifiedName: 'testUseAuth',
      startLine: 5,
      endLine: 15,
      startColumn: 0,
      endColumn: 1,
      parameters: [],
      isMethod: false,
      isStatic: false,
      isExported: false,
      isConstructor: false,
      isAsync: false,
      decorators: [],
      bodyStartLine: 6,
      bodyEndLine: 14,
    },
  ],
  calls: [
    {
      calleeName: 'describe',
      fullExpression: 'describe(...)',
      line: 5,
      column: 0,
      argumentCount: 2,
      isMethodCall: false,
      isConstructorCall: false,
    },
    {
      calleeName: 'it',
      fullExpression: 'it(...)',
      line: 6,
      column: 2,
      argumentCount: 2,
      isMethodCall: false,
      isConstructorCall: false,
    },
    {
      calleeName: 'expect',
      fullExpression: 'expect(...)',
      line: 8,
      column: 4,
      argumentCount: 1,
      isMethodCall: false,
      isConstructorCall: false,
    },
  ],
  imports: [
    {
      source: 'vitest',
      names: [
        { imported: 'describe', local: 'describe', isDefault: false, isNamespace: false },
        { imported: 'it', local: 'it', isDefault: false, isNamespace: false },
        { imported: 'expect', local: 'expect', isDefault: false, isNamespace: false },
      ],
      line: 1,
      isTypeOnly: false,
    },
  ],
  exports: [],
  classes: [],
  errors: [],
};

// =============================================================================
// Tests
// =============================================================================

describe('Wrapper Integration - Language Mapping', () => {
  it('should map typescript correctly', () => {
    expect(mapLanguage('typescript')).toBe('typescript');
  });

  it('should map javascript to typescript', () => {
    expect(mapLanguage('javascript')).toBe('typescript');
  });

  it('should map python correctly', () => {
    expect(mapLanguage('python')).toBe('python');
  });

  it('should map java correctly', () => {
    expect(mapLanguage('java')).toBe('java');
  });

  it('should map csharp correctly', () => {
    expect(mapLanguage('csharp')).toBe('csharp');
  });

  it('should map php correctly', () => {
    expect(mapLanguage('php')).toBe('php');
  });
});

describe('Wrapper Integration - Discovery Context', () => {
  it('should build discovery context from extractions', () => {
    const context = buildDiscoveryContext([mockTypeScriptExtraction], 'typescript');

    expect(context.language).toBe('typescript');
    expect(context.imports).toHaveLength(2);
    expect(context.imports[0].source).toBe('react');
    expect(context.imports[0].names).toContainEqual(
      expect.objectContaining({ imported: 'useState' })
    );
  });

  it('should collect decorators from functions', () => {
    const context = buildDiscoveryContext([mockPythonExtraction], 'python');

    expect(context.decorators).toHaveLength(1);
    expect(context.decorators[0].name).toBe('@cache_result');
    expect(context.decorators[0].file).toBe('src/services/user_service.py');
  });

  it('should collect function usages', () => {
    const context = buildDiscoveryContext([mockTypeScriptExtraction], 'typescript');

    expect(context.functionUsages.length).toBeGreaterThan(0);
    expect(context.functionUsages).toContainEqual(
      expect.objectContaining({ name: 'useState' })
    );
  });

  it('should merge multiple extractions', () => {
    const context = buildDiscoveryContext(
      [mockTypeScriptExtraction, mockPythonExtraction],
      'typescript'
    );

    // Should have imports from both files
    expect(context.imports.length).toBeGreaterThan(2);
  });
});

describe('Wrapper Integration - Detection Context', () => {
  it('should build detection context from extractions', () => {
    const context = buildDetectionContext([mockTypeScriptExtraction], [], 'typescript');

    expect(context.language).toBe('typescript');
    expect(context.functions).toHaveLength(2);
    expect(context.functions[0].name).toBe('useAuth');
    expect(context.functions[0].qualifiedName).toBe('useAuth');
  });

  it('should convert function parameters', () => {
    const context = buildDetectionContext([mockTypeScriptExtraction], [], 'typescript');

    const useUser = context.functions.find((f) => f.name === 'useUser');
    expect(useUser).toBeDefined();
    expect(useUser!.parameters).toHaveLength(1);
    expect(useUser!.parameters![0].name).toBe('userId');
    expect(useUser!.parameters![0].type).toBe('string');
  });

  it('should convert function calls', () => {
    const context = buildDetectionContext([mockTypeScriptExtraction], [], 'typescript');

    const useAuth = context.functions.find((f) => f.name === 'useAuth');
    expect(useAuth).toBeDefined();
    expect(useAuth!.calls.length).toBeGreaterThan(0);
    expect(useAuth!.calls).toContainEqual(
      expect.objectContaining({ calleeName: 'useState' })
    );
  });

  it('should filter calls by function line range', () => {
    const context = buildDetectionContext([mockTypeScriptExtraction], [], 'typescript');

    // useAuth is lines 5-25, should have useState and useEffect
    const useAuth = context.functions.find((f) => f.name === 'useAuth');
    expect(useAuth!.calls).toContainEqual(
      expect.objectContaining({ calleeName: 'useState', line: 7 })
    );
    expect(useAuth!.calls).toContainEqual(
      expect.objectContaining({ calleeName: 'useEffect', line: 10 })
    );

    // useUser is lines 30-45, should have useState and useQuery
    const useUser = context.functions.find((f) => f.name === 'useUser');
    expect(useUser!.calls).toContainEqual(
      expect.objectContaining({ calleeName: 'useState', line: 32 })
    );
    expect(useUser!.calls).toContainEqual(
      expect.objectContaining({ calleeName: 'useQuery', line: 35 })
    );
  });

  it('should preserve async flag', () => {
    const context = buildDetectionContext([mockPythonExtraction], [], 'python');

    const getUser = context.functions.find((f) => f.name === 'get_user');
    expect(getUser).toBeDefined();
    expect(getUser!.isAsync).toBe(true);
  });

  it('should preserve decorators', () => {
    const context = buildDetectionContext([mockPythonExtraction], [], 'python');

    const getUser = context.functions.find((f) => f.name === 'get_user');
    expect(getUser).toBeDefined();
    expect(getUser!.decorators).toContain('@cache_result');
  });
});

describe('Wrapper Integration - Filtering', () => {
  it('should filter out test files when requested', () => {
    const extractions = [mockTypeScriptExtraction, mockTestExtraction];
    const filtered = filterExtractions(extractions, { includeTestFiles: false });

    expect(filtered).toHaveLength(1);
    expect(filtered[0].file).toBe('src/hooks/useAuth.ts');
  });

  it('should include test files when requested', () => {
    const extractions = [mockTypeScriptExtraction, mockTestExtraction];
    const filtered = filterExtractions(extractions, { includeTestFiles: true });

    expect(filtered).toHaveLength(2);
  });

  it('should filter by file patterns', () => {
    const extractions = [mockTypeScriptExtraction, mockPythonExtraction];
    const filtered = filterExtractions(extractions, {
      filePatterns: ['src/hooks/*.ts'],
    });

    expect(filtered).toHaveLength(1);
    expect(filtered[0].file).toBe('src/hooks/useAuth.ts');
  });
});

describe('Wrapper Integration - Statistics', () => {
  it('should calculate extraction statistics', () => {
    const extractions = [mockTypeScriptExtraction, mockPythonExtraction];
    const stats = calculateExtractionStats(extractions);

    expect(stats.totalFiles).toBe(2);
    expect(stats.totalFunctions).toBe(3); // 2 from TS + 1 from Python
    expect(stats.totalCalls).toBe(5); // 4 from TS + 1 from Python
    expect(stats.totalImports).toBe(3); // 2 from TS + 1 from Python
    expect(stats.byLanguage['typescript']).toBe(1);
    expect(stats.byLanguage['python']).toBe(1);
  });

  it('should handle empty extractions', () => {
    const stats = calculateExtractionStats([]);

    expect(stats.totalFiles).toBe(0);
    expect(stats.totalFunctions).toBe(0);
    expect(stats.totalCalls).toBe(0);
    expect(stats.totalImports).toBe(0);
  });
});
