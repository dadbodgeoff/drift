/**
 * CLI Integration Tests - Verify SQLite backend works with CLI commands
 * 
 * This test suite validates that the SQLite storage layer integrates
 * correctly with CLI command patterns and produces expected outputs.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { UnifiedStore } from '../unified-store.js';
import { HybridPatternStore } from '../hybrid-pattern-store.js';
import type { Pattern, PatternCategory, PatternStatus } from '../../store/types.js';

// ============================================================================
// Test Utilities
// ============================================================================

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'drift-cli-test-'));
}

function cleanupTempDir(dir: string): void {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function generateId(): string {
  return Math.random().toString(36).substring(2, 18);
}

function createTestPattern(overrides: Partial<Pattern> = {}): Pattern {
  const id = generateId();
  const now = new Date().toISOString();
  return {
    id,
    name: `Test Pattern ${id}`,
    description: 'A test pattern',
    category: 'api' as PatternCategory,
    subcategory: 'http',
    status: 'discovered' as PatternStatus,
    confidence: { score: 0.85, level: 'high', frequency: 0.9, consistency: 0.8, age: 0.7, spread: 5 },
    detector: { type: 'ast', config: { language: 'typescript' } },
    severity: 'info',
    autoFixable: false,
    locations: [{ file: 'src/test.ts', line: 10, column: 5 }],
    outliers: [],
    metadata: { firstSeen: now, lastSeen: now },
    ...overrides,
  };
}


// ============================================================================
// CLI Command Simulation Tests
// ============================================================================

describe('CLI Command Integration Tests', () => {
  let tempDir: string;
  let store: UnifiedStore;
  let patternStore: HybridPatternStore;

  beforeEach(async () => {
    tempDir = createTempDir();
    store = new UnifiedStore({ rootDir: tempDir });
    await store.initialize();
    patternStore = new HybridPatternStore({ rootDir: tempDir, sqliteOnly: true });
    await patternStore.initialize();
  });

  afterEach(async () => {
    if (patternStore) await patternStore.close();
    if (store) await store.close();
    cleanupTempDir(tempDir);
  });

  describe('drift init', () => {
    it('should create drift.db file', () => {
      const dbPath = path.join(tempDir, '.drift', 'drift.db');
      expect(fs.existsSync(dbPath)).toBe(true);
    });

    it('should create all required tables', () => {
      const db = store.getDatabase();
      const tables = db.prepare(`
        SELECT name FROM sqlite_master 
        WHERE type='table' AND name NOT LIKE 'sqlite_%'
      `).all() as Array<{ name: string }>;
      
      const tableNames = tables.map(t => t.name);
      
      // Core tables
      expect(tableNames).toContain('patterns');
      expect(tableNames).toContain('contracts');
      expect(tableNames).toContain('constraints');
      expect(tableNames).toContain('functions');
      expect(tableNames).toContain('data_models');
      expect(tableNames).toContain('env_variables');
      expect(tableNames).toContain('audit_snapshots');
      expect(tableNames).toContain('sync_log');
    });
  });

  describe('drift scan (pattern storage)', () => {
    it('should store discovered patterns', async () => {
      // Simulate scan storing patterns
      await patternStore.add(createTestPattern({ id: 'scan-1', status: 'discovered' }));
      await patternStore.add(createTestPattern({ id: 'scan-2', status: 'discovered' }));
      await patternStore.add(createTestPattern({ id: 'scan-3', status: 'discovered' }));

      const discovered = patternStore.getDiscovered();
      expect(discovered.length).toBe(3);
    });

    it('should update existing patterns on rescan', async () => {
      await patternStore.add(createTestPattern({ 
        id: 'rescan-1', 
        name: 'Original Name',
        confidence: { score: 0.5, level: 'medium', frequency: 0, consistency: 0, age: 0, spread: 0 }
      }));

      // Simulate rescan updating the pattern
      await patternStore.update('rescan-1', {
        name: 'Updated Name',
        confidence: { score: 0.8, level: 'high', frequency: 0.9, consistency: 0.85, age: 0.7, spread: 10 }
      });

      const pattern = patternStore.get('rescan-1');
      expect(pattern?.name).toBe('Updated Name');
      expect(pattern?.confidence.score).toBe(0.8);
    });
  });


  describe('drift status', () => {
    it('should return correct status summary', async () => {
      // Add patterns with different statuses
      for (let i = 0; i < 10; i++) {
        await patternStore.add(createTestPattern({ id: `status-d-${i}`, status: 'discovered' }));
      }
      for (let i = 0; i < 5; i++) {
        await patternStore.add(createTestPattern({ id: `status-a-${i}`, status: 'approved' }));
      }
      for (let i = 0; i < 2; i++) {
        await patternStore.add(createTestPattern({ id: `status-i-${i}`, status: 'ignored' }));
      }

      const stats = patternStore.getStats();

      // Verify counts match what CLI would display
      expect(stats.totalPatterns).toBe(17);
      expect(stats.byStatus.discovered).toBe(10);
      expect(stats.byStatus.approved).toBe(5);
      expect(stats.byStatus.ignored).toBe(2);
    });

    it('should return correct category breakdown', async () => {
      await patternStore.add(createTestPattern({ id: 'cat-api-1', category: 'api' }));
      await patternStore.add(createTestPattern({ id: 'cat-api-2', category: 'api' }));
      await patternStore.add(createTestPattern({ id: 'cat-sec-1', category: 'security' }));
      await patternStore.add(createTestPattern({ id: 'cat-err-1', category: 'errors' }));
      await patternStore.add(createTestPattern({ id: 'cat-log-1', category: 'logging' }));

      const stats = patternStore.getStats();

      expect(stats.byCategory.api).toBe(2);
      expect(stats.byCategory.security).toBe(1);
      expect(stats.byCategory.errors).toBe(1);
      expect(stats.byCategory.logging).toBe(1);
    });
  });

  describe('drift approve', () => {
    it('should change pattern status to approved', async () => {
      await patternStore.add(createTestPattern({ id: 'approve-1', status: 'discovered' }));

      const approved = await patternStore.approve('approve-1', 'test-user');

      expect(approved.status).toBe('approved');
      expect(approved.metadata.approvedBy).toBe('test-user');
      expect(approved.metadata.approvedAt).toBeDefined();
    });

    it('should update getApproved() results', async () => {
      await patternStore.add(createTestPattern({ id: 'approve-2', status: 'discovered' }));
      
      expect(patternStore.getApproved().length).toBe(0);
      
      await patternStore.approve('approve-2', 'admin');
      
      expect(patternStore.getApproved().length).toBe(1);
      expect(patternStore.getDiscovered().length).toBe(0);
    });
  });

  describe('drift ignore', () => {
    it('should change pattern status to ignored', async () => {
      await patternStore.add(createTestPattern({ id: 'ignore-1', status: 'discovered' }));

      const ignored = await patternStore.ignore('ignore-1');

      expect(ignored.status).toBe('ignored');
    });

    it('should update getIgnored() results', async () => {
      await patternStore.add(createTestPattern({ id: 'ignore-2', status: 'discovered' }));
      
      expect(patternStore.getIgnored().length).toBe(0);
      
      await patternStore.ignore('ignore-2');
      
      expect(patternStore.getIgnored().length).toBe(1);
    });
  });


  describe('drift where (pattern locations)', () => {
    it('should return all locations for a pattern', async () => {
      const pattern = createTestPattern({
        id: 'where-1',
        locations: [
          { file: 'src/api/users.ts', line: 10, column: 5 },
          { file: 'src/api/posts.ts', line: 20, column: 3 },
          { file: 'src/api/comments.ts', line: 30, column: 8 },
        ],
      });
      await patternStore.add(pattern);

      const retrieved = patternStore.get('where-1');
      expect(retrieved?.locations.length).toBe(3);
      expect(retrieved?.locations[0].file).toBe('src/api/users.ts');
    });
  });

  describe('drift files (patterns by file)', () => {
    it('should return patterns for a specific file', async () => {
      await patternStore.add(createTestPattern({
        id: 'file-1',
        locations: [{ file: 'src/target.ts', line: 10, column: 0 }],
      }));
      await patternStore.add(createTestPattern({
        id: 'file-2',
        locations: [{ file: 'src/target.ts', line: 20, column: 0 }],
      }));
      await patternStore.add(createTestPattern({
        id: 'file-3',
        locations: [{ file: 'src/other.ts', line: 10, column: 0 }],
      }));

      const result = patternStore.query({ filter: { file: 'src/target.ts' } });
      expect(result.patterns.length).toBe(2);
    });
  });

  describe('drift export db', () => {
    it('should export to JSON format', async () => {
      await patternStore.add(createTestPattern({ id: 'export-1', name: 'Export Test' }));

      const exported = await store.export('json');
      const data = JSON.parse(exported.toString());

      expect(data.version).toBe('1.0.0');
      expect(data.patterns).toBeDefined();
      expect(data.patterns.length).toBeGreaterThan(0);
    });

    it('should export to SQLite format', async () => {
      await patternStore.add(createTestPattern({ id: 'export-sqlite' }));

      const exported = await store.export('sqlite');

      expect(exported.length).toBeGreaterThan(0);
      expect(exported.toString('utf8', 0, 16)).toContain('SQLite format 3');
    });
  });

  describe('drift trends (audit history)', () => {
    it('should store and retrieve audit snapshots', async () => {
      const today = new Date().toISOString().split('T')[0];
      
      await store.audit.addSnapshot({
        date: today,
        scan_hash: 'abc123',
        health_score: 85,
        total_patterns: 100,
        auto_approve_eligible: 20,
        flagged_for_review: 5,
        likely_false_positives: 3,
        duplicate_candidates: 2,
        avg_confidence: 0.82,
        cross_validation_score: 0.9,
        summary: '{"api":30,"security":25}',
      });

      const snapshot = await store.audit.getSnapshot(today);
      expect(snapshot).not.toBeNull();
      expect(snapshot!.health_score).toBe(85);
    });

    it('should store and retrieve health trends', async () => {
      const today = new Date().toISOString().split('T')[0];
      
      await store.audit.addTrend({
        date: today,
        health_score: 85,
        avg_confidence: 0.82,
        total_patterns: 100,
        approved_count: 60,
        duplicate_groups: 5,
        cross_validation_score: 0.9,
      });

      const trends = await store.audit.getTrends(7);
      expect(trends.length).toBeGreaterThan(0);
      expect(trends[0].health_score).toBe(85);
    });
  });


  describe('drift boundaries', () => {
    it('should store and retrieve data models', async () => {
      await store.boundaries.addModel({
        name: 'User',
        table_name: 'users',
        file: 'src/models/user.ts',
        line: 10,
        framework: 'prisma',
        confidence: 0.95,
        fields: '["id","email","name","createdAt"]',
      });

      const model = await store.boundaries.getModelByTable('users');
      expect(model).not.toBeNull();
      expect(model!.name).toBe('User');
      expect(model!.framework).toBe('prisma');
    });

    it('should store and retrieve sensitive fields', async () => {
      await store.boundaries.addSensitiveField({
        table_name: 'users',
        field_name: 'password_hash',
        sensitivity: 'auth',
        reason: 'Contains hashed password',
      });

      const fields = await store.boundaries.getSensitiveFields('users');
      expect(fields.length).toBe(1);
      expect(fields[0].sensitivity).toBe('auth');
    });

    it('should store and retrieve access points', async () => {
      await store.boundaries.addAccessPoint({
        id: 'ap-1',
        table_name: 'users',
        operation: 'read',
        file: 'src/services/user.ts',
        line: 25,
        column_num: 10,
        context: 'getUserById',
        fields: '["id","email"]',
        is_raw_sql: 0,
        confidence: 0.9,
        function_id: null,
      });

      const points = await store.boundaries.getAccessPoints('users');
      expect(points.length).toBe(1);
      expect(points[0].operation).toBe('read');
    });
  });

  describe('drift callgraph', () => {
    it('should store and retrieve functions', async () => {
      await store.callGraph.addFunction({
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
      });

      const func = await store.callGraph.getFunction('func-1');
      expect(func).not.toBeNull();
      expect(func!.name).toBe('getUserById');
      expect(func!.is_async).toBe(1);
    });

    it('should store and retrieve call relationships', async () => {
      await store.callGraph.addFunction({
        id: 'caller',
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
        id: 'callee',
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

      await store.callGraph.addCall({
        caller_id: 'caller',
        callee_id: 'callee',
        callee_name: 'getUser',
        line: 10,
        column_num: 5,
        resolved: 1,
        confidence: 0.95,
        argument_count: 1,
      });

      const callers = await store.callGraph.getCallers('callee');
      expect(callers.length).toBe(1);
      expect(callers[0].caller_id).toBe('caller');
    });
  });


  describe('drift constraints', () => {
    it('should store and retrieve constraints', async () => {
      await store.constraints.create({
        id: 'constraint-1',
        name: 'No Raw SQL',
        description: 'Prevent raw SQL queries',
        category: 'security',
        status: 'discovered',
        language: 'typescript',
        invariant: '{"type":"no-raw-sql"}',
        scope: null,
        enforcement_level: 'error',
        enforcement_message: 'Use parameterized queries',
        enforcement_autofix: null,
        confidence_score: 0.9,
        confidence_evidence: 10,
        confidence_violations: 2,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        approved_at: null,
        approved_by: null,
        ignored_at: null,
        ignore_reason: null,
        tags: '["security","sql"]',
        notes: null,
      });

      const constraint = await store.constraints.read('constraint-1');
      expect(constraint).not.toBeNull();
      expect(constraint!.name).toBe('No Raw SQL');
    });

    it('should approve constraints', async () => {
      await store.constraints.create({
        id: 'constraint-approve',
        name: 'Test Constraint',
        description: null,
        category: 'api',
        status: 'discovered',
        language: 'all',
        invariant: '{}',
        scope: null,
        enforcement_level: 'warning',
        enforcement_message: null,
        enforcement_autofix: null,
        confidence_score: 0.5,
        confidence_evidence: 0,
        confidence_violations: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        approved_at: null,
        approved_by: null,
        ignored_at: null,
        ignore_reason: null,
        tags: null,
        notes: null,
      });

      await store.constraints.approve('constraint-approve', 'admin');

      const constraint = await store.constraints.read('constraint-approve');
      expect(constraint!.status).toBe('approved');
      expect(constraint!.approved_by).toBe('admin');
    });
  });

  describe('drift env', () => {
    it('should store and retrieve env variables', async () => {
      await store.environment.addVariable({
        name: 'DATABASE_URL',
        sensitivity: 'credential',
        has_default: 0,
        is_required: 1,
        default_value: null,
      });

      const variable = await store.environment.getVariable('DATABASE_URL');
      expect(variable).not.toBeNull();
      expect(variable!.sensitivity).toBe('credential');
      expect(variable!.is_required).toBe(1);
    });

    it('should get secrets', async () => {
      await store.environment.addVariable({
        name: 'API_KEY',
        sensitivity: 'secret',
        has_default: 0,
        is_required: 1,
        default_value: null,
      });

      await store.environment.addVariable({
        name: 'LOG_LEVEL',
        sensitivity: 'config',
        has_default: 1,
        is_required: 0,
        default_value: 'info',
      });

      const secrets = await store.environment.getSecrets();
      expect(secrets.length).toBe(1);
      expect(secrets[0].name).toBe('API_KEY');
    });
  });

  describe('drift dna', () => {
    it('should store and retrieve DNA profile', async () => {
      await store.dna.saveProfile({
        version: '1.0.0',
        generated_at: new Date().toISOString(),
        health_score: 85,
        genetic_diversity: 0.75,
        summary: '{"variant-handling":"tailwind"}',
      });

      const profile = await store.dna.getProfile();
      expect(profile).not.toBeNull();
      expect(profile!.health_score).toBe(85);
    });

    it('should store and retrieve genes', async () => {
      await store.dna.addGene({
        id: 'variant-handling',
        name: 'Variant Handling',
        dominant_variant: 'tailwind',
        frequency: 0.85,
        confidence: 0.9,
        variants: '["tailwind","css-modules"]',
        evidence: '["src/Button.tsx:15"]',
      });

      const gene = await store.dna.getGene('variant-handling');
      expect(gene).not.toBeNull();
      expect(gene!.dominant_variant).toBe('tailwind');
    });
  });
});

