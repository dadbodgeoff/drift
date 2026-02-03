/**
 * Repository Stress Tests - Additional Coverage
 * 
 * This test suite validates:
 * 1. Boundary Repository (data models, sensitive fields, access points)
 * 2. Environment Repository (env variables, access points)
 * 3. Call Graph Repository (functions, calls, data access)
 * 4. Audit Repository (snapshots, history, trends, scans)
 * 5. Concurrent access patterns
 * 6. Transaction rollback behavior
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { UnifiedStore } from '../unified-store.js';
import type {
  DbDataModel,
  DbSensitiveField,
  DbDataAccessPoint,
  DbEnvVariable,
  DbEnvAccessPoint,
  DbFunction,
  DbFunctionCall,
  DbFunctionDataAccess,
  DbAuditSnapshot,
  DbPatternHistoryEvent,
  DbHealthTrend,
  DbScanHistory,
} from '../types.js';

// ============================================================================
// Test Utilities
// ============================================================================

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'drift-repo-stress-'));
}

function cleanupTempDir(dir: string): void {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function generateId(): string {
  return Math.random().toString(36).substring(2, 18);
}

// ============================================================================
// Test Suite: Boundary Repository
// ============================================================================

describe('Boundary Repository Stress Tests', () => {
  let tempDir: string;
  let store: UnifiedStore;

  beforeEach(async () => {
    tempDir = createTempDir();
    store = new UnifiedStore({ rootDir: tempDir });
    await store.initialize();
  });

  afterEach(async () => {
    if (store) await store.close();
    cleanupTempDir(tempDir);
  });

  describe('Data Models', () => {
    it('should add and retrieve data models', async () => {
      const model: DbDataModel = {
        name: 'User',
        table_name: 'users',
        file: 'src/models/user.ts',
        line: 10,
        framework: 'prisma',
        confidence: 0.95,
        fields: '["id","email","name","createdAt"]',
      };

      await store.boundaries.addModel(model);
      const retrieved = await store.boundaries.getModelByTable('users');

      expect(retrieved).not.toBeNull();
      expect(retrieved!.name).toBe('User');
      expect(retrieved!.framework).toBe('prisma');
      expect(JSON.parse(retrieved!.fields!)).toEqual(['id', 'email', 'name', 'createdAt']);
    });

    it('should handle multiple models', async () => {
      const models: DbDataModel[] = [
        { name: 'User', table_name: 'users', file: 'src/models/user.ts', line: 10, framework: 'prisma', confidence: 0.9, fields: '["id"]' },
        { name: 'Post', table_name: 'posts', file: 'src/models/post.ts', line: 15, framework: 'prisma', confidence: 0.85, fields: '["id","title"]' },
        { name: 'Comment', table_name: 'comments', file: 'src/models/comment.ts', line: 20, framework: 'prisma', confidence: 0.8, fields: '["id","text"]' },
      ];

      for (const model of models) {
        await store.boundaries.addModel(model);
      }

      const allModels = await store.boundaries.getModels();
      expect(allModels.length).toBe(3);
    });
  });

  describe('Sensitive Fields', () => {
    it('should add and retrieve sensitive fields', async () => {
      const field: DbSensitiveField = {
        table_name: 'users',
        field_name: 'password_hash',
        sensitivity: 'auth',
        reason: 'Contains hashed password',
      };

      await store.boundaries.addSensitiveField(field);
      const fields = await store.boundaries.getSensitiveFields('users');

      expect(fields.length).toBe(1);
      expect(fields[0].sensitivity).toBe('auth');
    });

    it('should handle all sensitivity types', async () => {
      const sensitivities: Array<'pii' | 'financial' | 'auth' | 'health' | 'custom'> = ['pii', 'financial', 'auth', 'health', 'custom'];
      
      for (const sensitivity of sensitivities) {
        await store.boundaries.addSensitiveField({
          table_name: 'test_table',
          field_name: `${sensitivity}_field`,
          sensitivity,
          reason: `Test ${sensitivity}`,
        });
      }

      const fields = await store.boundaries.getSensitiveFields('test_table');
      expect(fields.length).toBe(5);
    });
  });

  describe('Access Points', () => {
    it('should add and retrieve access points', async () => {
      const point: DbDataAccessPoint = {
        id: 'ap-1',
        table_name: 'users',
        operation: 'read',
        file: 'src/services/user.ts',
        line: 25,
        column_num: 10,
        context: 'getUserById',
        fields: '["id","email","name"]',
        is_raw_sql: 0,
        confidence: 0.9,
        function_id: 'func-1',
      };

      await store.boundaries.addAccessPoint(point);
      const points = await store.boundaries.getAccessPoints('users');

      expect(points.length).toBe(1);
      expect(points[0].operation).toBe('read');
    });

    it('should handle all operation types', async () => {
      const operations: Array<'read' | 'write' | 'delete'> = ['read', 'write', 'delete'];
      
      for (const op of operations) {
        await store.boundaries.addAccessPoint({
          id: `ap-${op}`,
          table_name: 'users',
          operation: op,
          file: 'src/test.ts',
          line: 10,
          column_num: 0,
          context: null,
          fields: null,
          is_raw_sql: 0,
          confidence: 1.0,
          function_id: null,
        });
      }

      const points = await store.boundaries.getAccessPoints('users');
      expect(points.length).toBe(3);
    });

    it('should get access points by file', async () => {
      await store.boundaries.addAccessPoint({
        id: 'ap-file-1',
        table_name: 'users',
        operation: 'read',
        file: 'src/services/user.ts',
        line: 10,
        column_num: 0,
        context: null,
        fields: null,
        is_raw_sql: 0,
        confidence: 1.0,
        function_id: null,
      });

      await store.boundaries.addAccessPoint({
        id: 'ap-file-2',
        table_name: 'posts',
        operation: 'write',
        file: 'src/services/user.ts',
        line: 20,
        column_num: 0,
        context: null,
        fields: null,
        is_raw_sql: 0,
        confidence: 1.0,
        function_id: null,
      });

      const points = await store.boundaries.getAccessPointsByFile('src/services/user.ts');
      expect(points.length).toBe(2);
    });
  });

  describe('Table Access Aggregation', () => {
    it('should aggregate table access information', async () => {
      // Add model
      await store.boundaries.addModel({
        name: 'User',
        table_name: 'users',
        file: 'src/models/user.ts',
        line: 10,
        framework: 'prisma',
        confidence: 0.9,
        fields: '["id","email","password_hash"]',
      });

      // Add sensitive field
      await store.boundaries.addSensitiveField({
        table_name: 'users',
        field_name: 'password_hash',
        sensitivity: 'auth',
        reason: 'Password hash',
      });

      // Add access points
      await store.boundaries.addAccessPoint({
        id: 'ap-agg-1',
        table_name: 'users',
        operation: 'read',
        file: 'src/services/user.ts',
        line: 10,
        column_num: 0,
        context: 'getUser',
        fields: '["id","email"]',
        is_raw_sql: 0,
        confidence: 1.0,
        function_id: null,
      });

      const tableAccess = await store.boundaries.getTableAccess('users');

      expect(tableAccess.table_name).toBe('users');
      expect(tableAccess.model).not.toBeNull();
      expect(tableAccess.sensitive_fields.length).toBe(1);
      expect(tableAccess.access_points.length).toBe(1);
      expect(tableAccess.fields).toContain('id');
      expect(tableAccess.fields).toContain('email');
    });
  });
});


// ============================================================================
// Test Suite: Environment Repository
// ============================================================================

describe('Environment Repository Stress Tests', () => {
  let tempDir: string;
  let store: UnifiedStore;

  beforeEach(async () => {
    tempDir = createTempDir();
    store = new UnifiedStore({ rootDir: tempDir });
    await store.initialize();
  });

  afterEach(async () => {
    if (store) await store.close();
    cleanupTempDir(tempDir);
  });

  describe('Variables', () => {
    it('should add and retrieve env variables', async () => {
      const variable: DbEnvVariable = {
        name: 'DATABASE_URL',
        sensitivity: 'credential',
        has_default: 0,
        is_required: 1,
        default_value: null,
      };

      await store.environment.addVariable(variable);
      const retrieved = await store.environment.getVariable('DATABASE_URL');

      expect(retrieved).not.toBeNull();
      expect(retrieved!.sensitivity).toBe('credential');
      expect(retrieved!.is_required).toBe(1);
    });

    it('should handle all sensitivity types', async () => {
      const sensitivities: Array<'secret' | 'credential' | 'config' | 'unknown'> = ['secret', 'credential', 'config', 'unknown'];
      
      for (const sensitivity of sensitivities) {
        await store.environment.addVariable({
          name: `VAR_${sensitivity.toUpperCase()}`,
          sensitivity,
          has_default: 0,
          is_required: 0,
          default_value: null,
        });
      }

      const secrets = await store.environment.getSecrets();
      expect(secrets.length).toBe(2); // secret and credential
    });

    it('should get required variables', async () => {
      await store.environment.addVariable({
        name: 'REQUIRED_VAR',
        sensitivity: 'config',
        has_default: 0,
        is_required: 1,
        default_value: null,
      });

      await store.environment.addVariable({
        name: 'OPTIONAL_VAR',
        sensitivity: 'config',
        has_default: 1,
        is_required: 0,
        default_value: 'default',
      });

      const required = await store.environment.getRequired();
      expect(required.length).toBe(1);
      expect(required[0].name).toBe('REQUIRED_VAR');
    });
  });

  describe('Access Points', () => {
    it('should add and retrieve env access points', async () => {
      await store.environment.addVariable({
        name: 'API_KEY',
        sensitivity: 'secret',
        has_default: 0,
        is_required: 1,
        default_value: null,
      });

      const point: DbEnvAccessPoint = {
        id: 'env-ap-1',
        var_name: 'API_KEY',
        method: 'process.env',
        file: 'src/config.ts',
        line: 5,
        column_num: 10,
        context: 'config initialization',
        language: 'typescript',
        confidence: 0.95,
        has_default: 0,
        default_value: null,
        is_required: 1,
      };

      await store.environment.addAccessPoint(point);
      const points = await store.environment.getAccessPoints('API_KEY');

      expect(points.length).toBe(1);
      expect(points[0].method).toBe('process.env');
    });

    it('should get access points by file', async () => {
      await store.environment.addVariable({
        name: 'VAR1',
        sensitivity: 'config',
        has_default: 0,
        is_required: 0,
        default_value: null,
      });

      await store.environment.addAccessPoint({
        id: 'env-ap-file-1',
        var_name: 'VAR1',
        method: 'process.env',
        file: 'src/config.ts',
        line: 10,
        column_num: 0,
        context: null,
        language: 'typescript',
        confidence: 1.0,
        has_default: 0,
        default_value: null,
        is_required: 0,
      });

      await store.environment.addAccessPoint({
        id: 'env-ap-file-2',
        var_name: 'VAR1',
        method: 'process.env',
        file: 'src/config.ts',
        line: 20,
        column_num: 0,
        context: null,
        language: 'typescript',
        confidence: 1.0,
        has_default: 0,
        default_value: null,
        is_required: 0,
      });

      const points = await store.environment.getAccessPointsByFile('src/config.ts');
      expect(points.length).toBe(2);
    });
  });
});


// ============================================================================
// Test Suite: Call Graph Repository
// ============================================================================

describe('Call Graph Repository Stress Tests', () => {
  let tempDir: string;
  let store: UnifiedStore;

  beforeEach(async () => {
    tempDir = createTempDir();
    store = new UnifiedStore({ rootDir: tempDir });
    await store.initialize();
  });

  afterEach(async () => {
    if (store) await store.close();
    cleanupTempDir(tempDir);
  });

  describe('Functions', () => {
    it('should add and retrieve functions', async () => {
      const func: DbFunction = {
        id: 'func-1',
        name: 'getUserById',
        qualified_name: 'UserService.getUserById',
        file: 'src/services/user.ts',
        start_line: 10,
        end_line: 25,
        language: 'typescript',
        is_exported: 1,
        is_entry_point: 0,
        is_data_accessor: 1,
        is_constructor: 0,
        is_async: 1,
        decorators: null,
        parameters: '["id: string"]',
        signature: 'async getUserById(id: string): Promise<User>',
      };

      await store.callGraph.addFunction(func);
      const retrieved = await store.callGraph.getFunction('func-1');

      expect(retrieved).not.toBeNull();
      expect(retrieved!.name).toBe('getUserById');
      expect(retrieved!.is_async).toBe(1);
    });

    it('should get functions by file', async () => {
      await store.callGraph.addFunction({
        id: 'func-file-1',
        name: 'func1',
        qualified_name: null,
        file: 'src/test.ts',
        start_line: 1,
        end_line: 10,
        language: 'typescript',
        is_exported: 0,
        is_entry_point: 0,
        is_data_accessor: 0,
        is_constructor: 0,
        is_async: 0,
        decorators: null,
        parameters: null,
        signature: null,
      });

      await store.callGraph.addFunction({
        id: 'func-file-2',
        name: 'func2',
        qualified_name: null,
        file: 'src/test.ts',
        start_line: 15,
        end_line: 25,
        language: 'typescript',
        is_exported: 0,
        is_entry_point: 0,
        is_data_accessor: 0,
        is_constructor: 0,
        is_async: 0,
        decorators: null,
        parameters: null,
        signature: null,
      });

      const funcs = await store.callGraph.getFunctionsByFile('src/test.ts');
      expect(funcs.length).toBe(2);
      expect(funcs[0].start_line).toBeLessThan(funcs[1].start_line);
    });

    it('should get entry points', async () => {
      await store.callGraph.addFunction({
        id: 'entry-1',
        name: 'main',
        qualified_name: null,
        file: 'src/index.ts',
        start_line: 1,
        end_line: 10,
        language: 'typescript',
        is_exported: 1,
        is_entry_point: 1,
        is_data_accessor: 0,
        is_constructor: 0,
        is_async: 0,
        decorators: null,
        parameters: null,
        signature: null,
      });

      await store.callGraph.addFunction({
        id: 'helper-1',
        name: 'helper',
        qualified_name: null,
        file: 'src/utils.ts',
        start_line: 1,
        end_line: 5,
        language: 'typescript',
        is_exported: 0,
        is_entry_point: 0,
        is_data_accessor: 0,
        is_constructor: 0,
        is_async: 0,
        decorators: null,
        parameters: null,
        signature: null,
      });

      const entryPoints = await store.callGraph.getEntryPoints();
      expect(entryPoints.length).toBe(1);
      expect(entryPoints[0].name).toBe('main');
    });

    it('should get data accessors', async () => {
      await store.callGraph.addFunction({
        id: 'accessor-1',
        name: 'getUsers',
        qualified_name: null,
        file: 'src/db.ts',
        start_line: 1,
        end_line: 10,
        language: 'typescript',
        is_exported: 1,
        is_entry_point: 0,
        is_data_accessor: 1,
        is_constructor: 0,
        is_async: 1,
        decorators: null,
        parameters: null,
        signature: null,
      });

      const accessors = await store.callGraph.getDataAccessors();
      expect(accessors.length).toBe(1);
      expect(accessors[0].name).toBe('getUsers');
    });
  });

  describe('Function Calls', () => {
    it('should add and retrieve function calls', async () => {
      // Add caller and callee functions
      await store.callGraph.addFunction({
        id: 'caller-func',
        name: 'handleRequest',
        qualified_name: null,
        file: 'src/handler.ts',
        start_line: 1,
        end_line: 20,
        language: 'typescript',
        is_exported: 1,
        is_entry_point: 1,
        is_data_accessor: 0,
        is_constructor: 0,
        is_async: 1,
        decorators: null,
        parameters: null,
        signature: null,
      });

      await store.callGraph.addFunction({
        id: 'callee-func',
        name: 'getUser',
        qualified_name: null,
        file: 'src/service.ts',
        start_line: 1,
        end_line: 10,
        language: 'typescript',
        is_exported: 1,
        is_entry_point: 0,
        is_data_accessor: 1,
        is_constructor: 0,
        is_async: 1,
        decorators: null,
        parameters: null,
        signature: null,
      });

      // Add call relationship
      await store.callGraph.addCall({
        caller_id: 'caller-func',
        callee_id: 'callee-func',
        callee_name: 'getUser',
        line: 10,
        column_num: 5,
        resolved: 1,
        confidence: 0.95,
        argument_count: 1,
      });

      const callers = await store.callGraph.getCallers('callee-func');
      expect(callers.length).toBe(1);
      expect(callers[0].caller_id).toBe('caller-func');

      const callees = await store.callGraph.getCallees('caller-func');
      expect(callees.length).toBe(1);
      expect(callees[0].callee_id).toBe('callee-func');
    });
  });

  describe('Data Access', () => {
    it('should track function data access', async () => {
      await store.callGraph.addFunction({
        id: 'data-func',
        name: 'fetchUsers',
        qualified_name: null,
        file: 'src/db.ts',
        start_line: 1,
        end_line: 10,
        language: 'typescript',
        is_exported: 1,
        is_entry_point: 0,
        is_data_accessor: 1,
        is_constructor: 0,
        is_async: 1,
        decorators: null,
        parameters: null,
        signature: null,
      });

      await store.callGraph.addDataAccess({
        function_id: 'data-func',
        table_name: 'users',
        operation: 'read',
        fields: '["id","email","name"]',
        line: 5,
        confidence: 0.9,
      });

      const access = await store.callGraph.getDataAccess('data-func');
      expect(access.length).toBe(1);
      expect(access[0].table_name).toBe('users');
      expect(access[0].operation).toBe('read');
    });
  });

  describe('Call Chain Analysis', () => {
    it('should compute call chains', async () => {
      // Create a call chain: A -> B -> C
      await store.callGraph.addFunction({
        id: 'chain-a', name: 'funcA', qualified_name: null, file: 'a.ts',
        start_line: 1, end_line: 10, language: 'typescript',
        is_exported: 1, is_entry_point: 1, is_data_accessor: 0,
        is_constructor: 0, is_async: 0, decorators: null, parameters: null, signature: null,
      });

      await store.callGraph.addFunction({
        id: 'chain-b', name: 'funcB', qualified_name: null, file: 'b.ts',
        start_line: 1, end_line: 10, language: 'typescript',
        is_exported: 1, is_entry_point: 0, is_data_accessor: 0,
        is_constructor: 0, is_async: 0, decorators: null, parameters: null, signature: null,
      });

      await store.callGraph.addFunction({
        id: 'chain-c', name: 'funcC', qualified_name: null, file: 'c.ts',
        start_line: 1, end_line: 10, language: 'typescript',
        is_exported: 1, is_entry_point: 0, is_data_accessor: 1,
        is_constructor: 0, is_async: 0, decorators: null, parameters: null, signature: null,
      });

      await store.callGraph.addCall({
        caller_id: 'chain-a', callee_id: 'chain-b', callee_name: 'funcB',
        line: 5, column_num: 0, resolved: 1, confidence: 1.0, argument_count: 0,
      });

      await store.callGraph.addCall({
        caller_id: 'chain-b', callee_id: 'chain-c', callee_name: 'funcC',
        line: 5, column_num: 0, resolved: 1, confidence: 1.0, argument_count: 0,
      });

      const chain = await store.callGraph.getCallChain('chain-a');
      expect(chain.length).toBe(3);
      expect(chain[0].function.name).toBe('funcA');
      expect(chain[0].depth).toBe(0);
    });
  });

  describe('Reachable Tables', () => {
    it('should find reachable tables through call chain', async () => {
      // A calls B, B accesses users table
      await store.callGraph.addFunction({
        id: 'reach-a', name: 'handler', qualified_name: null, file: 'a.ts',
        start_line: 1, end_line: 10, language: 'typescript',
        is_exported: 1, is_entry_point: 1, is_data_accessor: 0,
        is_constructor: 0, is_async: 0, decorators: null, parameters: null, signature: null,
      });

      await store.callGraph.addFunction({
        id: 'reach-b', name: 'getUsers', qualified_name: null, file: 'b.ts',
        start_line: 1, end_line: 10, language: 'typescript',
        is_exported: 1, is_entry_point: 0, is_data_accessor: 1,
        is_constructor: 0, is_async: 0, decorators: null, parameters: null, signature: null,
      });

      await store.callGraph.addCall({
        caller_id: 'reach-a', callee_id: 'reach-b', callee_name: 'getUsers',
        line: 5, column_num: 0, resolved: 1, confidence: 1.0, argument_count: 0,
      });

      await store.callGraph.addDataAccess({
        function_id: 'reach-b',
        table_name: 'users',
        operation: 'read',
        fields: '["id"]',
        line: 5,
        confidence: 1.0,
      });

      const tables = await store.callGraph.getReachableTables('reach-a');
      expect(tables).toContain('users');
    });
  });
});


// ============================================================================
// Test Suite: Audit Repository
// ============================================================================

describe('Audit Repository Stress Tests', () => {
  let tempDir: string;
  let store: UnifiedStore;

  beforeEach(async () => {
    tempDir = createTempDir();
    store = new UnifiedStore({ rootDir: tempDir });
    await store.initialize();
  });

  afterEach(async () => {
    if (store) await store.close();
    cleanupTempDir(tempDir);
  });

  describe('Snapshots', () => {
    it('should add and retrieve audit snapshots', async () => {
      const snapshot: DbAuditSnapshot = {
        date: '2024-02-01',
        scan_hash: 'abc123',
        health_score: 85,
        total_patterns: 100,
        auto_approve_eligible: 20,
        flagged_for_review: 5,
        likely_false_positives: 3,
        duplicate_candidates: 2,
        avg_confidence: 0.82,
        cross_validation_score: 0.9,
        summary: '{"api":30,"security":25,"errors":20,"logging":25}',
      };

      await store.audit.addSnapshot(snapshot);
      const retrieved = await store.audit.getSnapshot('2024-02-01');

      expect(retrieved).not.toBeNull();
      expect(retrieved!.health_score).toBe(85);
      expect(retrieved!.total_patterns).toBe(100);
    });

    it('should get latest snapshot', async () => {
      await store.audit.addSnapshot({
        date: '2024-01-01', scan_hash: 'old', health_score: 70,
        total_patterns: 50, auto_approve_eligible: 10, flagged_for_review: 2,
        likely_false_positives: 1, duplicate_candidates: 0, avg_confidence: 0.75,
        cross_validation_score: 0.8, summary: null,
      });

      await store.audit.addSnapshot({
        date: '2024-02-01', scan_hash: 'new', health_score: 85,
        total_patterns: 100, auto_approve_eligible: 20, flagged_for_review: 5,
        likely_false_positives: 3, duplicate_candidates: 2, avg_confidence: 0.82,
        cross_validation_score: 0.9, summary: null,
      });

      const latest = await store.audit.getLatestSnapshot();
      expect(latest).not.toBeNull();
      expect(latest!.date).toBe('2024-02-01');
    });

    it('should get snapshots by date range', async () => {
      for (let i = 1; i <= 10; i++) {
        await store.audit.addSnapshot({
          date: `2024-01-${i.toString().padStart(2, '0')}`,
          scan_hash: `hash-${i}`,
          health_score: 70 + i,
          total_patterns: 50 + i * 5,
          auto_approve_eligible: i,
          flagged_for_review: 0,
          likely_false_positives: 0,
          duplicate_candidates: 0,
          avg_confidence: 0.7 + i * 0.01,
          cross_validation_score: 0.8,
          summary: null,
        });
      }

      const range = await store.audit.getSnapshots('2024-01-03', '2024-01-07');
      expect(range.length).toBe(5);
    });
  });

  describe('History Events', () => {
    it('should add and retrieve history events', async () => {
      const event: DbPatternHistoryEvent = {
        date: '2024-02-01T10:30:00.000Z',
        pattern_id: 'pattern-1',
        action: 'approved',
        previous_status: 'discovered',
        new_status: 'approved',
        changed_by: 'admin',
        details: 'Approved after review',
      };

      await store.audit.addHistoryEvent(event);
      const history = await store.audit.getHistory('pattern-1');

      expect(history.length).toBe(1);
      expect(history[0].action).toBe('approved');
    });

    it('should handle all action types', async () => {
      const actions: Array<'created' | 'approved' | 'ignored' | 'updated' | 'deleted'> = 
        ['created', 'approved', 'ignored', 'updated', 'deleted'];
      
      for (const action of actions) {
        await store.audit.addHistoryEvent({
          date: new Date().toISOString(),
          pattern_id: 'pattern-actions',
          action,
          previous_status: 'discovered',
          new_status: action === 'deleted' ? null : 'approved',
          changed_by: 'test',
          details: null,
        });
      }

      const history = await store.audit.getHistory('pattern-actions');
      expect(history.length).toBe(5);
    });
  });

  describe('Health Trends', () => {
    it('should add and retrieve health trends', async () => {
      // Use today's date to ensure it's within the 7-day window
      const today = new Date().toISOString().split('T')[0];
      const trend: DbHealthTrend = {
        date: today,
        health_score: 85,
        avg_confidence: 0.82,
        total_patterns: 100,
        approved_count: 60,
        duplicate_groups: 5,
        cross_validation_score: 0.9,
      };

      await store.audit.addTrend(trend);
      const trends = await store.audit.getTrends(7);

      expect(trends.length).toBe(1);
      expect(trends[0].health_score).toBe(85);
    });

    it('should filter trends by days', async () => {
      const today = new Date();
      
      for (let i = 0; i < 60; i++) {
        const date = new Date(today);
        date.setDate(date.getDate() - i);
        const dateStr = date.toISOString().split('T')[0];
        
        await store.audit.addTrend({
          date: dateStr,
          health_score: 80 + (i % 10),
          avg_confidence: 0.8,
          total_patterns: 100,
          approved_count: 50,
          duplicate_groups: 0,
          cross_validation_score: 0.85,
        });
      }

      const last30 = await store.audit.getTrends(30);
      expect(last30.length).toBeLessThanOrEqual(31);
    });
  });

  describe('Scan History', () => {
    it('should add and retrieve scan history', async () => {
      const scan: DbScanHistory = {
        scan_id: 'scan-1',
        started_at: '2024-02-01T10:00:00.000Z',
        completed_at: '2024-02-01T10:05:00.000Z',
        duration_ms: 300000,
        files_scanned: 500,
        patterns_found: 100,
        patterns_approved: 60,
        errors: 0,
        status: 'completed',
        error_message: null,
        checksum: 'abc123',
      };

      await store.audit.addScan(scan);
      const latest = await store.audit.getLatestScan();

      expect(latest).not.toBeNull();
      expect(latest!.scan_id).toBe('scan-1');
      expect(latest!.status).toBe('completed');
    });

    it('should handle failed scans', async () => {
      await store.audit.addScan({
        scan_id: 'scan-failed',
        started_at: '2024-02-01T10:00:00.000Z',
        completed_at: '2024-02-01T10:01:00.000Z',
        duration_ms: 60000,
        files_scanned: 100,
        patterns_found: 0,
        patterns_approved: 0,
        errors: 5,
        status: 'failed',
        error_message: 'Parser error in file.ts',
        checksum: null,
      });

      const latest = await store.audit.getLatestScan();
      expect(latest!.status).toBe('failed');
      expect(latest!.error_message).toBe('Parser error in file.ts');
    });

    it('should get multiple scans', async () => {
      for (let i = 0; i < 20; i++) {
        await store.audit.addScan({
          scan_id: `scan-${i}`,
          started_at: new Date(Date.now() - i * 3600000).toISOString(),
          completed_at: new Date(Date.now() - i * 3600000 + 60000).toISOString(),
          duration_ms: 60000,
          files_scanned: 100 + i,
          patterns_found: 50 + i,
          patterns_approved: 30 + i,
          errors: 0,
          status: 'completed',
          error_message: null,
          checksum: `hash-${i}`,
        });
      }

      const scans = await store.audit.getScans(10);
      expect(scans.length).toBe(10);
    });
  });
});


// ============================================================================
// Test Suite: Concurrent Access and Transactions
// ============================================================================

describe('Concurrent Access and Transaction Tests', () => {
  let tempDir: string;
  let store: UnifiedStore;

  beforeEach(async () => {
    tempDir = createTempDir();
    store = new UnifiedStore({ rootDir: tempDir });
    await store.initialize();
  });

  afterEach(async () => {
    if (store) await store.close();
    cleanupTempDir(tempDir);
  });

  describe('Concurrent Writes', () => {
    it('should handle concurrent pattern writes', async () => {
      const promises: Promise<void>[] = [];
      
      for (let i = 0; i < 50; i++) {
        promises.push(
          store.patterns.create({
            id: `concurrent-${i}`,
            name: `Concurrent Pattern ${i}`,
            description: null,
            category: 'api',
            subcategory: null,
            status: 'discovered',
            confidence_score: 0.5,
            confidence_level: 'medium',
            confidence_frequency: null,
            confidence_consistency: null,
            confidence_age: null,
            confidence_spread: null,
            detector_type: null,
            detector_config: null,
            severity: 'info',
            auto_fixable: 0,
            first_seen: new Date().toISOString(),
            last_seen: new Date().toISOString(),
            approved_at: null,
            approved_by: null,
            tags: null,
            source: null,
            location_count: 0,
            outlier_count: 0,
          })
        );
      }

      await Promise.all(promises);
      const count = await store.patterns.count();
      expect(count).toBe(50);
    });

    it('should handle concurrent reads and writes', async () => {
      // First create some patterns
      for (let i = 0; i < 20; i++) {
        await store.patterns.create({
          id: `rw-${i}`,
          name: `RW Pattern ${i}`,
          description: null,
          category: 'api',
          subcategory: null,
          status: 'discovered',
          confidence_score: 0.5,
          confidence_level: 'medium',
          confidence_frequency: null,
          confidence_consistency: null,
          confidence_age: null,
          confidence_spread: null,
          detector_type: null,
          detector_config: null,
          severity: 'info',
          auto_fixable: 0,
          first_seen: new Date().toISOString(),
          last_seen: new Date().toISOString(),
          approved_at: null,
          approved_by: null,
          tags: null,
          source: null,
          location_count: 0,
          outlier_count: 0,
        });
      }

      // Now do concurrent reads and writes
      const operations: Promise<unknown>[] = [];
      
      for (let i = 0; i < 20; i++) {
        // Read
        operations.push(store.patterns.read(`rw-${i}`));
        // Write new
        operations.push(
          store.patterns.create({
            id: `rw-new-${i}`,
            name: `RW New Pattern ${i}`,
            description: null,
            category: 'security',
            subcategory: null,
            status: 'discovered',
            confidence_score: 0.6,
            confidence_level: 'medium',
            confidence_frequency: null,
            confidence_consistency: null,
            confidence_age: null,
            confidence_spread: null,
            detector_type: null,
            detector_config: null,
            severity: 'info',
            auto_fixable: 0,
            first_seen: new Date().toISOString(),
            last_seen: new Date().toISOString(),
            approved_at: null,
            approved_by: null,
            tags: null,
            source: null,
            location_count: 0,
            outlier_count: 0,
          })
        );
      }

      await Promise.all(operations);
      const count = await store.patterns.count();
      expect(count).toBe(40);
    });
  });

  describe('Transaction Behavior', () => {
    it('should execute synchronous transactions atomically', () => {
      const result = store.transactionSync(() => {
        store.patterns.create({
          id: 'tx-1',
          name: 'TX Pattern 1',
          description: null,
          category: 'api',
          subcategory: null,
          status: 'discovered',
          confidence_score: 0.5,
          confidence_level: 'medium',
          confidence_frequency: null,
          confidence_consistency: null,
          confidence_age: null,
          confidence_spread: null,
          detector_type: null,
          detector_config: null,
          severity: 'info',
          auto_fixable: 0,
          first_seen: new Date().toISOString(),
          last_seen: new Date().toISOString(),
          approved_at: null,
          approved_by: null,
          tags: null,
          source: null,
          location_count: 0,
          outlier_count: 0,
        });

        store.patterns.create({
          id: 'tx-2',
          name: 'TX Pattern 2',
          description: null,
          category: 'security',
          subcategory: null,
          status: 'discovered',
          confidence_score: 0.6,
          confidence_level: 'medium',
          confidence_frequency: null,
          confidence_consistency: null,
          confidence_age: null,
          confidence_spread: null,
          detector_type: null,
          detector_config: null,
          severity: 'info',
          auto_fixable: 0,
          first_seen: new Date().toISOString(),
          last_seen: new Date().toISOString(),
          approved_at: null,
          approved_by: null,
          tags: null,
          source: null,
          location_count: 0,
          outlier_count: 0,
        });

        return 'success';
      });

      expect(result).toBe('success');
    });
  });

  describe('WAL Mode Behavior', () => {
    it('should maintain WAL mode after operations', async () => {
      // Perform some operations
      for (let i = 0; i < 10; i++) {
        await store.patterns.create({
          id: `wal-${i}`,
          name: `WAL Pattern ${i}`,
          description: null,
          category: 'api',
          subcategory: null,
          status: 'discovered',
          confidence_score: 0.5,
          confidence_level: 'medium',
          confidence_frequency: null,
          confidence_consistency: null,
          confidence_age: null,
          confidence_spread: null,
          detector_type: null,
          detector_config: null,
          severity: 'info',
          auto_fixable: 0,
          first_seen: new Date().toISOString(),
          last_seen: new Date().toISOString(),
          approved_at: null,
          approved_by: null,
          tags: null,
          source: null,
          location_count: 0,
          outlier_count: 0,
        });
      }

      // Checkpoint
      await store.checkpoint();

      // Verify WAL mode is still active
      const db = store.getDatabase();
      const result = db.pragma('journal_mode') as Array<{ journal_mode: string }>;
      expect(result[0].journal_mode).toBe('wal');
    });
  });

  describe('Vacuum and Maintenance', () => {
    it('should vacuum database successfully', async () => {
      // Add and delete patterns to create fragmentation
      for (let i = 0; i < 100; i++) {
        await store.patterns.create({
          id: `vacuum-${i}`,
          name: `Vacuum Pattern ${i}`,
          description: 'A'.repeat(1000), // Large description
          category: 'api',
          subcategory: null,
          status: 'discovered',
          confidence_score: 0.5,
          confidence_level: 'medium',
          confidence_frequency: null,
          confidence_consistency: null,
          confidence_age: null,
          confidence_spread: null,
          detector_type: null,
          detector_config: null,
          severity: 'info',
          auto_fixable: 0,
          first_seen: new Date().toISOString(),
          last_seen: new Date().toISOString(),
          approved_at: null,
          approved_by: null,
          tags: null,
          source: null,
          location_count: 0,
          outlier_count: 0,
        });
      }

      // Delete half
      for (let i = 0; i < 50; i++) {
        await store.patterns.delete(`vacuum-${i}`);
      }

      // Vacuum should not throw
      await expect(store.vacuum()).resolves.not.toThrow();
    });
  });
});


// ============================================================================
// Test Suite: Data Integrity
// ============================================================================

describe('Data Integrity Tests', () => {
  let tempDir: string;
  let store: UnifiedStore;

  beforeEach(async () => {
    tempDir = createTempDir();
    store = new UnifiedStore({ rootDir: tempDir });
    await store.initialize();
  });

  afterEach(async () => {
    if (store) await store.close();
    cleanupTempDir(tempDir);
  });

  describe('Foreign Key Constraints', () => {
    it('should enforce foreign key on pattern_locations', async () => {
      // Try to add location for non-existent pattern
      await expect(
        store.patterns.addLocation('non-existent-pattern', {
          pattern_id: 'non-existent-pattern',
          file: 'test.ts',
          line: 1,
          column_num: 0,
          end_line: null,
          end_column: null,
          is_outlier: 0,
          outlier_reason: null,
          deviation_score: null,
          confidence: 1.0,
          snippet: null,
        })
      ).rejects.toThrow();
    });

    it('should cascade delete pattern_locations when pattern is deleted', async () => {
      // Create pattern with locations
      await store.patterns.create({
        id: 'cascade-test',
        name: 'Cascade Test',
        description: null,
        category: 'api',
        subcategory: null,
        status: 'discovered',
        confidence_score: 0.5,
        confidence_level: 'medium',
        confidence_frequency: null,
        confidence_consistency: null,
        confidence_age: null,
        confidence_spread: null,
        detector_type: null,
        detector_config: null,
        severity: 'info',
        auto_fixable: 0,
        first_seen: new Date().toISOString(),
        last_seen: new Date().toISOString(),
        approved_at: null,
        approved_by: null,
        tags: null,
        source: null,
        location_count: 0,
        outlier_count: 0,
      });

      await store.patterns.addLocation('cascade-test', {
        pattern_id: 'cascade-test',
        file: 'test.ts',
        line: 1,
        column_num: 0,
        end_line: null,
        end_column: null,
        is_outlier: 0,
        outlier_reason: null,
        deviation_score: null,
        confidence: 1.0,
        snippet: null,
      });

      // Delete pattern
      await store.patterns.delete('cascade-test');

      // Verify locations are gone
      const db = store.getDatabase();
      const locations = db.prepare(
        'SELECT * FROM pattern_locations WHERE pattern_id = ?'
      ).all('cascade-test');
      expect(locations.length).toBe(0);
    });
  });

  describe('Check Constraints', () => {
    it('should enforce status check constraint on patterns', async () => {
      const db = store.getDatabase();
      
      // Try to insert invalid status directly
      expect(() => {
        db.prepare(`
          INSERT INTO patterns (id, name, category, status, confidence_score, confidence_level, severity, first_seen, last_seen)
          VALUES ('invalid-status', 'Test', 'api', 'invalid_status', 0.5, 'medium', 'info', datetime('now'), datetime('now'))
        `).run();
      }).toThrow();
    });

    it('should enforce operation check constraint on data_access_points', async () => {
      const db = store.getDatabase();
      
      expect(() => {
        db.prepare(`
          INSERT INTO data_access_points (id, table_name, operation, file, line)
          VALUES ('invalid-op', 'users', 'invalid_operation', 'test.ts', 1)
        `).run();
      }).toThrow();
    });
  });

  describe('Unique Constraints', () => {
    it('should enforce unique pattern IDs', async () => {
      await store.patterns.create({
        id: 'unique-test',
        name: 'First',
        description: null,
        category: 'api',
        subcategory: null,
        status: 'discovered',
        confidence_score: 0.5,
        confidence_level: 'medium',
        confidence_frequency: null,
        confidence_consistency: null,
        confidence_age: null,
        confidence_spread: null,
        detector_type: null,
        detector_config: null,
        severity: 'info',
        auto_fixable: 0,
        first_seen: new Date().toISOString(),
        last_seen: new Date().toISOString(),
        approved_at: null,
        approved_by: null,
        tags: null,
        source: null,
        location_count: 0,
        outlier_count: 0,
      });

      await expect(
        store.patterns.create({
          id: 'unique-test',
          name: 'Second',
          description: null,
          category: 'security',
          subcategory: null,
          status: 'discovered',
          confidence_score: 0.6,
          confidence_level: 'medium',
          confidence_frequency: null,
          confidence_consistency: null,
          confidence_age: null,
          confidence_spread: null,
          detector_type: null,
          detector_config: null,
          severity: 'info',
          auto_fixable: 0,
          first_seen: new Date().toISOString(),
          last_seen: new Date().toISOString(),
          approved_at: null,
          approved_by: null,
          tags: null,
          source: null,
          location_count: 0,
          outlier_count: 0,
        })
      ).rejects.toThrow();
    });

    it('should enforce unique contract method+endpoint', async () => {
      await store.contracts.create({
        id: 'contract-unique-1',
        method: 'GET',
        endpoint: '/api/users',
        normalized_endpoint: '/api/users',
        status: 'discovered',
        backend_method: 'GET',
        backend_path: '/api/users',
        backend_normalized_path: '/api/users',
        backend_file: 'test.ts',
        backend_line: 1,
        backend_framework: null,
        backend_response_fields: null,
        confidence_score: 0.5,
        confidence_level: 'medium',
        match_confidence: null,
        field_extraction_confidence: null,
        mismatches: null,
        first_seen: new Date().toISOString(),
        last_seen: new Date().toISOString(),
        verified_at: null,
        verified_by: null,
      });

      await expect(
        store.contracts.create({
          id: 'contract-unique-2',
          method: 'GET',
          endpoint: '/api/users',
          normalized_endpoint: '/api/users', // Same method + normalized_endpoint
          status: 'discovered',
          backend_method: 'GET',
          backend_path: '/api/users',
          backend_normalized_path: '/api/users',
          backend_file: 'other.ts',
          backend_line: 10,
          backend_framework: null,
          backend_response_fields: null,
          confidence_score: 0.6,
          confidence_level: 'medium',
          match_confidence: null,
          field_extraction_confidence: null,
          mismatches: null,
          first_seen: new Date().toISOString(),
          last_seen: new Date().toISOString(),
          verified_at: null,
          verified_by: null,
        })
      ).rejects.toThrow();
    });
  });

  describe('Index Performance', () => {
    it('should use indexes for pattern queries', async () => {
      // Add many patterns
      for (let i = 0; i < 500; i++) {
        await store.patterns.create({
          id: `perf-${i}`,
          name: `Performance Pattern ${i}`,
          description: null,
          category: i % 2 === 0 ? 'api' : 'security',
          subcategory: null,
          status: i % 3 === 0 ? 'approved' : 'discovered',
          confidence_score: (i % 100) / 100,
          confidence_level: i % 100 >= 70 ? 'high' : 'medium',
          confidence_frequency: null,
          confidence_consistency: null,
          confidence_age: null,
          confidence_spread: null,
          detector_type: null,
          detector_config: null,
          severity: 'info',
          auto_fixable: 0,
          first_seen: new Date().toISOString(),
          last_seen: new Date().toISOString(),
          approved_at: null,
          approved_by: null,
          tags: null,
          source: null,
          location_count: 0,
          outlier_count: 0,
        });
      }

      // Query by category should be fast (uses idx_patterns_category)
      const startCategory = Date.now();
      const byCategory = await store.patterns.findByCategory('api');
      const categoryTime = Date.now() - startCategory;
      
      expect(byCategory.length).toBe(250);
      expect(categoryTime).toBeLessThan(100); // Should be very fast with index

      // Query by status should be fast (uses idx_patterns_status)
      const startStatus = Date.now();
      const byStatus = await store.patterns.findByStatus('approved');
      const statusTime = Date.now() - startStatus;
      
      expect(byStatus.length).toBeGreaterThan(0);
      expect(statusTime).toBeLessThan(100);
    });
  });
});


// ============================================================================
// Test Suite: DNA Repository
// ============================================================================

describe('DNA Repository Stress Tests', () => {
  let tempDir: string;
  let store: UnifiedStore;

  beforeEach(async () => {
    tempDir = createTempDir();
    store = new UnifiedStore({ rootDir: tempDir });
    await store.initialize();
  });

  afterEach(async () => {
    if (store) await store.close();
    cleanupTempDir(tempDir);
  });

  describe('Profile', () => {
    it('should save and retrieve DNA profile', async () => {
      const profile = {
        version: '1.0.0',
        generated_at: new Date().toISOString(),
        health_score: 85,
        genetic_diversity: 0.75,
        summary: '{"variant-handling":"tailwind","responsive-approach":"mobile-first"}',
      };

      await store.dna.saveProfile(profile);
      const retrieved = await store.dna.getProfile();

      expect(retrieved).not.toBeNull();
      expect(retrieved!.health_score).toBe(85);
      expect(retrieved!.genetic_diversity).toBe(0.75);
    });

    it('should update existing profile', async () => {
      await store.dna.saveProfile({
        version: '1.0.0',
        generated_at: new Date().toISOString(),
        health_score: 70,
        genetic_diversity: 0.6,
        summary: null,
      });

      await store.dna.saveProfile({
        version: '1.1.0',
        generated_at: new Date().toISOString(),
        health_score: 85,
        genetic_diversity: 0.8,
        summary: '{"updated":true}',
      });

      const retrieved = await store.dna.getProfile();
      expect(retrieved!.version).toBe('1.1.0');
      expect(retrieved!.health_score).toBe(85);
    });
  });

  describe('Genes', () => {
    it('should add and retrieve genes', async () => {
      const gene = {
        id: 'variant-handling',
        name: 'Variant Handling',
        dominant_variant: 'tailwind',
        frequency: 0.85,
        confidence: 0.9,
        variants: '["tailwind","css-modules","styled-components"]',
        evidence: '["src/components/Button.tsx:15","src/components/Card.tsx:20"]',
      };

      await store.dna.addGene(gene);
      const retrieved = await store.dna.getGene('variant-handling');

      expect(retrieved).not.toBeNull();
      expect(retrieved!.dominant_variant).toBe('tailwind');
      expect(retrieved!.frequency).toBe(0.85);
    });

    it('should get all genes', async () => {
      const genes = [
        { id: 'gene-1', name: 'Gene 1', dominant_variant: 'v1', frequency: 0.8, confidence: 0.9, variants: '[]', evidence: '[]' },
        { id: 'gene-2', name: 'Gene 2', dominant_variant: 'v2', frequency: 0.7, confidence: 0.85, variants: '[]', evidence: '[]' },
        { id: 'gene-3', name: 'Gene 3', dominant_variant: 'v3', frequency: 0.9, confidence: 0.95, variants: '[]', evidence: '[]' },
      ];

      for (const gene of genes) {
        await store.dna.addGene(gene);
      }

      const allGenes = await store.dna.getGenes();
      expect(allGenes.length).toBe(3);
    });
  });

  describe('Mutations', () => {
    it('should add and retrieve mutations', async () => {
      // First add a gene
      await store.dna.addGene({
        id: 'mutation-gene',
        name: 'Mutation Gene',
        dominant_variant: 'expected',
        frequency: 0.8,
        confidence: 0.9,
        variants: '[]',
        evidence: '[]',
      });

      // Add mutation
      await store.dna.addMutation({
        gene_id: 'mutation-gene',
        file: 'src/components/Legacy.tsx',
        line: 25,
        expected: 'tailwind',
        actual: 'inline-styles',
        impact: 'medium',
        reason: 'Legacy component using inline styles',
      });

      const mutations = await store.dna.getMutations('mutation-gene');
      expect(mutations.length).toBe(1);
      expect(mutations[0].impact).toBe('medium');
    });

    it('should handle all impact levels', async () => {
      await store.dna.addGene({
        id: 'impact-gene',
        name: 'Impact Gene',
        dominant_variant: 'expected',
        frequency: 0.8,
        confidence: 0.9,
        variants: '[]',
        evidence: '[]',
      });

      const impacts: Array<'high' | 'medium' | 'low'> = ['high', 'medium', 'low'];
      for (const impact of impacts) {
        await store.dna.addMutation({
          gene_id: 'impact-gene',
          file: `src/${impact}.tsx`,
          line: 10,
          expected: 'expected',
          actual: 'actual',
          impact,
          reason: `${impact} impact mutation`,
        });
      }

      const mutations = await store.dna.getMutations('impact-gene');
      expect(mutations.length).toBe(3);
    });
  });
});


// ============================================================================
// Test Suite: Test Topology Repository
// ============================================================================

describe('Test Topology Repository Stress Tests', () => {
  let tempDir: string;
  let store: UnifiedStore;

  beforeEach(async () => {
    tempDir = createTempDir();
    store = new UnifiedStore({ rootDir: tempDir });
    await store.initialize();
  });

  afterEach(async () => {
    if (store) await store.close();
    cleanupTempDir(tempDir);
  });

  describe('Test Files', () => {
    it('should add and retrieve test files', async () => {
      const testFile = {
        file: 'src/__tests__/user.test.ts',
        test_framework: 'vitest',
        test_count: 15,
        last_run: new Date().toISOString(),
        status: 'passed',
      };

      await store.testTopology.addTestFile(testFile);
      const retrieved = await store.testTopology.getTestFile('src/__tests__/user.test.ts');

      expect(retrieved).not.toBeNull();
      expect(retrieved!.test_framework).toBe('vitest');
      expect(retrieved!.test_count).toBe(15);
    });

    it('should get all test files', async () => {
      const files = [
        { file: 'test1.test.ts', test_framework: 'vitest', test_count: 10, last_run: null, status: 'unknown' },
        { file: 'test2.test.ts', test_framework: 'jest', test_count: 20, last_run: null, status: 'unknown' },
        { file: 'test3.spec.ts', test_framework: 'vitest', test_count: 5, last_run: null, status: 'unknown' },
      ];

      for (const file of files) {
        await store.testTopology.addTestFile(file);
      }

      const allFiles = await store.testTopology.getTestFiles();
      expect(allFiles.length).toBe(3);
    });
  });

  describe('Coverage', () => {
    it('should add and retrieve coverage', async () => {
      const coverage = {
        test_file: 'src/__tests__/user.test.ts',
        source_file: 'src/services/user.ts',
        function_id: 'func-getUserById',
        coverage_type: 'unit' as const,
        confidence: 0.95,
      };

      await store.testTopology.addCoverage(coverage);
      const retrieved = await store.testTopology.getCoverage('src/services/user.ts');

      expect(retrieved.length).toBe(1);
      expect(retrieved[0].coverage_type).toBe('unit');
    });

    it('should handle all coverage types', async () => {
      const types: Array<'unit' | 'integration' | 'e2e'> = ['unit', 'integration', 'e2e'];
      
      for (const type of types) {
        await store.testTopology.addCoverage({
          test_file: `${type}.test.ts`,
          source_file: 'src/target.ts',
          function_id: `func-${type}`,
          coverage_type: type,
          confidence: 0.9,
        });
      }

      const coverage = await store.testTopology.getCoverage('src/target.ts');
      expect(coverage.length).toBe(3);
    });

    it('should get tests for a source file', async () => {
      await store.testTopology.addCoverage({
        test_file: 'test1.test.ts',
        source_file: 'src/service.ts',
        function_id: null,
        coverage_type: 'unit',
        confidence: 1.0,
      });

      await store.testTopology.addCoverage({
        test_file: 'test2.test.ts',
        source_file: 'src/service.ts',
        function_id: null,
        coverage_type: 'integration',
        confidence: 0.9,
      });

      const tests = await store.testTopology.getTestsForFile('src/service.ts');
      expect(tests.length).toBe(2);
      expect(tests).toContain('test1.test.ts');
      expect(tests).toContain('test2.test.ts');
    });
  });

  describe('Uncovered Files', () => {
    it('should find uncovered source files', async () => {
      // Add some functions (source files)
      await store.callGraph.addFunction({
        id: 'covered-func',
        name: 'coveredFunc',
        qualified_name: null,
        file: 'src/covered.ts',
        start_line: 1,
        end_line: 10,
        language: 'typescript',
        is_exported: 1,
        is_entry_point: 0,
        is_data_accessor: 0,
        is_constructor: 0,
        is_async: 0,
        decorators: null,
        parameters: null,
        signature: null,
      });

      await store.callGraph.addFunction({
        id: 'uncovered-func',
        name: 'uncoveredFunc',
        qualified_name: null,
        file: 'src/uncovered.ts',
        start_line: 1,
        end_line: 10,
        language: 'typescript',
        is_exported: 1,
        is_entry_point: 0,
        is_data_accessor: 0,
        is_constructor: 0,
        is_async: 0,
        decorators: null,
        parameters: null,
        signature: null,
      });

      // Add coverage for only one file
      await store.testTopology.addCoverage({
        test_file: 'covered.test.ts',
        source_file: 'src/covered.ts',
        function_id: 'covered-func',
        coverage_type: 'unit',
        confidence: 1.0,
      });

      const uncovered = await store.testTopology.getUncoveredFiles();
      expect(uncovered).toContain('src/uncovered.ts');
      expect(uncovered).not.toContain('src/covered.ts');
    });
  });
});
