/**
 * Integration Tests
 *
 * Tests for the integration adapters that bridge the UnifiedLanguageProvider
 * with existing systems.
 */

import { describe, it, expect } from 'vitest';
import {
  toDataAccessPoint,
  toFunctionExtraction,
  toClassExtraction,
  toImportExtraction,
  toExportExtraction,
  toFileExtractionResult,
} from '../integration/unified-data-access-adapter.js';
import type { UnifiedDataAccess, UnifiedFunction, UnifiedClass, UnifiedImport, UnifiedExport, UnifiedExtractionResult } from '../types.js';

describe('Integration Adapters', () => {
  describe('toDataAccessPoint', () => {
    it('should convert UnifiedDataAccess to DataAccessPoint', () => {
      const access: UnifiedDataAccess = {
        id: 'test.ts:10:5:users',
        table: 'users',
        fields: ['id', 'name', 'email'],
        operation: 'read',
        file: 'test.ts',
        line: 10,
        column: 5,
        context: 'prisma.user.findMany()',
        isRawSql: false,
        confidence: 0.95,
        orm: 'prisma',
        language: 'typescript',
      };

      const result = toDataAccessPoint(access);

      expect(result.id).toBe('test.ts:10:5:users');
      expect(result.table).toBe('users');
      expect(result.fields).toEqual(['id', 'name', 'email']);
      expect(result.operation).toBe('read');
      expect(result.file).toBe('test.ts');
      expect(result.line).toBe(10);
      expect(result.column).toBe(5);
      expect(result.context).toBe('prisma.user.findMany()');
      expect(result.isRawSql).toBe(false);
      expect(result.confidence).toBe(0.95);
    });
  });

  describe('toFunctionExtraction', () => {
    it('should convert UnifiedFunction to FunctionExtraction', () => {
      const func: UnifiedFunction = {
        name: 'getUser',
        qualifiedName: 'UserService.getUser',
        file: 'user-service.ts',
        startLine: 10,
        endLine: 20,
        startColumn: 2,
        endColumn: 3,
        parameters: [
          { name: 'id', type: 'string', hasDefault: false, isRest: false },
        ],
        returnType: 'Promise<User>',
        isMethod: true,
        isStatic: false,
        isExported: true,
        isConstructor: false,
        isAsync: true,
        className: 'UserService',
        decorators: ['@Get'],
        bodyStartLine: 11,
        bodyEndLine: 19,
        language: 'typescript',
      };

      const result = toFunctionExtraction(func);

      expect(result.name).toBe('getUser');
      expect(result.qualifiedName).toBe('UserService.getUser');
      expect(result.startLine).toBe(10);
      expect(result.endLine).toBe(20);
      expect(result.parameters).toHaveLength(1);
      expect(result.parameters[0].name).toBe('id');
      expect(result.returnType).toBe('Promise<User>');
      expect(result.isMethod).toBe(true);
      expect(result.isAsync).toBe(true);
      expect(result.className).toBe('UserService');
      expect(result.decorators).toContain('@Get');
    });
  });

  describe('toClassExtraction', () => {
    it('should convert UnifiedClass to ClassExtraction', () => {
      const cls: UnifiedClass = {
        name: 'UserService',
        file: 'user-service.ts',
        startLine: 5,
        endLine: 50,
        baseClasses: ['BaseService'],
        methods: ['getUser', 'createUser', 'deleteUser'],
        isExported: true,
        language: 'typescript',
      };

      const result = toClassExtraction(cls);

      expect(result.name).toBe('UserService');
      expect(result.startLine).toBe(5);
      expect(result.endLine).toBe(50);
      expect(result.baseClasses).toContain('BaseService');
      expect(result.methods).toHaveLength(3);
      expect(result.isExported).toBe(true);
    });
  });

  describe('toImportExtraction', () => {
    it('should convert UnifiedImport to ImportExtraction', () => {
      const imp: UnifiedImport = {
        source: '@prisma/client',
        names: [
          { imported: 'PrismaClient', local: 'PrismaClient', isDefault: false, isNamespace: false },
          { imported: 'User', local: 'User', isDefault: false, isNamespace: false },
        ],
        line: 1,
        isTypeOnly: false,
        language: 'typescript',
      };

      const result = toImportExtraction(imp);

      expect(result.source).toBe('@prisma/client');
      expect(result.names).toHaveLength(2);
      expect(result.names[0].imported).toBe('PrismaClient');
      expect(result.line).toBe(1);
      expect(result.isTypeOnly).toBe(false);
    });
  });

  describe('toExportExtraction', () => {
    it('should convert UnifiedExport to ExportExtraction', () => {
      const exp: UnifiedExport = {
        name: 'UserService',
        isDefault: true,
        isReExport: false,
        line: 50,
        language: 'typescript',
      };

      const result = toExportExtraction(exp);

      expect(result.name).toBe('UserService');
      expect(result.isDefault).toBe(true);
      expect(result.isReExport).toBe(false);
      expect(result.line).toBe(50);
    });
  });

  describe('toFileExtractionResult', () => {
    it('should convert UnifiedExtractionResult to FileExtractionResult', () => {
      const unified: UnifiedExtractionResult = {
        file: 'test.ts',
        language: 'typescript',
        functions: [
          {
            name: 'getUser',
            qualifiedName: 'getUser',
            file: 'test.ts',
            startLine: 5,
            endLine: 10,
            startColumn: 0,
            endColumn: 1,
            parameters: [],
            isMethod: false,
            isStatic: false,
            isExported: true,
            isConstructor: false,
            isAsync: false,
            decorators: [],
            bodyStartLine: 5,
            bodyEndLine: 10,
            language: 'typescript',
          },
        ],
        callChains: [
          {
            receiver: 'prisma',
            segments: [
              { name: 'user', isCall: false, args: [], line: 6, column: 10 },
              { name: 'findMany', isCall: true, args: [], line: 6, column: 15 },
            ],
            fullExpression: 'prisma.user.findMany()',
            file: 'test.ts',
            line: 6,
            column: 0,
            endLine: 6,
            endColumn: 25,
            language: 'typescript',
          },
        ],
        dataAccess: [],
        classes: [],
        imports: [],
        exports: [],
        errors: [],
        stats: {
          parseTimeMs: 10,
          normalizeTimeMs: 5,
          matchTimeMs: 2,
          totalTimeMs: 17,
          nodesVisited: 100,
          callChainsExtracted: 1,
          patternsMatched: 0,
        },
      };

      const result = toFileExtractionResult(unified);

      expect(result.file).toBe('test.ts');
      expect(result.language).toBe('typescript');
      expect(result.functions).toHaveLength(1);
      expect(result.functions[0].name).toBe('getUser');
      expect(result.calls).toHaveLength(1);
      expect(result.calls[0].calleeName).toBe('findMany');
      expect(result.calls[0].receiver).toBe('user');
      expect(result.errors).toHaveLength(0);
    });

    it('should extract calls from call chains correctly', () => {
      const unified: UnifiedExtractionResult = {
        file: 'test.ts',
        language: 'typescript',
        functions: [],
        callChains: [
          {
            receiver: 'supabase',
            segments: [
              { name: 'from', isCall: true, args: [], line: 1, column: 10 },
              { name: 'select', isCall: true, args: [], line: 1, column: 20 },
              { name: 'eq', isCall: true, args: [], line: 1, column: 30 },
            ],
            fullExpression: "supabase.from('users').select('*').eq('id', 1)",
            file: 'test.ts',
            line: 1,
            column: 0,
            endLine: 1,
            endColumn: 50,
            language: 'typescript',
          },
        ],
        dataAccess: [],
        classes: [],
        imports: [],
        exports: [],
        errors: [],
        stats: {
          parseTimeMs: 0,
          normalizeTimeMs: 0,
          matchTimeMs: 0,
          totalTimeMs: 0,
          nodesVisited: 0,
          callChainsExtracted: 0,
          patternsMatched: 0,
        },
      };

      const result = toFileExtractionResult(unified);

      expect(result.calls).toHaveLength(3);
      
      // First call: from() - receiver is 'supabase'
      expect(result.calls[0].calleeName).toBe('from');
      expect(result.calls[0].receiver).toBe('supabase');
      expect(result.calls[0].isMethodCall).toBe(true);
      
      // Second call: select() - receiver is 'from'
      expect(result.calls[1].calleeName).toBe('select');
      expect(result.calls[1].receiver).toBe('from');
      
      // Third call: eq() - receiver is 'select'
      expect(result.calls[2].calleeName).toBe('eq');
      expect(result.calls[2].receiver).toBe('select');
    });
  });
});
