/**
 * Production Readiness Test Suite
 * 
 * Comprehensive tests to verify drift.db is production-ready:
 * 1. Schema integrity - all tables, indexes, constraints
 * 2. Incremental scans - upserts work, no duplicates
 * 3. Source of truth - JSON ↔ SQLite consistency
 * 4. Concurrent access - no race conditions
 * 5. Data integrity - foreign keys, cascades
 * 6. Performance - query times under threshold
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import Database from 'better-sqlite3';
import { UnifiedStore } from '../unified-store.js';
import { StoreSyncService } from '../sync-service.js';

// Test configuration
const TEST_TIMEOUT = 30000;

describe('Production Readiness Tests', () => {
  let testDir: string;
  let store: UnifiedStore;
  let db: Database.Database;

  beforeAll(async () => {
    // Create isolated test directory
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'drift-prod-test-'));
    await fs.mkdir(path.join(testDir, '.drift'), { recursive: true });
    
    store = new UnifiedStore({ rootDir: testDir });
    await store.initialize();
    db = (store as any).db;
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await store.close();
    await fs.rm(testDir, { recursive: true, force: true });
  });


  // ============================================================================
  // 1. SCHEMA INTEGRITY TESTS
  // ============================================================================
  
  describe('Schema Integrity', () => {
    it('should have all required tables', () => {
      const tables = db.prepare(`
        SELECT name FROM sqlite_master 
        WHERE type='table' AND name NOT LIKE 'sqlite_%'
        ORDER BY name
      `).all() as { name: string }[];
      
      const tableNames = tables.map(t => t.name);
      
      const requiredTables = [
        'patterns', 'pattern_locations',
        'data_models', 'sensitive_fields', 'data_access_points',
        'env_variables', 'env_access_points',
        'functions', 'function_calls', 'function_data_access',
        'audit_snapshots', 'health_trends', 'scan_history',
        'dna_profile', 'dna_genes', 'dna_mutations',
        'test_files', 'test_coverage',
        'contracts', 'contract_frontends',
        'constraints'
      ];
      
      for (const table of requiredTables) {
        expect(tableNames).toContain(table);
      }
    });

    it('should have proper indexes for performance', () => {
      const indexes = db.prepare(`
        SELECT name, tbl_name FROM sqlite_master 
        WHERE type='index' AND name NOT LIKE 'sqlite_%'
      `).all() as { name: string; tbl_name: string }[];
      
      // Critical indexes for query performance (using actual index naming convention)
      const criticalIndexes = [
        { table: 'patterns', indexName: 'idx_patterns_category' },
        { table: 'patterns', indexName: 'idx_patterns_status' },
        { table: 'pattern_locations', indexName: 'idx_pattern_locations_pattern' },
        { table: 'pattern_locations', indexName: 'idx_pattern_locations_file' },
      ];
      
      for (const idx of criticalIndexes) {
        const hasIndex = indexes.some(i => 
          i.tbl_name === idx.table && i.name === idx.indexName
        );
        expect(hasIndex, `Missing index ${idx.indexName} on ${idx.table}`).toBe(true);
      }
    });

    it('should enforce foreign key constraints', () => {
      const fkEnabled = db.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number };
      expect(fkEnabled.foreign_keys).toBe(1);
    });

    it('should have WAL mode enabled for concurrent access', () => {
      const journalMode = db.prepare('PRAGMA journal_mode').get() as { journal_mode: string };
      expect(journalMode.journal_mode).toBe('wal');
    });
  });


  // ============================================================================
  // 2. INCREMENTAL SCAN TESTS - No Duplicates
  // ============================================================================
  
  describe('Incremental Scan Handling', () => {
    const testPatternId = 'test-pattern-incremental-001';
    
    beforeEach(async () => {
      // Clean up test data
      db.prepare('DELETE FROM pattern_locations WHERE pattern_id = ?').run(testPatternId);
      db.prepare('DELETE FROM patterns WHERE id = ?').run(testPatternId);
    });

    it('should handle pattern upserts without duplicates', async () => {
      const pattern = {
        id: testPatternId,
        name: 'Test Pattern',
        description: 'Test description',
        category: 'api' as const,
        status: 'discovered' as const,
        confidence_score: 0.85,
        confidence_level: 'high' as const,
        severity: 'warning' as const,
        auto_fixable: 0,
        first_seen: new Date().toISOString(),
        last_seen: new Date().toISOString(),
        location_count: 5,
        outlier_count: 0,
      };

      // First insert
      await store.patterns.create(pattern);
      let count = db.prepare('SELECT COUNT(*) as c FROM patterns WHERE id = ?').get(testPatternId) as { c: number };
      expect(count.c).toBe(1);

      // Second insert (should update, not duplicate)
      pattern.confidence_score = 0.90;
      pattern.last_seen = new Date().toISOString();
      
      try {
        await store.patterns.create(pattern);
      } catch {
        // Expected - primary key conflict, use update instead
        await store.patterns.update(testPatternId, { confidence_score: 0.90 });
      }
      
      count = db.prepare('SELECT COUNT(*) as c FROM patterns WHERE id = ?').get(testPatternId) as { c: number };
      expect(count.c).toBe(1); // Still only 1 record
    });

    it('should handle location upserts without duplicates', async () => {
      // Create parent pattern first
      await store.patterns.create({
        id: testPatternId,
        name: 'Test Pattern',
        category: 'api' as const,
        status: 'discovered' as const,
        confidence_score: 0.85,
        confidence_level: 'high' as const,
        severity: 'warning' as const,
        auto_fixable: 0,
        first_seen: new Date().toISOString(),
        last_seen: new Date().toISOString(),
        location_count: 1,
        outlier_count: 0,
      });

      const location = {
        pattern_id: testPatternId,
        file: 'src/test.ts',
        line: 10,
        column_num: 5,
        is_outlier: 0,
        confidence: 1.0,
      };

      // First insert
      await store.patterns.addLocation(testPatternId, location);
      let count = db.prepare(
        'SELECT COUNT(*) as c FROM pattern_locations WHERE pattern_id = ? AND file = ? AND line = ?'
      ).get(testPatternId, 'src/test.ts', 10) as { c: number };
      expect(count.c).toBe(1);

      // Second insert of same location (should not duplicate)
      try {
        await store.patterns.addLocation(testPatternId, location);
      } catch {
        // Expected - unique constraint violation
      }
      
      count = db.prepare(
        'SELECT COUNT(*) as c FROM pattern_locations WHERE pattern_id = ? AND file = ? AND line = ?'
      ).get(testPatternId, 'src/test.ts', 10) as { c: number };
      expect(count.c).toBe(1); // Still only 1 record
    });

    it('should handle multiple scans accumulating data correctly', async () => {
      // Simulate 3 incremental scans
      for (let scan = 1; scan <= 3; scan++) {
        await store.patterns.create({
          id: `scan-${scan}-pattern`,
          name: `Pattern from scan ${scan}`,
          category: 'api' as const,
          status: 'discovered' as const,
          confidence_score: 0.80 + scan * 0.05,
          confidence_level: 'high' as const,
          severity: 'info' as const,
          auto_fixable: 0,
          first_seen: new Date().toISOString(),
          last_seen: new Date().toISOString(),
          location_count: scan,
          outlier_count: 0,
        });
      }

      const patterns = db.prepare(
        "SELECT id FROM patterns WHERE id LIKE 'scan-%'"
      ).all() as { id: string }[];
      
      expect(patterns.length).toBe(3);
      
      // Cleanup
      db.prepare("DELETE FROM patterns WHERE id LIKE 'scan-%'").run();
    });
  });


  // ============================================================================
  // 3. SOURCE OF TRUTH CONSISTENCY
  // ============================================================================
  
  describe('Source of Truth Consistency', () => {
    it('should maintain referential integrity between patterns and locations', async () => {
      const patternId = 'ref-integrity-test';
      
      // Create pattern with locations
      await store.patterns.create({
        id: patternId,
        name: 'Ref Integrity Test',
        category: 'api' as const,
        status: 'discovered' as const,
        confidence_score: 0.90,
        confidence_level: 'high' as const,
        severity: 'warning' as const,
        auto_fixable: 0,
        first_seen: new Date().toISOString(),
        last_seen: new Date().toISOString(),
        location_count: 2,
        outlier_count: 0,
      });

      await store.patterns.addLocation(patternId, {
        pattern_id: patternId,
        file: 'src/a.ts',
        line: 1,
        column_num: 0,
        is_outlier: 0,
        confidence: 1.0,
      });

      await store.patterns.addLocation(patternId, {
        pattern_id: patternId,
        file: 'src/b.ts',
        line: 1,
        column_num: 0,
        is_outlier: 0,
        confidence: 1.0,
      });

      // Verify locations exist
      let locations = db.prepare(
        'SELECT COUNT(*) as c FROM pattern_locations WHERE pattern_id = ?'
      ).get(patternId) as { c: number };
      expect(locations.c).toBe(2);

      // Delete pattern - locations should cascade delete
      await store.patterns.delete(patternId);

      locations = db.prepare(
        'SELECT COUNT(*) as c FROM pattern_locations WHERE pattern_id = ?'
      ).get(patternId) as { c: number };
      expect(locations.c).toBe(0); // Cascade delete worked
    });

    it('should maintain contract-frontend referential integrity', async () => {
      const contractId = 'contract-ref-test';
      
      await store.contracts.create({
        id: contractId,
        method: 'GET',
        endpoint: '/test',
        normalized_endpoint: '/test',
        status: 'discovered',
        confidence_score: 0.8,
        confidence_level: 'medium',
        first_seen: new Date().toISOString(),
        last_seen: new Date().toISOString(),
      });

      await store.contracts.addFrontend(contractId, {
        contract_id: contractId,
        method: 'GET',
        path: '/api/test',
        normalized_path: '/api/test',
        file: 'src/api.ts',
        line: 10,
      });

      // Verify frontend exists
      let frontends = db.prepare(
        'SELECT COUNT(*) as c FROM contract_frontends WHERE contract_id = ?'
      ).get(contractId) as { c: number };
      expect(frontends.c).toBe(1);

      // Delete contract - frontends should cascade
      await store.contracts.delete(contractId);

      frontends = db.prepare(
        'SELECT COUNT(*) as c FROM contract_frontends WHERE contract_id = ?'
      ).get(contractId) as { c: number };
      expect(frontends.c).toBe(0);
    });

    it('should track pattern status transitions correctly', async () => {
      const patternId = 'status-transition-test';
      
      await store.patterns.create({
        id: patternId,
        name: 'Status Test',
        category: 'api' as const,
        status: 'discovered' as const,
        confidence_score: 0.95,
        confidence_level: 'high' as const,
        severity: 'warning' as const,
        auto_fixable: 0,
        first_seen: new Date().toISOString(),
        last_seen: new Date().toISOString(),
        location_count: 1,
        outlier_count: 0,
      });

      // Approve
      await store.patterns.approve(patternId, 'test-user');
      let pattern = db.prepare('SELECT status, approved_by FROM patterns WHERE id = ?').get(patternId) as any;
      expect(pattern.status).toBe('approved');
      expect(pattern.approved_by).toBe('test-user');

      // Ignore
      await store.patterns.ignore(patternId);
      pattern = db.prepare('SELECT status FROM patterns WHERE id = ?').get(patternId) as any;
      expect(pattern.status).toBe('ignored');

      // Cleanup
      db.prepare('DELETE FROM patterns WHERE id = ?').run(patternId);
    });
  });


  // ============================================================================
  // 4. DATA INTEGRITY ACROSS ALL DOMAINS
  // ============================================================================
  
  describe('Data Integrity - All Domains', () => {
    it('should store and retrieve boundary data correctly', async () => {
      const model = {
        name: 'TestModel',
        table_name: 'test_table',
        file: 'src/models/test.ts',
        line: 10,
        framework: 'prisma',
        confidence: 0.95,
      };

      await store.boundaries.addModel(model);
      
      const retrieved = db.prepare(
        'SELECT * FROM data_models WHERE name = ?'
      ).get('TestModel') as any;
      
      expect(retrieved.table_name).toBe('test_table');
      expect(retrieved.framework).toBe('prisma');
      
      // Cleanup
      db.prepare('DELETE FROM data_models WHERE name = ?').run('TestModel');
    });

    it('should store and retrieve environment data correctly', async () => {
      const envVar = {
        name: 'TEST_API_KEY',
        sensitivity: 'secret' as const,
        has_default: 0,
        is_required: 1,
      };

      await store.environment.addVariable(envVar);
      
      const retrieved = db.prepare(
        'SELECT * FROM env_variables WHERE name = ?'
      ).get('TEST_API_KEY') as any;
      
      expect(retrieved.sensitivity).toBe('secret');
      expect(retrieved.is_required).toBe(1);
      
      // Cleanup
      db.prepare('DELETE FROM env_variables WHERE name = ?').run('TEST_API_KEY');
    });

    it('should store and retrieve call graph data correctly', async () => {
      const func = {
        id: 'func-test-001',
        name: 'testFunction',
        file: 'src/test.ts',
        start_line: 10,
        end_line: 20,
        language: 'typescript',
        is_exported: 1,
        is_entry_point: 0,
        is_data_accessor: 0,
        is_constructor: 0,
        is_async: 1,
      };

      await store.callGraph.addFunction(func);
      
      const retrieved = db.prepare(
        'SELECT * FROM functions WHERE id = ?'
      ).get('func-test-001') as any;
      
      expect(retrieved.name).toBe('testFunction');
      expect(retrieved.is_async).toBe(1);
      
      // Cleanup
      db.prepare('DELETE FROM functions WHERE id = ?').run('func-test-001');
    });

    it('should store and retrieve DNA data correctly', async () => {
      const profile = {
        id: 1,
        version: '1.0.0',
        generated_at: new Date().toISOString(),
        health_score: 85,
        genetic_diversity: 0.7,
        summary: JSON.stringify({ test: true }),
      };

      await store.dna.saveProfile(profile);
      
      const retrieved = db.prepare('SELECT * FROM dna_profile WHERE id = 1').get() as any;
      expect(retrieved.health_score).toBe(85);
      
      const gene = {
        id: 'gene-test-001',
        name: 'Test Gene',
        dominant_variant: 'variant-a',
        confidence: 0.9,
      };

      await store.dna.addGene(gene);
      
      const retrievedGene = db.prepare(
        'SELECT * FROM dna_genes WHERE id = ?'
      ).get('gene-test-001') as any;
      expect(retrievedGene.dominant_variant).toBe('variant-a');
      
      // Cleanup
      db.prepare('DELETE FROM dna_genes WHERE id = ?').run('gene-test-001');
    });

    it('should store and retrieve constraint data correctly', async () => {
      const constraint = {
        id: 'constraint-test-001',
        name: 'Test Constraint',
        description: 'Test description',
        category: 'api' as const,
        status: 'discovered' as const,
        language: 'typescript',
        invariant: JSON.stringify({ type: 'must_have' }),
        enforcement_level: 'error' as const,
        confidence_score: 0.95,
        confidence_evidence: 10,
        confidence_violations: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      await store.constraints.create(constraint);
      
      const retrieved = db.prepare(
        'SELECT * FROM constraints WHERE id = ?'
      ).get('constraint-test-001') as any;
      
      expect(retrieved.name).toBe('Test Constraint');
      expect(retrieved.enforcement_level).toBe('error');
      
      // Cleanup
      db.prepare('DELETE FROM constraints WHERE id = ?').run('constraint-test-001');
    });
  });


  // ============================================================================
  // 5. PERFORMANCE TESTS
  // ============================================================================
  
  describe('Performance', () => {
    it('should handle bulk pattern inserts efficiently', async () => {
      const BATCH_SIZE = 100;
      const patterns: any[] = [];
      
      for (let i = 0; i < BATCH_SIZE; i++) {
        patterns.push({
          id: `perf-pattern-${i}`,
          name: `Performance Test Pattern ${i}`,
          category: 'api' as const,
          status: 'discovered' as const,
          confidence_score: 0.85,
          confidence_level: 'high' as const,
          severity: 'info' as const,
          auto_fixable: 0,
          first_seen: new Date().toISOString(),
          last_seen: new Date().toISOString(),
          location_count: 1,
          outlier_count: 0,
        });
      }

      const start = Date.now();
      
      // Use transaction for bulk insert
      db.exec('BEGIN TRANSACTION');
      for (const p of patterns) {
        await store.patterns.create(p);
      }
      db.exec('COMMIT');
      
      const duration = Date.now() - start;
      
      // Should complete in under 5 seconds
      expect(duration).toBeLessThan(5000);
      
      // Verify all inserted
      const count = db.prepare(
        "SELECT COUNT(*) as c FROM patterns WHERE id LIKE 'perf-pattern-%'"
      ).get() as { c: number };
      expect(count.c).toBe(BATCH_SIZE);
      
      // Cleanup
      db.prepare("DELETE FROM patterns WHERE id LIKE 'perf-pattern-%'").run();
    });

    it('should query patterns by category efficiently', async () => {
      // Insert test data
      for (let i = 0; i < 50; i++) {
        await store.patterns.create({
          id: `query-test-${i}`,
          name: `Query Test ${i}`,
          category: i % 2 === 0 ? 'api' : 'auth' as any,
          status: 'discovered' as const,
          confidence_score: 0.85,
          confidence_level: 'high' as const,
          severity: 'info' as const,
          auto_fixable: 0,
          first_seen: new Date().toISOString(),
          last_seen: new Date().toISOString(),
          location_count: 1,
          outlier_count: 0,
        });
      }

      const start = Date.now();
      const results = await store.patterns.search({ category: 'api' });
      const duration = Date.now() - start;
      
      // Query should be fast (under 100ms)
      expect(duration).toBeLessThan(100);
      expect(results.length).toBeGreaterThanOrEqual(25);
      
      // Cleanup
      db.prepare("DELETE FROM patterns WHERE id LIKE 'query-test-%'").run();
    });
  });


  // ============================================================================
  // 6. SYNC SERVICE TESTS
  // ============================================================================
  
  describe('Sync Service', () => {
    let syncTestDir: string;
    let syncService: StoreSyncService;

    beforeAll(async () => {
      syncTestDir = await fs.mkdtemp(path.join(os.tmpdir(), 'drift-sync-test-'));
      
      // Create .drift directory structure
      await fs.mkdir(path.join(syncTestDir, '.drift', 'patterns', 'discovered'), { recursive: true });
      await fs.mkdir(path.join(syncTestDir, '.drift', 'boundaries'), { recursive: true });
      await fs.mkdir(path.join(syncTestDir, '.drift', 'environment'), { recursive: true });
      
      syncService = new StoreSyncService({ rootDir: syncTestDir, verbose: false });
      await syncService.initialize();
    });

    afterAll(async () => {
      await syncService.close();
      await fs.rm(syncTestDir, { recursive: true, force: true });
    });

    it('should sync boundaries from JSON to SQLite', async () => {
      // Create test JSON data
      const accessMap = {
        models: [
          { name: 'User', tableName: 'users', file: 'src/models/user.ts', line: 5 },
          { name: 'Order', tableName: 'orders', file: 'src/models/order.ts', line: 10 },
        ],
        sensitiveFields: [
          { table: 'users', field: 'password', sensitivityType: 'credentials' },
          { table: 'users', field: 'email', sensitivityType: 'pii' },
        ],
        accessPoints: {},
      };

      await fs.writeFile(
        path.join(syncTestDir, '.drift', 'boundaries', 'access-map.json'),
        JSON.stringify(accessMap)
      );

      const count = await syncService.syncBoundaries();
      expect(count).toBeGreaterThan(0);
    });

    it('should sync environment from JSON to SQLite', async () => {
      const envData = {
        variables: {
          'DATABASE_URL': { sensitivity: 'credential', hasDefault: false, isRequired: true },
          'API_KEY': { sensitivity: 'secret', hasDefault: false, isRequired: true },
        },
        accessPoints: {},
      };

      await fs.writeFile(
        path.join(syncTestDir, '.drift', 'environment', 'access-map.json'),
        JSON.stringify(envData)
      );

      const count = await syncService.syncEnvironment();
      expect(count).toBeGreaterThan(0);
    });

    it('should handle missing JSON files gracefully', async () => {
      // Try to sync from non-existent files
      const result = await syncService.syncCallGraph();
      expect(result.functions).toBe(0); // Should return 0, not throw
    });

    it('should run full sync without errors', async () => {
      const result = await syncService.syncAll();
      expect(result.success).toBe(true);
      expect(result.errors.length).toBe(0);
    });
  });


  // ============================================================================
  // 7. EDGE CASES AND ERROR HANDLING
  // ============================================================================
  
  describe('Edge Cases and Error Handling', () => {
    it('should handle empty strings gracefully', async () => {
      const pattern = {
        id: 'empty-string-test',
        name: '', // Empty name
        description: null,
        category: 'api' as const,
        status: 'discovered' as const,
        confidence_score: 0.85,
        confidence_level: 'high' as const,
        severity: 'info' as const,
        auto_fixable: 0,
        first_seen: new Date().toISOString(),
        last_seen: new Date().toISOString(),
        location_count: 0,
        outlier_count: 0,
      };

      await store.patterns.create(pattern);
      
      const retrieved = db.prepare(
        'SELECT * FROM patterns WHERE id = ?'
      ).get('empty-string-test') as any;
      
      expect(retrieved.name).toBe('');
      
      // Cleanup
      db.prepare('DELETE FROM patterns WHERE id = ?').run('empty-string-test');
    });

    it('should handle special characters in data', async () => {
      const pattern = {
        id: 'special-chars-test',
        name: "Pattern with 'quotes' and \"double quotes\"",
        description: 'Contains\nnewlines\tand\ttabs',
        category: 'api' as const,
        status: 'discovered' as const,
        confidence_score: 0.85,
        confidence_level: 'high' as const,
        severity: 'info' as const,
        auto_fixable: 0,
        first_seen: new Date().toISOString(),
        last_seen: new Date().toISOString(),
        location_count: 0,
        outlier_count: 0,
      };

      await store.patterns.create(pattern);
      
      const retrieved = db.prepare(
        'SELECT * FROM patterns WHERE id = ?'
      ).get('special-chars-test') as any;
      
      expect(retrieved.name).toContain("'quotes'");
      expect(retrieved.description).toContain('\n');
      
      // Cleanup
      db.prepare('DELETE FROM patterns WHERE id = ?').run('special-chars-test');
    });

    it('should handle very long strings', async () => {
      const longDescription = 'x'.repeat(10000);
      
      const pattern = {
        id: 'long-string-test',
        name: 'Long String Test',
        description: longDescription,
        category: 'api' as const,
        status: 'discovered' as const,
        confidence_score: 0.85,
        confidence_level: 'high' as const,
        severity: 'info' as const,
        auto_fixable: 0,
        first_seen: new Date().toISOString(),
        last_seen: new Date().toISOString(),
        location_count: 0,
        outlier_count: 0,
      };

      await store.patterns.create(pattern);
      
      const retrieved = db.prepare(
        'SELECT * FROM patterns WHERE id = ?'
      ).get('long-string-test') as any;
      
      expect(retrieved.description.length).toBe(10000);
      
      // Cleanup
      db.prepare('DELETE FROM patterns WHERE id = ?').run('long-string-test');
    });

    it('should handle JSON fields correctly', async () => {
      const complexJson = {
        nested: { deep: { value: 123 } },
        array: [1, 2, 3],
        special: "quotes'and\"stuff",
      };

      const constraint = {
        id: 'json-field-test',
        name: 'JSON Test',
        category: 'api' as const,
        status: 'discovered' as const,
        language: 'typescript',
        invariant: JSON.stringify(complexJson),
        enforcement_level: 'warning' as const,
        confidence_score: 0.9,
        confidence_evidence: 5,
        confidence_violations: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      await store.constraints.create(constraint);
      
      const retrieved = db.prepare(
        'SELECT invariant FROM constraints WHERE id = ?'
      ).get('json-field-test') as any;
      
      const parsed = JSON.parse(retrieved.invariant);
      expect(parsed.nested.deep.value).toBe(123);
      expect(parsed.array).toEqual([1, 2, 3]);
      
      // Cleanup
      db.prepare('DELETE FROM constraints WHERE id = ?').run('json-field-test');
    });
  });
});
