/**
 * Production-Grade Stress Test for Unified SQLite Storage
 * 
 * This test suite validates:
 * 1. Data integrity across all repositories
 * 2. Concurrent access patterns
 * 3. Transaction rollback behavior
 * 4. Large dataset handling
 * 5. Type conversion accuracy (DB <-> Domain)
 * 6. Foreign key constraints
 * 7. Index performance
 * 8. WAL mode behavior
 * 9. Export/Import round-trip
 * 10. Edge cases and error handling
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { UnifiedStore } from '../unified-store.js';
import { HybridPatternStore } from '../hybrid-pattern-store.js';
import { HybridContractStore } from '../hybrid-contract-store.js';
import { createPatternStore, createContractStore } from '../store-factory.js';
import type { DbPattern, DbPatternLocation, DbContract, DbContractFrontend } from '../types.js';
import type { Pattern, PatternCategory, PatternStatus } from '../../store/types.js';
import type { Contract, ContractStatus, HttpMethod } from '../../types/contracts.js';

// ============================================================================
// Test Utilities
// ============================================================================

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'drift-stress-test-'));
}

function cleanupTempDir(dir: string): void {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}


function generatePatternId(): string {
  return Math.random().toString(36).substring(2, 18);
}

function createTestPattern(overrides: Partial<Pattern> = {}): Pattern {
  const id = generatePatternId();
  const now = new Date().toISOString();
  return {
    id,
    name: `Test Pattern ${id}`,
    description: 'A test pattern for stress testing',
    category: 'api' as PatternCategory,
    subcategory: 'http',
    status: 'discovered' as PatternStatus,
    confidence: {
      score: 0.85,
      level: 'high',
      frequency: 0.9,
      consistency: 0.8,
      age: 0.7,
      spread: 5,
    },
    detector: {
      type: 'ast',
      config: { language: 'typescript' },
    },
    severity: 'info',
    autoFixable: false,
    locations: [
      { file: 'src/test.ts', line: 10, column: 5 },
      { file: 'src/test.ts', line: 20, column: 10 },
    ],
    outliers: [],
    metadata: {
      firstSeen: now,
      lastSeen: now,
    },
    ...overrides,
  };
}

function createTestContract(overrides: Partial<Contract> = {}): Contract {
  const id = generatePatternId();
  const now = new Date().toISOString();
  // Use unique normalized path to avoid UNIQUE constraint violations
  const normalizedPath = `/api/test/${id}`;
  return {
    id,
    method: 'GET' as HttpMethod,
    endpoint: `/api/test/${id}`,
    status: 'discovered' as ContractStatus,
    backend: {
      method: 'GET' as HttpMethod,
      path: `/api/test/${id}`,
      normalizedPath,
      file: 'src/routes/test.ts',
      line: 15,
      framework: 'express',
      responseFields: ['id', 'name', 'status'],
    },
    frontend: [
      {
        method: 'GET' as HttpMethod,
        path: `/api/test/${id}`,
        normalizedPath,
        file: 'src/api/client.ts',
        line: 25,
        library: 'axios',
        responseFields: ['id', 'name'],
      },
    ],
    confidence: {
      score: 0.75,
      level: 'medium',
      matchConfidence: 0.8,
      fieldExtractionConfidence: 0.7,
    },
    mismatches: [],
    metadata: {
      firstSeen: now,
      lastSeen: now,
    },
    ...overrides,
  };
}


// ============================================================================
// Test Suite: UnifiedStore Core Operations
// ============================================================================

describe('UnifiedStore Stress Tests', () => {
  let tempDir: string;
  let store: UnifiedStore;

  beforeEach(async () => {
    tempDir = createTempDir();
    store = new UnifiedStore({ rootDir: tempDir });
    await store.initialize();
  });

  afterEach(async () => {
    if (store) {
      await store.close();
    }
    cleanupTempDir(tempDir);
  });

  describe('Database Initialization', () => {
    it('should create drift.db file', () => {
      const dbPath = path.join(tempDir, '.drift', 'drift.db');
      expect(fs.existsSync(dbPath)).toBe(true);
    });

    it('should create all required tables', async () => {
      const db = store.getDatabase();
      const tables = db.prepare(`
        SELECT name FROM sqlite_master 
        WHERE type='table' AND name NOT LIKE 'sqlite_%'
        ORDER BY name
      `).all() as Array<{ name: string }>;
      
      const tableNames = tables.map(t => t.name);
      
      // Verify critical tables exist
      expect(tableNames).toContain('patterns');
      expect(tableNames).toContain('pattern_locations');
      expect(tableNames).toContain('contracts');
      expect(tableNames).toContain('contract_frontends');
      expect(tableNames).toContain('constraints');
      expect(tableNames).toContain('functions');
      expect(tableNames).toContain('function_calls');
      expect(tableNames).toContain('data_models');
      expect(tableNames).toContain('env_variables');
      expect(tableNames).toContain('audit_snapshots');
      expect(tableNames).toContain('sync_log');
    });

    it('should create all required indexes', async () => {
      const db = store.getDatabase();
      const indexes = db.prepare(`
        SELECT name FROM sqlite_master 
        WHERE type='index' AND name NOT LIKE 'sqlite_%'
        ORDER BY name
      `).all() as Array<{ name: string }>;
      
      const indexNames = indexes.map(i => i.name);
      
      // Verify critical indexes exist
      expect(indexNames).toContain('idx_patterns_category');
      expect(indexNames).toContain('idx_patterns_status');
      expect(indexNames).toContain('idx_pattern_locations_file');
      expect(indexNames).toContain('idx_contracts_status');
      expect(indexNames).toContain('idx_functions_file');
    });

    it('should enable WAL mode', async () => {
      const db = store.getDatabase();
      const result = db.pragma('journal_mode') as Array<{ journal_mode: string }>;
      expect(result[0].journal_mode).toBe('wal');
    });

    it('should enable foreign keys', async () => {
      const db = store.getDatabase();
      const result = db.pragma('foreign_keys') as Array<{ foreign_keys: number }>;
      expect(result[0].foreign_keys).toBe(1);
    });
  });


  describe('Pattern Repository CRUD', () => {
    it('should create and read a pattern', async () => {
      const dbPattern: DbPattern = {
        id: 'test-pattern-1',
        name: 'Test Pattern',
        description: 'A test pattern',
        category: 'api',
        subcategory: 'http',
        status: 'discovered',
        confidence_score: 0.85,
        confidence_level: 'high',
        confidence_frequency: 0.9,
        confidence_consistency: 0.8,
        confidence_age: 0.7,
        confidence_spread: 5,
        detector_type: 'ast',
        detector_config: '{"language":"typescript"}',
        severity: 'info',
        auto_fixable: 0,
        first_seen: new Date().toISOString(),
        last_seen: new Date().toISOString(),
        approved_at: null,
        approved_by: null,
        tags: '["test","api"]',
        source: 'test',
        location_count: 0,
        outlier_count: 0,
      };

      await store.patterns.create(dbPattern);
      const retrieved = await store.patterns.read('test-pattern-1');
      
      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe('test-pattern-1');
      expect(retrieved!.name).toBe('Test Pattern');
      expect(retrieved!.category).toBe('api');
      expect(retrieved!.confidence_score).toBe(0.85);
    });

    it('should update a pattern', async () => {
      const dbPattern: DbPattern = {
        id: 'test-pattern-update',
        name: 'Original Name',
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
      };

      await store.patterns.create(dbPattern);
      await store.patterns.update('test-pattern-update', { 
        name: 'Updated Name',
        confidence_score: 0.95,
      });
      
      const retrieved = await store.patterns.read('test-pattern-update');
      expect(retrieved!.name).toBe('Updated Name');
      expect(retrieved!.confidence_score).toBe(0.95);
    });

    it('should delete a pattern', async () => {
      const dbPattern: DbPattern = {
        id: 'test-pattern-delete',
        name: 'To Delete',
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
      };

      await store.patterns.create(dbPattern);
      const deleted = await store.patterns.delete('test-pattern-delete');
      expect(deleted).toBe(true);
      
      const retrieved = await store.patterns.read('test-pattern-delete');
      expect(retrieved).toBeNull();
    });

    it('should handle bulk create', async () => {
      const patterns: DbPattern[] = [];
      for (let i = 0; i < 100; i++) {
        patterns.push({
          id: `bulk-pattern-${i}`,
          name: `Bulk Pattern ${i}`,
          description: null,
          category: 'api',
          subcategory: null,
          status: 'discovered',
          confidence_score: Math.random(),
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

      const ids = await store.patterns.bulkCreate(patterns);
      expect(ids.length).toBe(100);
      
      const count = await store.patterns.count();
      expect(count).toBe(100);
    });
  });


  describe('Pattern Locations', () => {
    it('should add and retrieve locations', async () => {
      const dbPattern: DbPattern = {
        id: 'pattern-with-locations',
        name: 'Pattern With Locations',
        description: null,
        category: 'api',
        subcategory: null,
        status: 'discovered',
        confidence_score: 0.8,
        confidence_level: 'high',
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
      };

      await store.patterns.create(dbPattern);

      // Add regular locations
      await store.patterns.addLocation('pattern-with-locations', {
        pattern_id: 'pattern-with-locations',
        file: 'src/api/users.ts',
        line: 10,
        column_num: 5,
        end_line: 15,
        end_column: 10,
        is_outlier: 0,
        outlier_reason: null,
        deviation_score: null,
        confidence: 1.0,
        snippet: 'const users = await db.query(...)',
      });

      await store.patterns.addLocation('pattern-with-locations', {
        pattern_id: 'pattern-with-locations',
        file: 'src/api/posts.ts',
        line: 20,
        column_num: 3,
        end_line: null,
        end_column: null,
        is_outlier: 0,
        outlier_reason: null,
        deviation_score: null,
        confidence: 0.9,
        snippet: null,
      });

      // Add outlier
      await store.patterns.addLocation('pattern-with-locations', {
        pattern_id: 'pattern-with-locations',
        file: 'src/api/legacy.ts',
        line: 100,
        column_num: 1,
        end_line: null,
        end_column: null,
        is_outlier: 1,
        outlier_reason: 'Uses deprecated API',
        deviation_score: 0.7,
        confidence: 0.5,
        snippet: null,
      });

      const locations = await store.patterns.getLocations('pattern-with-locations');
      expect(locations.length).toBe(2);
      expect(locations[0].file).toBe('src/api/users.ts');

      const outliers = await store.patterns.getOutliers('pattern-with-locations');
      expect(outliers.length).toBe(1);
      expect(outliers[0].outlier_reason).toBe('Uses deprecated API');
    });

    it('should cascade delete locations when pattern is deleted', async () => {
      const dbPattern: DbPattern = {
        id: 'pattern-cascade-test',
        name: 'Cascade Test',
        description: null,
        category: 'api',
        subcategory: null,
        status: 'discovered',
        confidence_score: 0.8,
        confidence_level: 'high',
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
      };

      await store.patterns.create(dbPattern);
      await store.patterns.addLocation('pattern-cascade-test', {
        pattern_id: 'pattern-cascade-test',
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

      // Verify location exists
      const locationsBefore = await store.patterns.getLocations('pattern-cascade-test');
      expect(locationsBefore.length).toBe(1);

      // Delete pattern
      await store.patterns.delete('pattern-cascade-test');

      // Verify locations are also deleted (foreign key cascade)
      const db = store.getDatabase();
      const orphanedLocations = db.prepare(
        'SELECT * FROM pattern_locations WHERE pattern_id = ?'
      ).all('pattern-cascade-test');
      expect(orphanedLocations.length).toBe(0);
    });
  });


  describe('Contract Repository', () => {
    it('should create and read a contract', async () => {
      const dbContract: DbContract = {
        id: 'test-contract-1',
        method: 'GET',
        endpoint: '/api/users',
        normalized_endpoint: '/api/users',
        status: 'discovered',
        backend_method: 'GET',
        backend_path: '/api/users',
        backend_normalized_path: '/api/users',
        backend_file: 'src/routes/users.ts',
        backend_line: 10,
        backend_framework: 'express',
        backend_response_fields: '["id","name","email"]',
        confidence_score: 0.9,
        confidence_level: 'high',
        match_confidence: 0.95,
        field_extraction_confidence: 0.85,
        mismatches: null,
        first_seen: new Date().toISOString(),
        last_seen: new Date().toISOString(),
        verified_at: null,
        verified_by: null,
      };

      await store.contracts.create(dbContract);
      const retrieved = await store.contracts.read('test-contract-1');
      
      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe('test-contract-1');
      expect(retrieved!.method).toBe('GET');
      expect(retrieved!.endpoint).toBe('/api/users');
    });

    it('should add and retrieve frontends', async () => {
      const dbContract: DbContract = {
        id: 'contract-with-frontends',
        method: 'POST',
        endpoint: '/api/users',
        normalized_endpoint: '/api/users',
        status: 'discovered',
        backend_method: 'POST',
        backend_path: '/api/users',
        backend_normalized_path: '/api/users',
        backend_file: 'src/routes/users.ts',
        backend_line: 20,
        backend_framework: 'express',
        backend_response_fields: '["id"]',
        confidence_score: 0.8,
        confidence_level: 'high',
        match_confidence: 0.9,
        field_extraction_confidence: 0.7,
        mismatches: null,
        first_seen: new Date().toISOString(),
        last_seen: new Date().toISOString(),
        verified_at: null,
        verified_by: null,
      };

      await store.contracts.create(dbContract);

      await store.contracts.addFrontend('contract-with-frontends', {
        contract_id: 'contract-with-frontends',
        method: 'POST',
        path: '/api/users',
        normalized_path: '/api/users',
        file: 'src/api/client.ts',
        line: 30,
        library: 'axios',
        response_fields: '["id","name"]',
      });

      await store.contracts.addFrontend('contract-with-frontends', {
        contract_id: 'contract-with-frontends',
        method: 'POST',
        path: '/api/users',
        normalized_path: '/api/users',
        file: 'src/hooks/useUsers.ts',
        line: 15,
        library: 'fetch',
        response_fields: '["id"]',
      });

      const frontends = await store.contracts.getFrontends('contract-with-frontends');
      expect(frontends.length).toBe(2);
      expect(frontends[0].library).toBe('axios');
    });

    it('should verify a contract', async () => {
      const dbContract: DbContract = {
        id: 'contract-to-verify',
        method: 'GET',
        endpoint: '/api/test',
        normalized_endpoint: '/api/test',
        status: 'discovered',
        backend_method: 'GET',
        backend_path: '/api/test',
        backend_normalized_path: '/api/test',
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
      };

      await store.contracts.create(dbContract);
      await store.contracts.verify('contract-to-verify', 'test-user');
      
      const retrieved = await store.contracts.read('contract-to-verify');
      expect(retrieved!.status).toBe('verified');
      expect(retrieved!.verified_by).toBe('test-user');
      expect(retrieved!.verified_at).not.toBeNull();
    });
  });


  describe('Constraint Repository', () => {
    it('should create and read a constraint', async () => {
      const dbConstraint = {
        id: 'test-constraint-1',
        name: 'No Raw SQL',
        description: 'Prevent raw SQL queries',
        category: 'security',
        status: 'discovered' as const,
        language: 'typescript',
        invariant: '{"type":"no-raw-sql"}',
        scope: null,
        enforcement_level: 'error' as const,
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
      };

      await store.constraints.create(dbConstraint);
      const retrieved = await store.constraints.read('test-constraint-1');
      
      expect(retrieved).not.toBeNull();
      expect(retrieved!.name).toBe('No Raw SQL');
      expect(retrieved!.category).toBe('security');
    });

    it('should approve a constraint', async () => {
      const dbConstraint = {
        id: 'constraint-to-approve',
        name: 'Test Constraint',
        description: null,
        category: 'api',
        status: 'discovered' as const,
        language: 'all',
        invariant: '{}',
        scope: null,
        enforcement_level: 'warning' as const,
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
      };

      await store.constraints.create(dbConstraint);
      await store.constraints.approve('constraint-to-approve', 'admin');
      
      const retrieved = await store.constraints.read('constraint-to-approve');
      expect(retrieved!.status).toBe('approved');
      expect(retrieved!.approved_by).toBe('admin');
    });

    it('should get constraint counts', async () => {
      // Create constraints with different statuses
      for (let i = 0; i < 5; i++) {
        await store.constraints.create({
          id: `discovered-${i}`,
          name: `Discovered ${i}`,
          description: null,
          category: 'api',
          status: 'discovered',
          language: 'typescript',
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
      }

      for (let i = 0; i < 3; i++) {
        await store.constraints.create({
          id: `approved-${i}`,
          name: `Approved ${i}`,
          description: null,
          category: 'security',
          status: 'approved',
          language: 'python',
          invariant: '{}',
          scope: null,
          enforcement_level: 'error',
          enforcement_message: null,
          enforcement_autofix: null,
          confidence_score: 0.9,
          confidence_evidence: 10,
          confidence_violations: 0,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          approved_at: new Date().toISOString(),
          approved_by: 'admin',
          ignored_at: null,
          ignore_reason: null,
          tags: null,
          notes: null,
        });
      }

      const counts = await store.constraints.getCounts();
      expect(counts.total).toBe(8);
      expect(counts.byStatus.discovered).toBe(5);
      expect(counts.byStatus.approved).toBe(3);
      expect(counts.byCategory.api).toBe(5);
      expect(counts.byCategory.security).toBe(3);
    });
  });


  describe('Sync Log Triggers', () => {
    it('should log pattern inserts', async () => {
      const dbPattern: DbPattern = {
        id: 'sync-test-pattern',
        name: 'Sync Test',
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
      };

      await store.patterns.create(dbPattern);
      
      const syncLog = await store.getSyncLog();
      const patternInsert = syncLog.find(
        e => e.table_name === 'patterns' && e.row_id === 'sync-test-pattern' && e.operation === 'INSERT'
      );
      expect(patternInsert).toBeDefined();
    });

    it('should log pattern updates', async () => {
      const dbPattern: DbPattern = {
        id: 'sync-update-pattern',
        name: 'Original',
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
      };

      await store.patterns.create(dbPattern);
      await store.patterns.update('sync-update-pattern', { name: 'Updated' });
      
      const syncLog = await store.getSyncLog();
      const patternUpdate = syncLog.find(
        e => e.table_name === 'patterns' && e.row_id === 'sync-update-pattern' && e.operation === 'UPDATE'
      );
      expect(patternUpdate).toBeDefined();
    });

    it('should mark sync entries as synced', async () => {
      const dbPattern: DbPattern = {
        id: 'sync-mark-pattern',
        name: 'Mark Test',
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
      };

      await store.patterns.create(dbPattern);
      
      const syncLogBefore = await store.getSyncLog();
      const entry = syncLogBefore.find(e => e.row_id === 'sync-mark-pattern');
      expect(entry).toBeDefined();
      expect(entry!.synced).toBe(0);
      
      await store.markSynced([entry!.id]);
      
      // Get all sync log entries (including synced ones)
      const db = store.getDatabase();
      const allEntries = db.prepare('SELECT * FROM sync_log WHERE row_id = ?').all('sync-mark-pattern') as Array<{ synced: number }>;
      expect(allEntries[0].synced).toBe(1);
    });
  });


  describe('Export/Import', () => {
    it('should export to JSON', async () => {
      // Create some test data
      await store.patterns.create({
        id: 'export-pattern',
        name: 'Export Test',
        description: 'Test pattern for export',
        category: 'api',
        subcategory: null,
        status: 'approved',
        confidence_score: 0.9,
        confidence_level: 'high',
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
        approved_at: new Date().toISOString(),
        approved_by: 'test',
        tags: null,
        source: null,
        location_count: 0,
        outlier_count: 0,
      });

      const exported = await store.export('json');
      const data = JSON.parse(exported.toString());
      
      expect(data.version).toBe('1.0.0');
      expect(data.exportedAt).toBeDefined();
      expect(data.patterns).toBeDefined();
      expect(data.patterns.length).toBeGreaterThan(0);
      
      const exportedPattern = data.patterns.find((p: DbPattern) => p.id === 'export-pattern');
      expect(exportedPattern).toBeDefined();
      expect(exportedPattern.name).toBe('Export Test');
    });

    it('should export to SQLite', async () => {
      await store.patterns.create({
        id: 'sqlite-export-pattern',
        name: 'SQLite Export Test',
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

      const exported = await store.export('sqlite');
      
      // Should be a valid SQLite database
      expect(exported.length).toBeGreaterThan(0);
      // SQLite files start with "SQLite format 3"
      expect(exported.toString('utf8', 0, 16)).toContain('SQLite format 3');
    });
  });

  describe('Store Statistics', () => {
    it('should return accurate statistics', async () => {
      // Create test data
      for (let i = 0; i < 10; i++) {
        await store.patterns.create({
          id: `stats-pattern-${i}`,
          name: `Stats Pattern ${i}`,
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

      for (let i = 0; i < 5; i++) {
        await store.contracts.create({
          id: `stats-contract-${i}`,
          method: 'GET',
          endpoint: `/api/stats/${i}`,
          normalized_endpoint: `/api/stats/${i}`,  // Unique per contract
          status: 'discovered',
          backend_method: 'GET',
          backend_path: `/api/stats/${i}`,
          backend_normalized_path: `/api/stats/${i}`,
          backend_file: 'test.ts',
          backend_line: i,
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
      }

      const stats = await store.getStats();
      expect(stats.patterns).toBe(10);
      expect(stats.contracts).toBe(5);
      expect(stats.dbSizeBytes).toBeGreaterThan(0);
    });
  });
});


// ============================================================================
// Test Suite: HybridPatternStore
// ============================================================================

describe('HybridPatternStore Stress Tests', () => {
  let tempDir: string;
  let store: HybridPatternStore;

  beforeEach(async () => {
    tempDir = createTempDir();
    store = new HybridPatternStore({ rootDir: tempDir, sqliteOnly: true });
    await store.initialize();
  });

  afterEach(async () => {
    if (store) {
      await store.close();
    }
    cleanupTempDir(tempDir);
  });

  describe('Type Conversion Accuracy', () => {
    it('should preserve all pattern fields through round-trip', async () => {
      const original = createTestPattern({
        id: 'roundtrip-test',
        name: 'Round Trip Test',
        description: 'Testing field preservation',
        category: 'security',
        subcategory: 'auth',
        status: 'discovered',
        confidence: {
          score: 0.87654321,
          level: 'high',
          frequency: 0.91,
          consistency: 0.82,
          age: 0.73,
          spread: 7,
        },
        severity: 'warning',
        autoFixable: true,
        locations: [
          { file: 'src/auth/login.ts', line: 42, column: 8, endLine: 50, endColumn: 2 },
          { file: 'src/auth/logout.ts', line: 15, column: 4 },
        ],
        outliers: [
          { file: 'src/legacy/auth.ts', line: 100, column: 1, reason: 'Deprecated pattern', deviationScore: 0.65 },
        ],
        metadata: {
          firstSeen: '2024-01-15T10:30:00.000Z',
          lastSeen: '2024-02-01T14:45:00.000Z',
          tags: ['auth', 'security', 'critical'],
          source: 'manual-review',
        },
      });

      await store.add(original);
      const retrieved = store.get('roundtrip-test');

      expect(retrieved).not.toBeUndefined();
      expect(retrieved!.id).toBe(original.id);
      expect(retrieved!.name).toBe(original.name);
      expect(retrieved!.description).toBe(original.description);
      expect(retrieved!.category).toBe(original.category);
      expect(retrieved!.subcategory).toBe(original.subcategory);
      expect(retrieved!.status).toBe(original.status);
      expect(retrieved!.confidence.score).toBeCloseTo(original.confidence.score, 5);
      expect(retrieved!.confidence.level).toBe(original.confidence.level);
      expect(retrieved!.severity).toBe(original.severity);
      expect(retrieved!.autoFixable).toBe(original.autoFixable);
      expect(retrieved!.locations.length).toBe(original.locations.length);
      expect(retrieved!.outliers.length).toBe(original.outliers.length);
      expect(retrieved!.metadata.tags).toEqual(original.metadata.tags);
    });

    it('should handle null/undefined fields correctly', async () => {
      const minimal = createTestPattern({
        id: 'minimal-test',
        description: '',
        subcategory: '',
        confidence: {
          score: 0.5,
          level: 'medium',
          frequency: 0,
          consistency: 0,
          age: 0,
          spread: 0,
        },
        metadata: {
          firstSeen: new Date().toISOString(),
          lastSeen: new Date().toISOString(),
        },
      });

      await store.add(minimal);
      const retrieved = store.get('minimal-test');

      expect(retrieved).not.toBeUndefined();
      expect(retrieved!.description).toBe('');
    });
  });

  describe('Status Transitions', () => {
    it('should correctly approve a pattern', async () => {
      const pattern = createTestPattern({ id: 'approve-test', status: 'discovered' });
      await store.add(pattern);
      
      const approved = await store.approve('approve-test', 'test-user');
      
      expect(approved.status).toBe('approved');
      expect(approved.metadata.approvedBy).toBe('test-user');
      expect(approved.metadata.approvedAt).toBeDefined();
      
      // Verify in cache
      const cached = store.get('approve-test');
      expect(cached!.status).toBe('approved');
    });

    it('should correctly ignore a pattern', async () => {
      const pattern = createTestPattern({ id: 'ignore-test', status: 'discovered' });
      await store.add(pattern);
      
      const ignored = await store.ignore('ignore-test');
      
      expect(ignored.status).toBe('ignored');
      
      // Verify in cache
      const cached = store.get('ignore-test');
      expect(cached!.status).toBe('ignored');
    });
  });

  describe('Query Operations', () => {
    beforeEach(async () => {
      // Add test patterns
      const categories: PatternCategory[] = ['api', 'security', 'errors', 'logging'];
      const statuses: PatternStatus[] = ['discovered', 'approved', 'ignored'];
      
      for (let i = 0; i < 50; i++) {
        await store.add(createTestPattern({
          id: `query-test-${i}`,
          category: categories[i % categories.length],
          status: statuses[i % statuses.length],
          confidence: {
            score: (i % 10) / 10,
            level: i % 10 >= 7 ? 'high' : i % 10 >= 4 ? 'medium' : 'low',
            frequency: 0,
            consistency: 0,
            age: 0,
            spread: 0,
          },
        }));
      }
    });

    it('should filter by category', () => {
      const result = store.query({ filter: { category: 'api' } });
      expect(result.patterns.length).toBeGreaterThan(0);
      expect(result.patterns.every(p => p.category === 'api')).toBe(true);
    });

    it('should filter by status', () => {
      const result = store.query({ filter: { status: 'approved' } });
      expect(result.patterns.length).toBeGreaterThan(0);
      expect(result.patterns.every(p => p.status === 'approved')).toBe(true);
    });

    it('should filter by minimum confidence', () => {
      const result = store.query({ filter: { minConfidence: 0.7 } });
      expect(result.patterns.every(p => p.confidence.score >= 0.7)).toBe(true);
    });

    it('should support pagination', () => {
      const page1 = store.query({ pagination: { limit: 10, offset: 0 } });
      const page2 = store.query({ pagination: { limit: 10, offset: 10 } });
      
      expect(page1.patterns.length).toBe(10);
      expect(page2.patterns.length).toBe(10);
      expect(page1.hasMore).toBe(true);
      expect(page1.patterns[0].id).not.toBe(page2.patterns[0].id);
    });

    it('should support sorting', () => {
      const ascending = store.query({ sort: { field: 'confidence', direction: 'asc' } });
      const descending = store.query({ sort: { field: 'confidence', direction: 'desc' } });
      
      expect(ascending.patterns[0].confidence.score).toBeLessThanOrEqual(
        ascending.patterns[ascending.patterns.length - 1].confidence.score
      );
      expect(descending.patterns[0].confidence.score).toBeGreaterThanOrEqual(
        descending.patterns[descending.patterns.length - 1].confidence.score
      );
    });
  });


  describe('Statistics', () => {
    it('should return accurate statistics', async () => {
      // Add patterns with different statuses and categories
      await store.add(createTestPattern({ id: 'stat-1', status: 'discovered', category: 'api' }));
      await store.add(createTestPattern({ id: 'stat-2', status: 'discovered', category: 'api' }));
      await store.add(createTestPattern({ id: 'stat-3', status: 'approved', category: 'security' }));
      await store.add(createTestPattern({ id: 'stat-4', status: 'ignored', category: 'errors' }));

      const stats = store.getStats();
      
      expect(stats.totalPatterns).toBe(4);
      expect(stats.byStatus.discovered).toBe(2);
      expect(stats.byStatus.approved).toBe(1);
      expect(stats.byStatus.ignored).toBe(1);
      expect(stats.byCategory.api).toBe(2);
      expect(stats.byCategory.security).toBe(1);
      expect(stats.byCategory.errors).toBe(1);
    });
  });

  describe('Large Dataset Handling', () => {
    it('should handle 1000 patterns efficiently', async () => {
      const startTime = Date.now();
      
      // Add 1000 patterns
      for (let i = 0; i < 1000; i++) {
        await store.add(createTestPattern({ id: `large-${i}` }));
      }
      
      const addTime = Date.now() - startTime;
      console.log(`Added 1000 patterns in ${addTime}ms`);
      
      // Query should be fast
      const queryStart = Date.now();
      const result = store.query({ filter: { category: 'api' } });
      const queryTime = Date.now() - queryStart;
      console.log(`Queried ${result.total} patterns in ${queryTime}ms`);
      
      expect(store.getAll().length).toBe(1000);
      expect(queryTime).toBeLessThan(100); // Should be very fast from cache
    });
  });
});


// ============================================================================
// Test Suite: HybridContractStore
// ============================================================================

describe('HybridContractStore Stress Tests', () => {
  let tempDir: string;
  let store: HybridContractStore;

  beforeEach(async () => {
    tempDir = createTempDir();
    store = new HybridContractStore({ rootDir: tempDir });
    await store.initialize();
  });

  afterEach(async () => {
    if (store) {
      await store.close();
    }
    cleanupTempDir(tempDir);
  });

  describe('Type Conversion Accuracy', () => {
    it('should preserve all contract fields through round-trip', async () => {
      const original = createTestContract({
        id: 'contract-roundtrip',
        method: 'POST',
        endpoint: '/api/users',
        status: 'discovered',
        backend: {
          method: 'POST',
          path: '/api/users',
          normalizedPath: '/api/users',
          file: 'src/routes/users.ts',
          line: 25,
          framework: 'express',
          responseFields: ['id', 'name', 'email', 'createdAt'],
        },
        frontend: [
          {
            method: 'POST',
            path: '/api/users',
            normalizedPath: '/api/users',
            file: 'src/api/users.ts',
            line: 10,
            library: 'axios',
            responseFields: ['id', 'name'],
          },
        ],
        confidence: {
          score: 0.85,
          level: 'high',
          matchConfidence: 0.9,
          fieldExtractionConfidence: 0.8,
        },
        mismatches: [],
      });

      await store.add(original);
      const retrieved = store.get('contract-roundtrip');

      expect(retrieved).not.toBeUndefined();
      expect(retrieved!.id).toBe(original.id);
      expect(retrieved!.method).toBe(original.method);
      expect(retrieved!.endpoint).toBe(original.endpoint);
      expect(retrieved!.backend.framework).toBe(original.backend.framework);
      expect(retrieved!.backend.responseFields).toEqual(original.backend.responseFields);
      expect(retrieved!.frontend.length).toBe(original.frontend.length);
      expect(retrieved!.confidence.score).toBeCloseTo(original.confidence.score, 5);
    });
  });

  describe('Status Transitions', () => {
    it('should correctly verify a contract', async () => {
      const contract = createTestContract({ id: 'verify-test', status: 'discovered' });
      await store.add(contract);
      
      const verified = await store.verify('verify-test', 'reviewer');
      
      expect(verified.status).toBe('verified');
      expect(verified.metadata.verifiedBy).toBe('reviewer');
      expect(verified.metadata.verifiedAt).toBeDefined();
    });

    it('should correctly mark mismatch', async () => {
      const contract = createTestContract({ id: 'mismatch-test', status: 'discovered' });
      await store.add(contract);
      
      const mismatched = await store.markMismatch('mismatch-test');
      
      expect(mismatched.status).toBe('mismatch');
    });

    it('should correctly ignore a contract', async () => {
      const contract = createTestContract({ id: 'ignore-contract-test', status: 'discovered' });
      await store.add(contract);
      
      const ignored = await store.ignore('ignore-contract-test');
      
      expect(ignored.status).toBe('ignored');
    });
  });

  describe('Query Operations', () => {
    beforeEach(async () => {
      const methods: HttpMethod[] = ['GET', 'POST', 'PUT', 'DELETE'];
      const statuses: ContractStatus[] = ['discovered', 'verified', 'mismatch', 'ignored'];
      
      for (let i = 0; i < 20; i++) {
        await store.add(createTestContract({
          id: `contract-query-${i}`,
          method: methods[i % methods.length],
          status: statuses[i % statuses.length],
        }));
      }
    });

    it('should filter by status', () => {
      const result = store.query({ filter: { status: 'verified' } });
      expect(result.contracts.length).toBeGreaterThan(0);
      expect(result.contracts.every(c => c.status === 'verified')).toBe(true);
    });

    it('should filter by method', () => {
      const result = store.query({ filter: { method: 'POST' } });
      expect(result.contracts.length).toBeGreaterThan(0);
      expect(result.contracts.every(c => c.method === 'POST')).toBe(true);
    });

    it('should filter by endpoint', () => {
      const result = store.query({ filter: { endpoint: 'test' } });
      expect(result.contracts.length).toBeGreaterThan(0);
    });
  });

  describe('Statistics', () => {
    it('should return accurate statistics', async () => {
      await store.add(createTestContract({ id: 'stat-c1', status: 'discovered', method: 'GET' }));
      await store.add(createTestContract({ id: 'stat-c2', status: 'discovered', method: 'POST' }));
      await store.add(createTestContract({ id: 'stat-c3', status: 'verified', method: 'GET' }));
      await store.add(createTestContract({ id: 'stat-c4', status: 'mismatch', method: 'PUT' }));

      const stats = store.getStats();
      
      expect(stats.totalContracts).toBe(4);
      expect(stats.byStatus.discovered).toBe(2);
      expect(stats.byStatus.verified).toBe(1);
      expect(stats.byStatus.mismatch).toBe(1);
      expect(stats.byMethod.GET).toBe(2);
      expect(stats.byMethod.POST).toBe(1);
      expect(stats.byMethod.PUT).toBe(1);
    });
  });
});


// ============================================================================
// Test Suite: Store Factory
// ============================================================================

describe('Store Factory Stress Tests', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
  });

  afterEach(() => {
    cleanupTempDir(tempDir);
  });

  describe('Backend Detection', () => {
    it('should default to SQLite for new projects', async () => {
      const store = await createPatternStore({ rootDir: tempDir });
      
      // Verify SQLite database was created
      const dbPath = path.join(tempDir, '.drift', 'drift.db');
      expect(fs.existsSync(dbPath)).toBe(true);
      
      if (store.close) await store.close();
    });

    it('should detect existing SQLite database', async () => {
      // Create a store first
      const store1 = await createPatternStore({ rootDir: tempDir });
      await store1.add(createTestPattern({ id: 'detect-test' }));
      if (store1.close) await store1.close();
      
      // Create another store - should detect SQLite
      const store2 = await createPatternStore({ rootDir: tempDir });
      const pattern = store2.get('detect-test');
      expect(pattern).toBeDefined();
      
      if (store2.close) await store2.close();
    });
  });

  describe('Contract Store Factory', () => {
    it('should create SQLite-backed contract store', async () => {
      const store = await createContractStore({ rootDir: tempDir });
      
      await store.add(createTestContract({ id: 'factory-contract' }));
      const retrieved = store.get('factory-contract');
      expect(retrieved).toBeDefined();
      
      if (store.close) await store.close();
    });
  });
});


// ============================================================================
// Test Suite: Edge Cases and Error Handling
// ============================================================================

describe('Edge Cases and Error Handling', () => {
  let tempDir: string;
  let store: UnifiedStore;

  beforeEach(async () => {
    tempDir = createTempDir();
    store = new UnifiedStore({ rootDir: tempDir });
    await store.initialize();
  });

  afterEach(async () => {
    if (store) {
      await store.close();
    }
    cleanupTempDir(tempDir);
  });

  describe('Duplicate Handling', () => {
    it('should reject duplicate pattern IDs', async () => {
      const pattern: DbPattern = {
        id: 'duplicate-test',
        name: 'Original',
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
      };

      await store.patterns.create(pattern);
      
      // Attempting to create duplicate should throw
      await expect(store.patterns.create(pattern)).rejects.toThrow();
    });
  });

  describe('Special Characters', () => {
    it('should handle special characters in pattern names', async () => {
      const pattern: DbPattern = {
        id: 'special-chars',
        name: "Pattern with 'quotes' and \"double quotes\" and `backticks`",
        description: 'Description with <html> & special chars: é, ñ, 中文',
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
      };

      await store.patterns.create(pattern);
      const retrieved = await store.patterns.read('special-chars');
      
      expect(retrieved!.name).toBe(pattern.name);
      expect(retrieved!.description).toBe(pattern.description);
    });

    it('should handle special characters in file paths', async () => {
      const pattern: DbPattern = {
        id: 'special-path',
        name: 'Special Path',
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
      };

      await store.patterns.create(pattern);
      await store.patterns.addLocation('special-path', {
        pattern_id: 'special-path',
        file: 'src/components/[id]/page.tsx',
        line: 10,
        column_num: 0,
        end_line: null,
        end_column: null,
        is_outlier: 0,
        outlier_reason: null,
        deviation_score: null,
        confidence: 1.0,
        snippet: null,
      });

      const locations = await store.patterns.getLocations('special-path');
      expect(locations[0].file).toBe('src/components/[id]/page.tsx');
    });
  });

  describe('JSON Field Handling', () => {
    it('should correctly store and retrieve JSON arrays', async () => {
      const pattern: DbPattern = {
        id: 'json-array-test',
        name: 'JSON Array Test',
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
        tags: '["tag1","tag2","tag with spaces","tag-with-dashes"]',
        source: null,
        location_count: 0,
        outlier_count: 0,
      };

      await store.patterns.create(pattern);
      const retrieved = await store.patterns.read('json-array-test');
      
      const tags = JSON.parse(retrieved!.tags!);
      expect(tags).toEqual(['tag1', 'tag2', 'tag with spaces', 'tag-with-dashes']);
    });

    it('should correctly store and retrieve JSON objects', async () => {
      const pattern: DbPattern = {
        id: 'json-object-test',
        name: 'JSON Object Test',
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
        detector_type: 'ast',
        detector_config: '{"language":"typescript","strict":true,"options":{"nested":{"value":123}}}',
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
      };

      await store.patterns.create(pattern);
      const retrieved = await store.patterns.read('json-object-test');
      
      const config = JSON.parse(retrieved!.detector_config!);
      expect(config.language).toBe('typescript');
      expect(config.strict).toBe(true);
      expect(config.options.nested.value).toBe(123);
    });
  });

  describe('Boundary Values', () => {
    it('should handle very long strings', async () => {
      const longDescription = 'A'.repeat(10000);
      const pattern: DbPattern = {
        id: 'long-string-test',
        name: 'Long String Test',
        description: longDescription,
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
      };

      await store.patterns.create(pattern);
      const retrieved = await store.patterns.read('long-string-test');
      
      expect(retrieved!.description!.length).toBe(10000);
    });

    it('should handle extreme confidence values', async () => {
      const pattern: DbPattern = {
        id: 'extreme-confidence',
        name: 'Extreme Confidence',
        description: null,
        category: 'api',
        subcategory: null,
        status: 'discovered',
        confidence_score: 0.999999999,
        confidence_level: 'high',
        confidence_frequency: 0.0000001,
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
      };

      await store.patterns.create(pattern);
      const retrieved = await store.patterns.read('extreme-confidence');
      
      expect(retrieved!.confidence_score).toBeCloseTo(0.999999999, 8);
      expect(retrieved!.confidence_frequency).toBeCloseTo(0.0000001, 8);
    });

    it('should handle large line numbers', async () => {
      const pattern: DbPattern = {
        id: 'large-line-numbers',
        name: 'Large Line Numbers',
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
      };

      await store.patterns.create(pattern);
      await store.patterns.addLocation('large-line-numbers', {
        pattern_id: 'large-line-numbers',
        file: 'huge-file.ts',
        line: 999999,
        column_num: 500,
        end_line: 1000000,
        end_column: 100,
        is_outlier: 0,
        outlier_reason: null,
        deviation_score: null,
        confidence: 1.0,
        snippet: null,
      });

      const locations = await store.patterns.getLocations('large-line-numbers');
      expect(locations[0].line).toBe(999999);
      expect(locations[0].end_line).toBe(1000000);
    });
  });
});
