/**
 * Pattern Service Tests
 *
 * Tests for the IPatternService implementation.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

import {
  InMemoryPatternRepository,
  PatternService,
  createPattern,
  type Pattern,
} from '../index.js';

// ============================================================================
// Test Fixtures
// ============================================================================

function createTestPattern(overrides: Partial<Pattern> = {}): Pattern {
  const base = createPattern({
    id: `test-pattern-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    category: 'structural',
    subcategory: 'naming',
    name: 'Test Pattern',
    description: 'A test pattern for testing',
    detectorId: 'test-detector',
    detectorName: 'Test Detector',
    detectionMethod: 'ast',
    confidence: 0.9,
    locations: [
      { file: 'src/test.ts', line: 10, column: 1 },
    ],
  });

  // Apply overrides (including status which createPattern doesn't accept)
  return {
    ...base,
    ...overrides,
    // Ensure id is unique if not overridden
    id: overrides.id ?? base.id,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('PatternService', () => {
  let repo: InMemoryPatternRepository;
  let service: PatternService;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'drift-service-test-'));
    repo = new InMemoryPatternRepository();
    await repo.initialize();
    service = new PatternService(repo, tempDir);
  });

  afterEach(async () => {
    await repo.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('getStatus', () => {
    it('should return empty status for empty repository', async () => {
      const status = await service.getStatus();

      expect(status.totalPatterns).toBe(0);
      expect(status.byStatus.discovered).toBe(0);
      expect(status.byStatus.approved).toBe(0);
      expect(status.byStatus.ignored).toBe(0);
      expect(status.healthScore).toBe(100);
    });

    it('should compute correct status counts', async () => {
      await repo.addMany([
        createTestPattern({ id: 'p1', status: 'discovered', category: 'structural' }),
        createTestPattern({ id: 'p2', status: 'approved', category: 'security' }),
        createTestPattern({ id: 'p3', status: 'approved', category: 'structural' }),
        createTestPattern({ id: 'p4', status: 'ignored', category: 'api' }),
      ]);

      const status = await service.getStatus();

      expect(status.totalPatterns).toBe(4);
      expect(status.byStatus.discovered).toBe(1);
      expect(status.byStatus.approved).toBe(2);
      expect(status.byStatus.ignored).toBe(1);
      expect(status.byCategory.structural).toBe(2);
      expect(status.byCategory.security).toBe(1);
      expect(status.byCategory.api).toBe(1);
    });

    it('should compute health score based on approval rate', async () => {
      // All approved = higher health score
      await repo.addMany([
        createTestPattern({ id: 'p1', status: 'approved', confidence: 0.9 }),
        createTestPattern({ id: 'p2', status: 'approved', confidence: 0.9 }),
      ]);

      const status = await service.getStatus();
      expect(status.healthScore).toBeGreaterThan(50);
    });

    it('should cache status results', async () => {
      await repo.add(createTestPattern({ id: 'p1' }));

      const status1 = await service.getStatus();
      
      // Add another pattern directly to repo (bypassing service)
      await repo.add(createTestPattern({ id: 'p2' }));

      // Should return cached result
      const status2 = await service.getStatus();
      expect(status2.totalPatterns).toBe(status1.totalPatterns);
    });
  });

  describe('getCategories', () => {
    it('should return empty array for empty repository', async () => {
      const categories = await service.getCategories();
      expect(categories).toEqual([]);
    });

    it('should return category summaries', async () => {
      await repo.addMany([
        createTestPattern({ id: 'p1', category: 'structural', status: 'approved', confidence: 0.9 }),
        createTestPattern({ id: 'p2', category: 'structural', status: 'discovered', confidence: 0.7 }),
        createTestPattern({ id: 'p3', category: 'security', status: 'approved', confidence: 0.95 }),
      ]);

      const categories = await service.getCategories();

      expect(categories.length).toBe(2);

      const structural = categories.find((c) => c.category === 'structural');
      expect(structural).toBeDefined();
      expect(structural!.count).toBe(2);
      expect(structural!.approvedCount).toBe(1);
      expect(structural!.discoveredCount).toBe(1);
      expect(structural!.highConfidenceCount).toBe(1);

      const security = categories.find((c) => c.category === 'security');
      expect(security).toBeDefined();
      expect(security!.count).toBe(1);
      expect(security!.highConfidenceCount).toBe(1);
    });
  });

  describe('listPatterns', () => {
    beforeEach(async () => {
      await repo.addMany([
        createTestPattern({ id: 'p1', name: 'Alpha Pattern' }),
        createTestPattern({ id: 'p2', name: 'Beta Pattern' }),
        createTestPattern({ id: 'p3', name: 'Gamma Pattern' }),
      ]);
    });

    it('should list all patterns', async () => {
      const result = await service.listPatterns();

      expect(result.items.length).toBe(3);
      expect(result.total).toBe(3);
      expect(result.hasMore).toBe(false);
    });

    it('should paginate results', async () => {
      const result = await service.listPatterns({ offset: 0, limit: 2 });

      expect(result.items.length).toBe(2);
      expect(result.total).toBe(3);
      expect(result.hasMore).toBe(true);
      expect(result.offset).toBe(0);
      expect(result.limit).toBe(2);
    });

    it('should sort by name', async () => {
      const result = await service.listPatterns({
        sortBy: 'name',
        sortDirection: 'asc',
      });

      expect(result.items[0].name).toBe('Alpha Pattern');
      expect(result.items[2].name).toBe('Gamma Pattern');
    });
  });

  describe('listByCategory', () => {
    beforeEach(async () => {
      await repo.addMany([
        createTestPattern({ id: 'p1', category: 'structural' }),
        createTestPattern({ id: 'p2', category: 'structural' }),
        createTestPattern({ id: 'p3', category: 'security' }),
      ]);
    });

    it('should list patterns by category', async () => {
      const result = await service.listByCategory('structural');

      expect(result.items.length).toBe(2);
      expect(result.total).toBe(2);
    });
  });

  describe('listByStatus', () => {
    beforeEach(async () => {
      await repo.addMany([
        createTestPattern({ id: 'p1', status: 'discovered' }),
        createTestPattern({ id: 'p2', status: 'approved' }),
        createTestPattern({ id: 'p3', status: 'approved' }),
      ]);
    });

    it('should list patterns by status', async () => {
      const result = await service.listByStatus('approved');

      expect(result.items.length).toBe(2);
      expect(result.total).toBe(2);
    });
  });

  describe('getPattern', () => {
    it('should get a pattern by ID', async () => {
      const pattern = createTestPattern({ id: 'test-id' });
      await repo.add(pattern);

      const retrieved = await service.getPattern('test-id');

      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe('test-id');
    });

    it('should return null for non-existent pattern', async () => {
      const retrieved = await service.getPattern('non-existent');
      expect(retrieved).toBeNull();
    });
  });

  describe('getPatternWithExamples', () => {
    it('should return null for non-existent pattern', async () => {
      const result = await service.getPatternWithExamples('non-existent');
      expect(result).toBeNull();
    });

    it('should return pattern with empty examples if files not found', async () => {
      const pattern = createTestPattern({
        id: 'test-id',
        locations: [{ file: 'non-existent.ts', line: 10, column: 1 }],
      });
      await repo.add(pattern);

      const result = await service.getPatternWithExamples('test-id');

      expect(result).not.toBeNull();
      expect(result!.codeExamples).toEqual([]);
    });

    it('should extract code examples from existing files', async () => {
      // Create a test file
      const testFile = path.join(tempDir, 'src', 'test.ts');
      await fs.mkdir(path.dirname(testFile), { recursive: true });
      await fs.writeFile(
        testFile,
        `// Line 1
// Line 2
// Line 3
// Line 4
// Line 5
function test() {
  return 42;
}
// Line 9
// Line 10`
      );

      const pattern = createTestPattern({
        id: 'test-id',
        locations: [{ file: 'src/test.ts', line: 6, column: 1, endLine: 8 }],
      });
      await repo.add(pattern);

      const result = await service.getPatternWithExamples('test-id');

      expect(result).not.toBeNull();
      expect(result!.codeExamples.length).toBe(1);
      expect(result!.codeExamples[0].file).toBe('src/test.ts');
      expect(result!.codeExamples[0].language).toBe('typescript');
      expect(result!.codeExamples[0].code).toContain('function test()');
    });

    it('should include related patterns', async () => {
      await repo.addMany([
        createTestPattern({ id: 'p1', category: 'structural', subcategory: 'naming' }),
        createTestPattern({ id: 'p2', category: 'structural', subcategory: 'naming' }),
        createTestPattern({ id: 'p3', category: 'security', subcategory: 'auth' }),
      ]);

      const result = await service.getPatternWithExamples('p1');

      expect(result).not.toBeNull();
      expect(result!.relatedPatterns.length).toBeGreaterThan(0);
      expect(result!.relatedPatterns.some((p) => p.id === 'p2')).toBe(true);
    });
  });

  describe('approvePattern', () => {
    it('should approve a pattern', async () => {
      const pattern = createTestPattern({ id: 'test-id', status: 'discovered' });
      await repo.add(pattern);

      const approved = await service.approvePattern('test-id', 'test-user');

      expect(approved.status).toBe('approved');
      expect(approved.approvedBy).toBe('test-user');
    });

    it('should invalidate status cache', async () => {
      const pattern = createTestPattern({ id: 'test-id', status: 'discovered' });
      await repo.add(pattern);

      // Get status to populate cache
      const status1 = await service.getStatus();
      expect(status1.byStatus.discovered).toBe(1);

      // Approve pattern
      await service.approvePattern('test-id');

      // Status should reflect the change
      const status2 = await service.getStatus();
      expect(status2.byStatus.approved).toBe(1);
      expect(status2.byStatus.discovered).toBe(0);
    });
  });

  describe('ignorePattern', () => {
    it('should ignore a pattern', async () => {
      const pattern = createTestPattern({ id: 'test-id', status: 'discovered' });
      await repo.add(pattern);

      const ignored = await service.ignorePattern('test-id');

      expect(ignored.status).toBe('ignored');
    });
  });

  describe('approveMany', () => {
    it('should approve multiple patterns', async () => {
      await repo.addMany([
        createTestPattern({ id: 'p1', status: 'discovered' }),
        createTestPattern({ id: 'p2', status: 'discovered' }),
      ]);

      const approved = await service.approveMany(['p1', 'p2'], 'test-user');

      expect(approved.length).toBe(2);
      expect(approved.every((p) => p.status === 'approved')).toBe(true);
    });
  });

  describe('ignoreMany', () => {
    it('should ignore multiple patterns', async () => {
      await repo.addMany([
        createTestPattern({ id: 'p1', status: 'discovered' }),
        createTestPattern({ id: 'p2', status: 'discovered' }),
      ]);

      const ignored = await service.ignoreMany(['p1', 'p2']);

      expect(ignored.length).toBe(2);
      expect(ignored.every((p) => p.status === 'ignored')).toBe(true);
    });
  });

  describe('search', () => {
    beforeEach(async () => {
      await repo.addMany([
        createTestPattern({ id: 'p1', name: 'File Naming Convention', description: 'Enforces file naming' }),
        createTestPattern({ id: 'p2', name: 'Import Ordering', description: 'Enforces import order' }),
        createTestPattern({ id: 'p3', name: 'SQL Injection Prevention', description: 'Prevents SQL injection' }),
      ]);
    });

    it('should search by name', async () => {
      const results = await service.search('naming');

      expect(results.length).toBe(1);
      expect(results[0].id).toBe('p1');
    });

    it('should search by description', async () => {
      const results = await service.search('import');

      expect(results.length).toBe(1);
      expect(results[0].id).toBe('p2');
    });

    it('should limit results', async () => {
      const results = await service.search('', { limit: 2 });

      expect(results.length).toBe(2);
    });

    it('should filter by category', async () => {
      await repo.add(
        createTestPattern({ id: 'p4', name: 'Security Pattern', category: 'security' })
      );

      const results = await service.search('pattern', { categories: ['security'] });

      expect(results.length).toBe(1);
      expect(results[0].id).toBe('p4');
    });
  });

  describe('query', () => {
    it('should execute custom queries', async () => {
      await repo.addMany([
        createTestPattern({ id: 'p1', confidence: 0.9 }),
        createTestPattern({ id: 'p2', confidence: 0.5 }),
      ]);

      const result = await service.query({
        filter: { minConfidence: 0.8 },
      });

      expect(result.patterns.length).toBe(1);
      expect(result.patterns[0].id).toBe('p1');
    });
  });

  // ==========================================================================
  // Write Operations Tests
  // ==========================================================================

  describe('addPattern', () => {
    it('should add a pattern', async () => {
      const pattern = createTestPattern({ id: 'new-pattern' });

      await service.addPattern(pattern);

      const retrieved = await service.getPattern('new-pattern');
      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe('new-pattern');
    });

    it('should invalidate status cache after adding', async () => {
      // Get initial status (caches it)
      const status1 = await service.getStatus();
      expect(status1.totalPatterns).toBe(0);

      // Add a pattern
      await service.addPattern(createTestPattern({ id: 'p1' }));

      // Status should reflect the new pattern
      const status2 = await service.getStatus();
      expect(status2.totalPatterns).toBe(1);
    });
  });

  describe('addPatterns', () => {
    it('should add multiple patterns', async () => {
      const patterns = [
        createTestPattern({ id: 'p1' }),
        createTestPattern({ id: 'p2' }),
        createTestPattern({ id: 'p3' }),
      ];

      await service.addPatterns(patterns);

      const result = await service.listPatterns();
      expect(result.total).toBe(3);
    });
  });

  describe('updatePattern', () => {
    it('should update a pattern', async () => {
      await service.addPattern(createTestPattern({ id: 'p1', name: 'Original Name' }));

      const updated = await service.updatePattern('p1', { name: 'Updated Name' });

      expect(updated.name).toBe('Updated Name');

      const retrieved = await service.getPattern('p1');
      expect(retrieved!.name).toBe('Updated Name');
    });

    it('should invalidate status cache after updating', async () => {
      await service.addPattern(createTestPattern({ id: 'p1', category: 'structural' }));

      // Get initial status (caches it)
      const status1 = await service.getStatus();
      expect(status1.byCategory.structural).toBe(1);

      // Update the pattern's category
      await service.updatePattern('p1', { category: 'security' });

      // Status should reflect the change
      const status2 = await service.getStatus();
      expect(status2.byCategory.structural).toBe(0);
      expect(status2.byCategory.security).toBe(1);
    });
  });

  describe('deletePattern', () => {
    it('should delete a pattern', async () => {
      await service.addPattern(createTestPattern({ id: 'p1' }));

      const deleted = await service.deletePattern('p1');

      expect(deleted).toBe(true);

      const retrieved = await service.getPattern('p1');
      expect(retrieved).toBeNull();
    });

    it('should return false for non-existent pattern', async () => {
      const deleted = await service.deletePattern('non-existent');
      expect(deleted).toBe(false);
    });

    it('should invalidate status cache after deleting', async () => {
      await service.addPattern(createTestPattern({ id: 'p1' }));

      // Get initial status (caches it)
      const status1 = await service.getStatus();
      expect(status1.totalPatterns).toBe(1);

      // Delete the pattern
      await service.deletePattern('p1');

      // Status should reflect the deletion
      const status2 = await service.getStatus();
      expect(status2.totalPatterns).toBe(0);
    });
  });

  describe('save', () => {
    it('should save all pending changes', async () => {
      await service.addPattern(createTestPattern({ id: 'p1' }));

      // Should not throw
      await expect(service.save()).resolves.not.toThrow();
    });
  });

  describe('clear', () => {
    it('should clear all patterns', async () => {
      await service.addPatterns([
        createTestPattern({ id: 'p1' }),
        createTestPattern({ id: 'p2' }),
      ]);

      await service.clear();

      const result = await service.listPatterns();
      expect(result.total).toBe(0);
    });

    it('should invalidate status cache after clearing', async () => {
      await service.addPattern(createTestPattern({ id: 'p1' }));

      // Get initial status (caches it)
      const status1 = await service.getStatus();
      expect(status1.totalPatterns).toBe(1);

      // Clear all patterns
      await service.clear();

      // Status should reflect the clear
      const status2 = await service.getStatus();
      expect(status2.totalPatterns).toBe(0);
    });
  });
});
