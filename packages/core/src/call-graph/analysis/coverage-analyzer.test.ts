/**
 * Tests for CoverageAnalyzer
 * 
 * Tests the sensitive data test coverage analysis functionality.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { CoverageAnalyzer, createCoverageAnalyzer } from './coverage-analyzer.js';
import type { CallGraph, FunctionNode, CallSite, CallGraphLanguage } from '../types.js';
import type { DataAccessPoint, DataOperation } from '../../boundaries/types.js';

describe('CoverageAnalyzer', () => {
  // Counter for unique IDs
  let idCounter = 0;

  // Helper to create a complete CallSite
  function createCallSite(
    callerId: string,
    calleeId: string | null,
    calleeName: string,
    file: string,
    line: number,
    options: Partial<CallSite> = {}
  ): CallSite {
    return {
      callerId,
      calleeId,
      calleeName,
      file,
      line,
      column: options.column ?? 1,
      resolved: options.resolved ?? (calleeId !== null),
      resolvedCandidates: options.resolvedCandidates ?? (calleeId ? [calleeId] : []),
      confidence: options.confidence ?? 1.0,
      argumentCount: options.argumentCount ?? 0,
      ...options,
    };
  }

  // Helper to create a complete DataAccessPoint
  function createDataAccess(
    table: string,
    fields: string[],
    file: string,
    line: number,
    options: Partial<DataAccessPoint> = {}
  ): DataAccessPoint {
    return {
      id: options.id ?? `access-${++idCounter}`,
      table,
      fields,
      operation: options.operation ?? 'read' as DataOperation,
      file,
      line,
      column: options.column ?? 1,
      context: options.context ?? `SELECT ${fields.join(', ')} FROM ${table}`,
      isRawSql: options.isRawSql ?? false,
      confidence: options.confidence ?? 1.0,
    };
  }

  // Helper to create a minimal function node
  function createFunction(
    id: string,
    name: string,
    file: string,
    options: Partial<FunctionNode> = {}
  ): FunctionNode {
    return {
      id,
      name,
      qualifiedName: options.qualifiedName ?? name,
      file,
      startLine: options.startLine ?? 1,
      endLine: options.endLine ?? 10,
      language: options.language ?? 'python',
      isExported: options.isExported ?? false,
      isConstructor: options.isConstructor ?? false,
      isAsync: options.isAsync ?? false,
      decorators: options.decorators ?? [],
      parameters: options.parameters ?? [],
      calls: options.calls ?? [],
      calledBy: options.calledBy ?? [],
      dataAccess: options.dataAccess ?? [],
      ...options,
    };
  }

  // Helper to create a minimal call graph
  function createGraph(functions: FunctionNode[], entryPoints: string[] = []): CallGraph {
    const funcMap = new Map<string, FunctionNode>();
    for (const f of functions) {
      funcMap.set(f.id, f);
    }

    const defaultByLanguage: Record<CallGraphLanguage, number> = {
      python: 0,
      typescript: 0,
      javascript: 0,
      java: 0,
      csharp: 0,
      php: 0,
    };

    // Count by language
    for (const f of functions) {
      defaultByLanguage[f.language]++;
    }

    return {
      version: '1.0',
      generatedAt: new Date().toISOString(),
      projectRoot: '/test',
      functions: funcMap,
      entryPoints,
      dataAccessors: functions.filter(f => f.dataAccess.length > 0).map(f => f.id),
      stats: {
        totalFunctions: functions.length,
        totalCallSites: 0,
        resolvedCallSites: 0,
        unresolvedCallSites: 0,
        totalDataAccessors: functions.filter(f => f.dataAccess.length > 0).length,
        byLanguage: defaultByLanguage,
      },
    };
  }

  // Reset counter before each test
  beforeEach(() => {
    idCounter = 0;
  });

  describe('basic functionality', () => {
    it('should create analyzer with factory function', () => {
      const graph = createGraph([]);
      const analyzer = createCoverageAnalyzer(graph);
      expect(analyzer).toBeInstanceOf(CoverageAnalyzer);
    });

    it('should return empty results for empty graph', () => {
      const graph = createGraph([]);
      const analyzer = new CoverageAnalyzer(graph);
      const result = analyzer.analyze();

      expect(result.summary.totalSensitiveFields).toBe(0);
      expect(result.summary.totalAccessPaths).toBe(0);
      expect(result.summary.testedAccessPaths).toBe(0);
      expect(result.summary.coveragePercent).toBe(0);
      expect(result.fields).toHaveLength(0);
      expect(result.uncoveredPaths).toHaveLength(0);
    });
  });

  describe('test file detection', () => {
    it('should identify test files by common patterns', () => {
      const testFunc = createFunction('test1', 'test_login', 'tests/test_auth.py');
      const prodFunc = createFunction('prod1', 'login', 'src/auth.py');
      
      const graph = createGraph([testFunc, prodFunc]);
      const analyzer = new CoverageAnalyzer(graph);
      const result = analyzer.analyze();

      expect(result.testFiles).toContain('tests/test_auth.py');
      expect(result.testFiles).not.toContain('src/auth.py');
    });

    it('should detect .test.ts files', () => {
      const testFunc = createFunction('test1', 'testLogin', 'src/auth.test.ts', { language: 'typescript' });
      const prodFunc = createFunction('prod1', 'login', 'src/auth.ts', { language: 'typescript' });
      
      const graph = createGraph([testFunc, prodFunc]);
      const analyzer = new CoverageAnalyzer(graph);
      const result = analyzer.analyze();

      expect(result.testFiles).toContain('src/auth.test.ts');
      expect(result.testFiles).not.toContain('src/auth.ts');
    });

    it('should detect .spec.ts files', () => {
      const testFunc = createFunction('test1', 'itShouldLogin', 'src/auth.spec.ts', { language: 'typescript' });
      
      const graph = createGraph([testFunc]);
      const analyzer = new CoverageAnalyzer(graph);
      const result = analyzer.analyze();

      expect(result.testFiles).toContain('src/auth.spec.ts');
    });

    it('should detect _test.py files', () => {
      const testFunc = createFunction('test1', 'test_auth', 'auth_test.py');
      
      const graph = createGraph([testFunc]);
      const analyzer = new CoverageAnalyzer(graph);
      const result = analyzer.analyze();

      expect(result.testFiles).toContain('auth_test.py');
    });
  });

  describe('sensitive data classification', () => {
    it('should classify password fields as credentials', () => {
      // Entry point that calls accessor
      const entry = createFunction('entry1', 'api_handler', 'src/api.py', {
        isExported: true,
        calls: [createCallSite('entry1', 'f1', 'get_user', 'src/api.py', 5)],
      });

      const func = createFunction('f1', 'get_user', 'src/user.py', {
        calledBy: [createCallSite('entry1', 'f1', 'get_user', 'src/api.py', 5)],
        dataAccess: [createDataAccess('users', ['id', 'password_hash'], 'src/user.py', 10)],
      });

      const graph = createGraph([entry, func], ['entry1']);
      const analyzer = new CoverageAnalyzer(graph);
      const result = analyzer.analyze();

      const credentialFields = result.fields.filter(f => f.sensitivity === 'credentials');
      expect(credentialFields.length).toBeGreaterThan(0);
    });

    it('should classify token fields as credentials', () => {
      const entry = createFunction('entry1', 'api_handler', 'src/api.py', {
        isExported: true,
        calls: [createCallSite('entry1', 'f1', 'validate_token', 'src/api.py', 5)],
      });

      const func = createFunction('f1', 'validate_token', 'src/auth.py', {
        calledBy: [createCallSite('entry1', 'f1', 'validate_token', 'src/api.py', 5)],
        dataAccess: [createDataAccess('tokens', ['token', 'refresh_token'], 'src/auth.py', 10)],
      });

      const graph = createGraph([entry, func], ['entry1']);
      const analyzer = new CoverageAnalyzer(graph);
      const result = analyzer.analyze();

      expect(result.summary.bySensitivity.credentials.fields).toBeGreaterThan(0);
    });

    it('should classify credit_card fields as financial', () => {
      const entry = createFunction('entry1', 'api_handler', 'src/api.py', {
        isExported: true,
        calls: [createCallSite('entry1', 'f1', 'process_payment', 'src/api.py', 5)],
      });

      const func = createFunction('f1', 'process_payment', 'src/payment.py', {
        calledBy: [createCallSite('entry1', 'f1', 'process_payment', 'src/api.py', 5)],
        dataAccess: [createDataAccess('payments', ['credit_card_number', 'cvv'], 'src/payment.py', 10)],
      });

      const graph = createGraph([entry, func], ['entry1']);
      const analyzer = new CoverageAnalyzer(graph);
      const result = analyzer.analyze();

      expect(result.summary.bySensitivity.financial.fields).toBeGreaterThan(0);
    });

    it('should classify email fields as PII', () => {
      const entry = createFunction('entry1', 'api_handler', 'src/api.py', {
        isExported: true,
        calls: [createCallSite('entry1', 'f1', 'get_profile', 'src/api.py', 5)],
      });

      const func = createFunction('f1', 'get_profile', 'src/profile.py', {
        calledBy: [createCallSite('entry1', 'f1', 'get_profile', 'src/api.py', 5)],
        dataAccess: [createDataAccess('users', ['email', 'phone'], 'src/profile.py', 10)],
      });

      const graph = createGraph([entry, func], ['entry1']);
      const analyzer = new CoverageAnalyzer(graph);
      const result = analyzer.analyze();

      expect(result.summary.bySensitivity.pii.fields).toBeGreaterThan(0);
    });

    it('should classify health data correctly', () => {
      const entry = createFunction('entry1', 'api_handler', 'src/api.py', {
        isExported: true,
        calls: [createCallSite('entry1', 'f1', 'get_patient', 'src/api.py', 5)],
      });

      const func = createFunction('f1', 'get_patient', 'src/medical.py', {
        calledBy: [createCallSite('entry1', 'f1', 'get_patient', 'src/api.py', 5)],
        dataAccess: [createDataAccess('patients', ['diagnosis', 'prescription'], 'src/medical.py', 10)],
      });

      const graph = createGraph([entry, func], ['entry1']);
      const analyzer = new CoverageAnalyzer(graph);
      const result = analyzer.analyze();

      expect(result.summary.bySensitivity.health.fields).toBeGreaterThan(0);
    });
  });

  describe('coverage calculation', () => {
    let entryPoint: FunctionNode;
    let accessor: FunctionNode;
    let testFunc: FunctionNode;

    beforeEach(() => {
      // Entry point that calls accessor
      entryPoint = createFunction('entry1', 'api_get_user', 'src/routes/user.py', {
        isExported: true,
        calls: [createCallSite('entry1', 'accessor1', 'get_user_data', 'src/routes/user.py', 5)],
      });

      // Accessor that reads sensitive data
      accessor = createFunction('accessor1', 'get_user_data', 'src/services/user.py', {
        calledBy: [createCallSite('entry1', 'accessor1', 'get_user_data', 'src/routes/user.py', 5)],
        dataAccess: [createDataAccess('users', ['password_hash'], 'src/services/user.py', 10)],
      });

      // Test function
      testFunc = createFunction('test1', 'test_get_user', 'tests/test_user.py', {
        calls: [createCallSite('test1', 'accessor1', 'get_user_data', 'tests/test_user.py', 15)],
      });
    });

    it('should mark paths as tested when test calls accessor', () => {
      // Add calledBy to accessor from test
      accessor.calledBy.push(createCallSite('test1', 'accessor1', 'get_user_data', 'tests/test_user.py', 15));

      const graph = createGraph([entryPoint, accessor, testFunc], ['entry1']);
      const analyzer = new CoverageAnalyzer(graph);
      const result = analyzer.analyze();

      // The path should be marked as tested
      expect(result.summary.testedAccessPaths).toBeGreaterThan(0);
      expect(result.summary.coveragePercent).toBeGreaterThan(0);
    });

    it('should mark paths as untested when no test coverage', () => {
      // No test calls the accessor
      const graph = createGraph([entryPoint, accessor], ['entry1']);
      const analyzer = new CoverageAnalyzer(graph);
      const result = analyzer.analyze();

      expect(result.summary.testedAccessPaths).toBe(0);
      expect(result.summary.coveragePercent).toBe(0);
      expect(result.uncoveredPaths.length).toBeGreaterThan(0);
    });

    it('should calculate correct coverage percentage', () => {
      // Create two accessors, one tested, one not
      const accessor2 = createFunction('accessor2', 'get_user_email', 'src/services/user.py', {
        calledBy: [createCallSite('entry1', 'accessor2', 'get_user_email', 'src/routes/user.py', 6)],
        dataAccess: [createDataAccess('users', ['email'], 'src/services/user.py', 20)],
      });

      // Test only calls accessor1
      accessor.calledBy.push(createCallSite('test1', 'accessor1', 'get_user_data', 'tests/test_user.py', 15));
      entryPoint.calls.push(createCallSite('entry1', 'accessor2', 'get_user_email', 'src/routes/user.py', 6));

      const graph = createGraph([entryPoint, accessor, accessor2, testFunc], ['entry1']);
      const analyzer = new CoverageAnalyzer(graph);
      const result = analyzer.analyze();

      // Should have partial coverage
      expect(result.summary.coveragePercent).toBeGreaterThan(0);
      expect(result.summary.coveragePercent).toBeLessThan(100);
    });
  });

  describe('field coverage status', () => {
    it('should mark field as covered when all paths tested', () => {
      // Entry point
      const entry = createFunction('entry1', 'api_handler', 'src/api.py', {
        isExported: true,
        calls: [createCallSite('entry1', 'accessor1', 'get_password', 'src/api.py', 5)],
      });

      const accessor = createFunction('accessor1', 'get_password', 'src/auth.py', {
        calledBy: [
          createCallSite('entry1', 'accessor1', 'get_password', 'src/api.py', 5),
          createCallSite('test1', 'accessor1', 'get_password', 'tests/test_auth.py', 10),
        ],
        dataAccess: [createDataAccess('users', ['password_hash'], 'src/auth.py', 5)],
      });

      const testFunc = createFunction('test1', 'test_auth', 'tests/test_auth.py', {
        calls: [createCallSite('test1', 'accessor1', 'get_password', 'tests/test_auth.py', 10)],
      });

      const graph = createGraph([entry, accessor, testFunc], ['entry1']);
      const analyzer = new CoverageAnalyzer(graph);
      const result = analyzer.analyze();

      const passwordField = result.fields.find(f => f.field === 'password_hash');
      expect(passwordField).toBeDefined();
      expect(passwordField?.status).toBe('covered');
    });

    it('should mark field as uncovered when no paths tested', () => {
      // Entry point
      const entry = createFunction('entry1', 'api_handler', 'src/api.py', {
        isExported: true,
        calls: [createCallSite('entry1', 'accessor1', 'get_password', 'src/api.py', 5)],
      });

      const accessor = createFunction('accessor1', 'get_password', 'src/auth.py', {
        calledBy: [createCallSite('entry1', 'accessor1', 'get_password', 'src/api.py', 5)],
        dataAccess: [createDataAccess('users', ['password_hash'], 'src/auth.py', 5)],
      });

      const graph = createGraph([entry, accessor], ['entry1']);
      const analyzer = new CoverageAnalyzer(graph);
      const result = analyzer.analyze();

      const passwordField = result.fields.find(f => f.field === 'password_hash');
      expect(passwordField).toBeDefined();
      expect(passwordField?.status).toBe('uncovered');
    });
  });

  describe('uncovered paths prioritization', () => {
    it('should prioritize credentials over PII', () => {
      const credAccessor = createFunction('cred1', 'get_password', 'src/auth.py', {
        dataAccess: [createDataAccess('users', ['password_hash'], 'src/auth.py', 5)],
      });

      const piiAccessor = createFunction('pii1', 'get_email', 'src/user.py', {
        dataAccess: [createDataAccess('users', ['email'], 'src/user.py', 5)],
      });

      const graph = createGraph([credAccessor, piiAccessor], ['cred1', 'pii1']);
      const analyzer = new CoverageAnalyzer(graph);
      const result = analyzer.analyze();

      // Credentials should come before PII in uncovered paths
      const credIndex = result.uncoveredPaths.findIndex(p => p.sensitivity === 'credentials');
      const piiIndex = result.uncoveredPaths.findIndex(p => p.sensitivity === 'pii');

      if (credIndex !== -1 && piiIndex !== -1) {
        expect(credIndex).toBeLessThan(piiIndex);
      }
    });

    it('should prioritize financial over PII', () => {
      const finAccessor = createFunction('fin1', 'get_payment', 'src/payment.py', {
        dataAccess: [createDataAccess('payments', ['credit_card_number'], 'src/payment.py', 5)],
      });

      const piiAccessor = createFunction('pii1', 'get_email', 'src/user.py', {
        dataAccess: [createDataAccess('users', ['email'], 'src/user.py', 5)],
      });

      const graph = createGraph([finAccessor, piiAccessor], ['fin1', 'pii1']);
      const analyzer = new CoverageAnalyzer(graph);
      const result = analyzer.analyze();

      const finIndex = result.uncoveredPaths.findIndex(p => p.sensitivity === 'financial');
      const piiIndex = result.uncoveredPaths.findIndex(p => p.sensitivity === 'pii');

      if (finIndex !== -1 && piiIndex !== -1) {
        expect(finIndex).toBeLessThan(piiIndex);
      }
    });
  });

  describe('summary statistics', () => {
    it('should calculate correct totals', () => {
      // Entry point that calls both accessors
      const entry = createFunction('entry1', 'api_handler', 'src/api.py', {
        isExported: true,
        calls: [
          createCallSite('entry1', 'a1', 'get_password', 'src/api.py', 5),
          createCallSite('entry1', 'a2', 'get_card', 'src/api.py', 6),
        ],
      });

      const accessor1 = createFunction('a1', 'get_password', 'src/auth.py', {
        calledBy: [createCallSite('entry1', 'a1', 'get_password', 'src/api.py', 5)],
        dataAccess: [createDataAccess('users', ['password_hash'], 'src/auth.py', 5)],
      });

      const accessor2 = createFunction('a2', 'get_card', 'src/payment.py', {
        calledBy: [createCallSite('entry1', 'a2', 'get_card', 'src/api.py', 6)],
        dataAccess: [createDataAccess('payments', ['credit_card_number'], 'src/payment.py', 5)],
      });

      const graph = createGraph([entry, accessor1, accessor2], ['entry1']);
      const analyzer = new CoverageAnalyzer(graph);
      const result = analyzer.analyze();

      expect(result.summary.totalSensitiveFields).toBe(2);
      expect(result.summary.bySensitivity.credentials.fields).toBe(1);
      expect(result.summary.bySensitivity.financial.fields).toBe(1);
    });
  });

  describe('custom sensitivity patterns', () => {
    it('should use custom patterns when provided', () => {
      const entry = createFunction('entry1', 'api_handler', 'src/api.py', {
        isExported: true,
        calls: [createCallSite('entry1', 'f1', 'get_custom_data', 'src/api.py', 5)],
      });

      // Custom field that wouldn't match default patterns
      const func = createFunction('f1', 'get_custom_data', 'src/custom.py', {
        calledBy: [createCallSite('entry1', 'f1', 'get_custom_data', 'src/api.py', 5)],
        dataAccess: [createDataAccess('custom_table', ['xyzzy_field'], 'src/custom.py', 10)],
      });

      const graph = createGraph([entry, func], ['entry1']);
      const analyzer = new CoverageAnalyzer(graph);
      
      // Without custom pattern, should be unknown (no sensitive fields)
      const resultDefault = analyzer.analyze();
      expect(resultDefault.summary.totalSensitiveFields).toBe(0);

      // With custom pattern, should be detected
      const resultCustom = analyzer.analyze({
        sensitivityPatterns: [{
          name: 'Custom Field',
          patterns: ['xyzzy'],
          sensitivity: 'credentials',
          priority: 1,
        }],
      });
      
      expect(resultCustom.summary.totalSensitiveFields).toBe(1);
      expect(resultCustom.summary.bySensitivity.credentials.fields).toBe(1);
    });

    it('should allow replacing default patterns entirely', () => {
      const entry = createFunction('entry1', 'api_handler', 'src/api.py', {
        isExported: true,
        calls: [createCallSite('entry1', 'f1', 'get_password', 'src/api.py', 5)],
      });

      // Password field that would normally match
      const func = createFunction('f1', 'get_password', 'src/auth.py', {
        calledBy: [createCallSite('entry1', 'f1', 'get_password', 'src/api.py', 5)],
        dataAccess: [createDataAccess('users', ['password_hash'], 'src/auth.py', 10)],
      });

      const graph = createGraph([entry, func], ['entry1']);
      const analyzer = new CoverageAnalyzer(graph);
      
      // With default patterns, should detect password
      const resultDefault = analyzer.analyze();
      expect(resultDefault.summary.bySensitivity.credentials.fields).toBe(1);

      // With replaced patterns (no password pattern), should not detect
      const resultReplaced = analyzer.analyze({
        sensitivityPatterns: [{
          name: 'Only Email',
          patterns: ['email'],
          sensitivity: 'pii',
          priority: 1,
        }],
        replaceSensitivityPatterns: true,
      });
      
      expect(resultReplaced.summary.totalSensitiveFields).toBe(0);
    });

    it('should respect pattern priority', () => {
      const entry = createFunction('entry1', 'api_handler', 'src/api.py', {
        isExported: true,
        calls: [createCallSite('entry1', 'f1', 'get_data', 'src/api.py', 5)],
      });

      // Field that could match multiple patterns
      const func = createFunction('f1', 'get_data', 'src/data.py', {
        calledBy: [createCallSite('entry1', 'f1', 'get_data', 'src/api.py', 5)],
        dataAccess: [createDataAccess('accounts', ['account_email'], 'src/data.py', 10)],
      });

      const graph = createGraph([entry, func], ['entry1']);
      const analyzer = new CoverageAnalyzer(graph);
      
      // With custom priority, email (PII) should win over account (financial)
      const result = analyzer.analyze({
        sensitivityPatterns: [
          {
            name: 'Email First',
            patterns: ['email'],
            sensitivity: 'pii',
            priority: 1,  // Higher priority (lower number)
          },
          {
            name: 'Account Second',
            patterns: ['account'],
            sensitivity: 'financial',
            priority: 10,  // Lower priority
          },
        ],
        replaceSensitivityPatterns: true,
      });
      
      expect(result.summary.bySensitivity.pii.fields).toBe(1);
      expect(result.summary.bySensitivity.financial.fields).toBe(0);
    });
  });

  describe('custom test patterns', () => {
    it('should use custom test file patterns', () => {
      // Custom test file pattern
      const testFunc = createFunction('test1', 'verify_auth', 'verification/auth_verify.py');
      const prodFunc = createFunction('prod1', 'login', 'src/auth.py');
      
      const graph = createGraph([testFunc, prodFunc]);
      const analyzer = new CoverageAnalyzer(graph);
      
      // Default patterns won't match 'verification/*_verify.py'
      const resultDefault = analyzer.analyze();
      expect(resultDefault.testFiles).not.toContain('verification/auth_verify.py');

      // Custom pattern should match
      const resultCustom = analyzer.analyze({
        testPatterns: [/_verify\.py$/i],
      });
      expect(resultCustom.testFiles).toContain('verification/auth_verify.py');
    });
  });
});
