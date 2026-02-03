/**
 * MCP Integration Tests - Verify SQLite backend produces correct response structures
 * 
 * This test suite validates that the SQLite storage layer produces
 * the exact same response structures expected by MCP tools.
 * 
 * Critical for ensuring no contract mismatches between storage and MCP layer.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { UnifiedStore } from '../unified-store.js';
import { HybridPatternStore } from '../hybrid-pattern-store.js';
import { HybridContractStore } from '../hybrid-contract-store.js';
import type { Pattern, PatternCategory, PatternStatus } from '../../store/types.js';
import type { Contract, ContractStatus, HttpMethod } from '../../types/contracts.js';

// ============================================================================
// Test Utilities
// ============================================================================

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'drift-mcp-test-'));
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


function createTestContract(overrides: Partial<Contract> = {}): Contract {
  const id = generateId();
  const now = new Date().toISOString();
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
    frontend: [{
      method: 'GET' as HttpMethod,
      path: `/api/test/${id}`,
      normalizedPath,
      file: 'src/api/client.ts',
      line: 25,
      library: 'axios',
      responseFields: ['id', 'name'],
    }],
    confidence: { score: 0.75, level: 'medium', matchConfidence: 0.8, fieldExtractionConfidence: 0.7 },
    mismatches: [],
    metadata: { firstSeen: now, lastSeen: now },
    ...overrides,
  };
}

// ============================================================================
// MCP Response Structure Tests
// ============================================================================

describe('MCP Response Structure Tests', () => {
  let tempDir: string;
  let patternStore: HybridPatternStore;
  let contractStore: HybridContractStore;

  beforeEach(async () => {
    tempDir = createTempDir();
    patternStore = new HybridPatternStore({ rootDir: tempDir, sqliteOnly: true });
    contractStore = new HybridContractStore({ rootDir: tempDir });
    await patternStore.initialize();
    await contractStore.initialize();
  });

  afterEach(async () => {
    if (patternStore) await patternStore.close();
    if (contractStore) await contractStore.close();
    cleanupTempDir(tempDir);
  });

  describe('drift_patterns_list Response Structure', () => {
    it('should return patterns with all required MCP fields', async () => {
      await patternStore.add(createTestPattern({
        id: 'mcp-pattern-1',
        name: 'HTTP Methods Detector',
        category: 'api',
        status: 'discovered',
        confidence: { score: 0.95, level: 'high', frequency: 0.9, consistency: 0.85, age: 0.8, spread: 37 },
      }));

      const patterns = patternStore.getAll();
      const pattern = patterns[0];

      // Verify MCP-required fields exist
      expect(pattern).toHaveProperty('id');
      expect(pattern).toHaveProperty('name');
      expect(pattern).toHaveProperty('category');
      expect(pattern).toHaveProperty('status');
      expect(pattern).toHaveProperty('confidence');
      expect(pattern.confidence).toHaveProperty('score');
      expect(pattern.confidence).toHaveProperty('level');
      expect(pattern).toHaveProperty('locations');
      expect(pattern).toHaveProperty('outliers');
      expect(pattern).toHaveProperty('metadata');
    });


    it('should return correct confidence level mapping', async () => {
      // Test all confidence levels
      await patternStore.add(createTestPattern({ id: 'high-conf', confidence: { score: 0.9, level: 'high', frequency: 0, consistency: 0, age: 0, spread: 0 } }));
      await patternStore.add(createTestPattern({ id: 'med-conf', confidence: { score: 0.6, level: 'medium', frequency: 0, consistency: 0, age: 0, spread: 0 } }));
      await patternStore.add(createTestPattern({ id: 'low-conf', confidence: { score: 0.3, level: 'low', frequency: 0, consistency: 0, age: 0, spread: 0 } }));

      const high = patternStore.get('high-conf');
      const med = patternStore.get('med-conf');
      const low = patternStore.get('low-conf');

      expect(high?.confidence.level).toBe('high');
      expect(med?.confidence.level).toBe('medium');
      expect(low?.confidence.level).toBe('low');
    });

    it('should return correct status values', async () => {
      await patternStore.add(createTestPattern({ id: 'disc', status: 'discovered' }));
      await patternStore.add(createTestPattern({ id: 'appr', status: 'approved' }));
      await patternStore.add(createTestPattern({ id: 'ign', status: 'ignored' }));

      expect(patternStore.get('disc')?.status).toBe('discovered');
      expect(patternStore.get('appr')?.status).toBe('approved');
      expect(patternStore.get('ign')?.status).toBe('ignored');
    });

    it('should return correct category values', async () => {
      const categories: PatternCategory[] = ['api', 'security', 'errors', 'logging', 'data-access', 'config', 'testing', 'performance', 'components', 'styling', 'structural', 'types', 'accessibility', 'documentation', 'auth'];
      
      for (const cat of categories) {
        await patternStore.add(createTestPattern({ id: `cat-${cat}`, category: cat }));
      }

      for (const cat of categories) {
        const pattern = patternStore.get(`cat-${cat}`);
        expect(pattern?.category).toBe(cat);
      }
    });
  });

  describe('drift_pattern_get Response Structure', () => {
    it('should return pattern with locations array', async () => {
      const pattern = createTestPattern({
        id: 'pattern-with-locs',
        locations: [
          { file: 'src/api/users.ts', line: 10, column: 5 },
          { file: 'src/api/posts.ts', line: 20, column: 3 },
          { file: 'src/api/comments.ts', line: 30, column: 8 },
        ],
      });
      await patternStore.add(pattern);

      const retrieved = patternStore.get('pattern-with-locs');
      expect(retrieved?.locations).toHaveLength(3);
      expect(retrieved?.locations[0]).toHaveProperty('file');
      expect(retrieved?.locations[0]).toHaveProperty('line');
      expect(retrieved?.locations[0]).toHaveProperty('column');
    });

    it('should return pattern with outliers array', async () => {
      const pattern = createTestPattern({
        id: 'pattern-with-outliers',
        outliers: [
          { file: 'src/legacy/old.ts', line: 100, column: 1, reason: 'Deprecated pattern', deviationScore: 0.7 },
        ],
      });
      await patternStore.add(pattern);

      const retrieved = patternStore.get('pattern-with-outliers');
      expect(retrieved?.outliers).toHaveLength(1);
      expect(retrieved?.outliers[0]).toHaveProperty('file');
      expect(retrieved?.outliers[0]).toHaveProperty('reason');
      expect(retrieved?.outliers[0]).toHaveProperty('deviationScore');
    });
  });


  describe('drift_contracts_list Response Structure', () => {
    it('should return contracts with all required MCP fields', async () => {
      await contractStore.add(createTestContract({ id: 'mcp-contract-1' }));

      const contracts = contractStore.getAll();
      const contract = contracts[0];

      expect(contract).toHaveProperty('id');
      expect(contract).toHaveProperty('method');
      expect(contract).toHaveProperty('endpoint');
      expect(contract).toHaveProperty('status');
      expect(contract).toHaveProperty('backend');
      expect(contract).toHaveProperty('frontend');
      expect(contract).toHaveProperty('confidence');
      expect(contract).toHaveProperty('mismatches');
      expect(contract).toHaveProperty('metadata');
    });

    it('should return correct HTTP methods', async () => {
      const methods: HttpMethod[] = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'];
      
      for (const method of methods) {
        await contractStore.add(createTestContract({ id: `method-${method}`, method }));
      }

      for (const method of methods) {
        const contract = contractStore.get(`method-${method}`);
        expect(contract?.method).toBe(method);
      }
    });

    it('should return correct contract statuses', async () => {
      const statuses: ContractStatus[] = ['discovered', 'verified', 'mismatch', 'ignored'];
      
      for (const status of statuses) {
        await contractStore.add(createTestContract({ id: `status-${status}`, status }));
      }

      for (const status of statuses) {
        const contract = contractStore.get(`status-${status}`);
        expect(contract?.status).toBe(status);
      }
    });
  });

  describe('drift_status Response Structure', () => {
    it('should return correct pattern counts by status', async () => {
      // Add patterns with different statuses
      for (let i = 0; i < 10; i++) await patternStore.add(createTestPattern({ id: `disc-${i}`, status: 'discovered' }));
      for (let i = 0; i < 5; i++) await patternStore.add(createTestPattern({ id: `appr-${i}`, status: 'approved' }));
      for (let i = 0; i < 3; i++) await patternStore.add(createTestPattern({ id: `ign-${i}`, status: 'ignored' }));

      const stats = patternStore.getStats();

      expect(stats.totalPatterns).toBe(18);
      expect(stats.byStatus.discovered).toBe(10);
      expect(stats.byStatus.approved).toBe(5);
      expect(stats.byStatus.ignored).toBe(3);
    });

    it('should return correct pattern counts by category', async () => {
      await patternStore.add(createTestPattern({ id: 'api-1', category: 'api' }));
      await patternStore.add(createTestPattern({ id: 'api-2', category: 'api' }));
      await patternStore.add(createTestPattern({ id: 'sec-1', category: 'security' }));
      await patternStore.add(createTestPattern({ id: 'err-1', category: 'errors' }));

      const stats = patternStore.getStats();

      expect(stats.byCategory.api).toBe(2);
      expect(stats.byCategory.security).toBe(1);
      expect(stats.byCategory.errors).toBe(1);
    });
  });
});


// ============================================================================
// Query and Pagination Tests (MCP tools use these)
// ============================================================================

describe('MCP Query and Pagination Tests', () => {
  let tempDir: string;
  let patternStore: HybridPatternStore;

  beforeEach(async () => {
    tempDir = createTempDir();
    patternStore = new HybridPatternStore({ rootDir: tempDir, sqliteOnly: true });
    await patternStore.initialize();

    // Add 50 patterns for pagination testing
    for (let i = 0; i < 50; i++) {
      await patternStore.add(createTestPattern({
        id: `pag-${i.toString().padStart(3, '0')}`,
        category: i % 2 === 0 ? 'api' : 'security',
        status: i % 3 === 0 ? 'approved' : 'discovered',
        confidence: { score: (i % 10) / 10, level: i % 10 >= 7 ? 'high' : 'medium', frequency: 0, consistency: 0, age: 0, spread: 0 },
      }));
    }
  });

  afterEach(async () => {
    if (patternStore) await patternStore.close();
    cleanupTempDir(tempDir);
  });

  describe('Pagination', () => {
    it('should return correct page size', () => {
      const result = patternStore.query({ pagination: { limit: 20, offset: 0 } });
      expect(result.patterns.length).toBe(20);
    });

    it('should return hasMore correctly', () => {
      const page1 = patternStore.query({ pagination: { limit: 20, offset: 0 } });
      const page3 = patternStore.query({ pagination: { limit: 20, offset: 40 } });

      expect(page1.hasMore).toBe(true);
      expect(page3.hasMore).toBe(false);
    });

    it('should return correct total count', () => {
      const result = patternStore.query({ pagination: { limit: 10, offset: 0 } });
      expect(result.total).toBe(50);
    });

    it('should paginate through all results correctly', () => {
      const allIds = new Set<string>();
      let offset = 0;
      const limit = 15;

      while (true) {
        const result = patternStore.query({ pagination: { limit, offset } });
        for (const p of result.patterns) {
          allIds.add(p.id);
        }
        if (!result.hasMore) break;
        offset += limit;
      }

      expect(allIds.size).toBe(50);
    });
  });

  describe('Filtering', () => {
    it('should filter by category correctly', () => {
      const result = patternStore.query({ filter: { category: 'api' } });
      expect(result.patterns.every(p => p.category === 'api')).toBe(true);
      expect(result.total).toBe(25); // Half are api
    });

    it('should filter by status correctly', () => {
      const result = patternStore.query({ filter: { status: 'approved' } });
      expect(result.patterns.every(p => p.status === 'approved')).toBe(true);
    });

    it('should filter by minConfidence correctly', () => {
      const result = patternStore.query({ filter: { minConfidence: 0.7 } });
      expect(result.patterns.every(p => p.confidence.score >= 0.7)).toBe(true);
    });

    it('should combine multiple filters', () => {
      const result = patternStore.query({
        filter: { category: 'api', status: 'discovered' },
      });
      expect(result.patterns.every(p => p.category === 'api' && p.status === 'discovered')).toBe(true);
    });
  });

  describe('Sorting', () => {
    it('should sort by confidence ascending', () => {
      const result = patternStore.query({ sort: { field: 'confidence', direction: 'asc' } });
      for (let i = 1; i < result.patterns.length; i++) {
        expect(result.patterns[i].confidence.score).toBeGreaterThanOrEqual(result.patterns[i - 1].confidence.score);
      }
    });

    it('should sort by confidence descending', () => {
      const result = patternStore.query({ sort: { field: 'confidence', direction: 'desc' } });
      for (let i = 1; i < result.patterns.length; i++) {
        expect(result.patterns[i].confidence.score).toBeLessThanOrEqual(result.patterns[i - 1].confidence.score);
      }
    });
  });
});


// ============================================================================
// Large Dataset Tests (Thousands of locations per pattern)
// ============================================================================

describe('Large Dataset Tests', () => {
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

  describe('Patterns with Many Locations', () => {
    it('should handle pattern with 1000 locations', async () => {
      // Create pattern
      await store.patterns.create({
        id: 'many-locs',
        name: 'Pattern with Many Locations',
        description: null,
        category: 'api',
        subcategory: null,
        status: 'discovered',
        confidence_score: 0.85,
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
      });

      // Add 1000 locations
      const startTime = Date.now();
      for (let i = 0; i < 1000; i++) {
        await store.patterns.addLocation('many-locs', {
          pattern_id: 'many-locs',
          file: `src/file${i}.ts`,
          line: i * 10,
          column_num: i % 100,
          end_line: null,
          end_column: null,
          is_outlier: 0,
          outlier_reason: null,
          deviation_score: null,
          confidence: 0.9,
          snippet: null,
        });
      }
      const addTime = Date.now() - startTime;
      console.log(`Added 1000 locations in ${addTime}ms`);

      // Retrieve locations
      const queryStart = Date.now();
      const locations = await store.patterns.getLocations('many-locs');
      const queryTime = Date.now() - queryStart;
      console.log(`Retrieved ${locations.length} locations in ${queryTime}ms`);

      expect(locations.length).toBe(1000);
      expect(queryTime).toBeLessThan(500); // Should be fast with index
    });

    it('should handle pattern with 500 outliers', async () => {
      await store.patterns.create({
        id: 'many-outliers',
        name: 'Pattern with Many Outliers',
        description: null,
        category: 'security',
        subcategory: null,
        status: 'discovered',
        confidence_score: 0.7,
        confidence_level: 'medium',
        confidence_frequency: null,
        confidence_consistency: null,
        confidence_age: null,
        confidence_spread: null,
        detector_type: null,
        detector_config: null,
        severity: 'warning',
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

      for (let i = 0; i < 500; i++) {
        await store.patterns.addLocation('many-outliers', {
          pattern_id: 'many-outliers',
          file: `src/legacy/file${i}.ts`,
          line: i * 5,
          column_num: 0,
          end_line: null,
          end_column: null,
          is_outlier: 1,
          outlier_reason: `Outlier reason ${i}`,
          deviation_score: (i % 100) / 100,
          confidence: 0.5,
          snippet: null,
        });
      }

      const outliers = await store.patterns.getOutliers('many-outliers');
      expect(outliers.length).toBe(500);
    });
  });


  describe('Large Call Graph', () => {
    it('should handle 500 functions with call relationships', async () => {
      // Add 500 functions
      const startTime = Date.now();
      for (let i = 0; i < 500; i++) {
        await store.callGraph.addFunction({
          id: `func-${i}`,
          name: `function${i}`,
          qualified_name: `Module.function${i}`,
          file: `src/module${Math.floor(i / 10)}.ts`,
          start_line: (i % 100) * 10,
          end_line: (i % 100) * 10 + 9,
          language: 'typescript',
          is_exported: i % 2 === 0 ? 1 : 0,
          is_entry_point: i < 10 ? 1 : 0,
          is_data_accessor: i % 5 === 0 ? 1 : 0,
          is_constructor: 0,
          is_async: i % 3 === 0 ? 1 : 0,
          decorators: null,
          parameters: null,
          signature: null,
        });
      }
      const funcTime = Date.now() - startTime;
      console.log(`Added 500 functions in ${funcTime}ms`);

      // Add call relationships (each function calls 2-3 others)
      const callStart = Date.now();
      for (let i = 10; i < 500; i++) {
        await store.callGraph.addCall({
          caller_id: `func-${i}`,
          callee_id: `func-${i % 10}`,
          callee_name: `function${i % 10}`,
          line: (i % 100) * 10 + 5,
          column_num: 10,
          resolved: 1,
          confidence: 0.95,
          argument_count: i % 3,
        });
      }
      const callTime = Date.now() - callStart;
      console.log(`Added ${490} call relationships in ${callTime}ms`);

      // Query callers
      const queryStart = Date.now();
      const callers = await store.callGraph.getCallers('func-0');
      const queryTime = Date.now() - queryStart;
      console.log(`Found ${callers.length} callers in ${queryTime}ms`);

      expect(callers.length).toBeGreaterThan(40); // Many functions call func-0
      expect(queryTime).toBeLessThan(100);
    });
  });

  describe('Large Boundary Data', () => {
    it('should handle 100 tables with access points', async () => {
      // Add 100 data models
      for (let i = 0; i < 100; i++) {
        await store.boundaries.addModel({
          name: `Model${i}`,
          table_name: `table_${i}`,
          file: `src/models/model${i}.ts`,
          line: i * 20,
          framework: 'prisma',
          confidence: 0.9,
          fields: JSON.stringify(['id', 'name', 'createdAt', 'updatedAt']),
        });

        // Add sensitive fields
        await store.boundaries.addSensitiveField({
          table_name: `table_${i}`,
          field_name: 'email',
          sensitivity: 'pii',
          reason: 'Contains email address',
        });

        // Add access points
        for (let j = 0; j < 5; j++) {
          await store.boundaries.addAccessPoint({
            id: `ap-${i}-${j}`,
            table_name: `table_${i}`,
            operation: j % 3 === 0 ? 'read' : j % 3 === 1 ? 'write' : 'delete',
            file: `src/services/service${i}.ts`,
            line: j * 10,
            column_num: 0,
            context: `operation${j}`,
            fields: null,
            is_raw_sql: 0,
            confidence: 0.85,
            function_id: null,
          });
        }
      }

      const models = await store.boundaries.getModels();
      expect(models.length).toBe(100);

      const accessPoints = await store.boundaries.getAccessPoints('table_50');
      expect(accessPoints.length).toBe(5);
    });
  });
});


// ============================================================================
// Database Recovery and Corruption Tests
// ============================================================================

describe('Database Recovery Tests', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
  });

  afterEach(() => {
    cleanupTempDir(tempDir);
  });

  describe('Recovery from Corruption', () => {
    it('should handle missing database file gracefully', async () => {
      const store = new UnifiedStore({ rootDir: tempDir });
      
      // Initialize creates the database
      await store.initialize();
      await store.patterns.create({
        id: 'test-1',
        name: 'Test',
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
      await store.close();

      // Delete the database file
      const dbPath = path.join(tempDir, '.drift', 'drift.db');
      fs.unlinkSync(dbPath);

      // Re-initialize should recreate the database
      const store2 = new UnifiedStore({ rootDir: tempDir });
      await store2.initialize();

      // Should work but data is gone
      const pattern = await store2.patterns.read('test-1');
      expect(pattern).toBeNull();

      await store2.close();
    });

    it('should handle WAL file cleanup', async () => {
      const store = new UnifiedStore({ rootDir: tempDir });
      await store.initialize();

      // Add some data
      for (let i = 0; i < 100; i++) {
        await store.patterns.create({
          id: `wal-test-${i}`,
          name: `WAL Test ${i}`,
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

      // Checkpoint to flush WAL
      await store.checkpoint();

      // WAL file should exist but be small after checkpoint
      const walPath = path.join(tempDir, '.drift', 'drift.db-wal');
      if (fs.existsSync(walPath)) {
        const walStats = fs.statSync(walPath);
        expect(walStats.size).toBeLessThan(100000); // Should be small after checkpoint
      }

      await store.close();
    });
  });

  describe('Concurrent Process Access', () => {
    it('should handle multiple store instances', async () => {
      // Create first store and add data
      const store1 = new UnifiedStore({ rootDir: tempDir });
      await store1.initialize();
      await store1.patterns.create({
        id: 'concurrent-1',
        name: 'Concurrent Test 1',
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

      // Create second store instance (simulating another process)
      const store2 = new UnifiedStore({ rootDir: tempDir });
      await store2.initialize();

      // Both should see the data
      const pattern1 = await store1.patterns.read('concurrent-1');
      const pattern2 = await store2.patterns.read('concurrent-1');

      expect(pattern1).not.toBeNull();
      expect(pattern2).not.toBeNull();
      expect(pattern1!.name).toBe(pattern2!.name);

      // Add from store2
      await store2.patterns.create({
        id: 'concurrent-2',
        name: 'Concurrent Test 2',
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

      // Store1 should see it (WAL mode allows this)
      const pattern3 = await store1.patterns.read('concurrent-2');
      expect(pattern3).not.toBeNull();

      await store1.close();
      await store2.close();
    });
  });
});


// ============================================================================
// Export/Import Round-Trip Tests
// ============================================================================

describe('Export/Import Round-Trip Tests', () => {
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

  describe('JSON Export/Import', () => {
    it('should preserve all data through JSON round-trip', async () => {
      // Add comprehensive test data
      await store.patterns.create({
        id: 'export-pattern',
        name: 'Export Test Pattern',
        description: 'Testing export functionality',
        category: 'api',
        subcategory: 'http',
        status: 'approved',
        confidence_score: 0.95,
        confidence_level: 'high',
        confidence_frequency: 0.9,
        confidence_consistency: 0.85,
        confidence_age: 0.8,
        confidence_spread: 10,
        detector_type: 'ast',
        detector_config: '{"language":"typescript"}',
        severity: 'warning',
        auto_fixable: 1,
        first_seen: '2024-01-01T00:00:00.000Z',
        last_seen: '2024-02-01T00:00:00.000Z',
        approved_at: '2024-01-15T00:00:00.000Z',
        approved_by: 'admin',
        tags: '["test","export"]',
        source: 'manual',
        location_count: 2,
        outlier_count: 1,
      });

      await store.patterns.addLocation('export-pattern', {
        pattern_id: 'export-pattern',
        file: 'src/api/users.ts',
        line: 10,
        column_num: 5,
        end_line: 15,
        end_column: 10,
        is_outlier: 0,
        outlier_reason: null,
        deviation_score: null,
        confidence: 0.95,
        snippet: 'const users = await db.query(...)',
      });

      // Export
      const exported = await store.export('json');
      const data = JSON.parse(exported.toString());

      // Verify export structure
      expect(data.version).toBe('1.0.0');
      expect(data.exportedAt).toBeDefined();
      expect(data.patterns).toBeDefined();
      expect(data.pattern_locations).toBeDefined();

      // Verify pattern data
      const exportedPattern = data.patterns.find((p: any) => p.id === 'export-pattern');
      expect(exportedPattern).toBeDefined();
      expect(exportedPattern.name).toBe('Export Test Pattern');
      expect(exportedPattern.confidence_score).toBe(0.95);
      expect(exportedPattern.tags).toBe('["test","export"]');

      // Verify location data
      const exportedLocation = data.pattern_locations.find((l: any) => l.pattern_id === 'export-pattern');
      expect(exportedLocation).toBeDefined();
      expect(exportedLocation.file).toBe('src/api/users.ts');
    });
  });

  describe('SQLite Export', () => {
    it('should export valid SQLite database', async () => {
      await store.patterns.create({
        id: 'sqlite-export',
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

      // Verify it's a valid SQLite file
      expect(exported.length).toBeGreaterThan(0);
      expect(exported.toString('utf8', 0, 16)).toContain('SQLite format 3');
    });
  });
});

// ============================================================================
// View Tests (v_status, v_category_counts, etc.)
// ============================================================================

describe('Database View Tests', () => {
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

  describe('v_status View', () => {
    it('should return correct status summary', async () => {
      // Add patterns
      for (let i = 0; i < 10; i++) {
        await store.patterns.create({
          id: `status-view-${i}`,
          name: `Status View Test ${i}`,
          description: null,
          category: i % 2 === 0 ? 'api' : 'security',
          subcategory: null,
          status: i % 3 === 0 ? 'approved' : 'discovered',
          confidence_score: (i % 10) / 10,
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

      const db = store.getDatabase();
      const status = db.prepare('SELECT * FROM v_status').get() as any;

      expect(status).toBeDefined();
      expect(status.total_patterns).toBe(10);
    });
  });

  describe('v_security_summary View', () => {
    it('should return security summary', async () => {
      // Add sensitive data
      await store.boundaries.addModel({
        name: 'User',
        table_name: 'users',
        file: 'src/models/user.ts',
        line: 10,
        framework: 'prisma',
        confidence: 0.9,
        fields: '["id","email","password_hash"]',
      });

      await store.boundaries.addSensitiveField({
        table_name: 'users',
        field_name: 'password_hash',
        sensitivity: 'auth',
        reason: 'Password hash',
      });

      const db = store.getDatabase();
      const summary = db.prepare('SELECT * FROM v_security_summary').get() as any;

      expect(summary).toBeDefined();
      expect(summary.total_tables).toBeGreaterThanOrEqual(1);
      expect(summary.sensitive_tables).toBeGreaterThanOrEqual(1);
    });
  });
});

