/**
 * Pattern Repository Tests
 *
 * Tests for the IPatternRepository interface implementations.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

import {
  FilePatternRepository,
  InMemoryPatternRepository,
  CachedPatternRepository,
  PatternNotFoundError,
  InvalidStatusTransitionError,
  PatternAlreadyExistsError,
  createPattern,
  type Pattern,
  type IPatternRepository,
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
    description: 'A test pattern',
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
// Shared Test Suite
// ============================================================================

function runRepositoryTests(
  name: string,
  createRepository: () => Promise<{ repo: IPatternRepository; cleanup: () => Promise<void> }>
) {
  describe(name, () => {
    let repo: IPatternRepository;
    let cleanup: () => Promise<void>;

    beforeEach(async () => {
      const result = await createRepository();
      repo = result.repo;
      cleanup = result.cleanup;
      await repo.initialize();
    });

    afterEach(async () => {
      await repo.close();
      await cleanup();
    });

    describe('CRUD Operations', () => {
      it('should add and get a pattern', async () => {
        const pattern = createTestPattern();
        await repo.add(pattern);

        const retrieved = await repo.get(pattern.id);
        expect(retrieved).not.toBeNull();
        expect(retrieved!.id).toBe(pattern.id);
        expect(retrieved!.name).toBe(pattern.name);
      });

      it('should throw when adding duplicate pattern', async () => {
        const pattern = createTestPattern();
        await repo.add(pattern);

        await expect(repo.add(pattern)).rejects.toThrow(PatternAlreadyExistsError);
      });

      it('should return null for non-existent pattern', async () => {
        const retrieved = await repo.get('non-existent');
        expect(retrieved).toBeNull();
      });

      it('should update a pattern', async () => {
        const pattern = createTestPattern();
        await repo.add(pattern);

        const updated = await repo.update(pattern.id, { name: 'Updated Name' });
        expect(updated.name).toBe('Updated Name');

        const retrieved = await repo.get(pattern.id);
        expect(retrieved!.name).toBe('Updated Name');
      });

      it('should throw when updating non-existent pattern', async () => {
        await expect(repo.update('non-existent', { name: 'Test' })).rejects.toThrow(
          PatternNotFoundError
        );
      });

      it('should delete a pattern', async () => {
        const pattern = createTestPattern();
        await repo.add(pattern);

        const deleted = await repo.delete(pattern.id);
        expect(deleted).toBe(true);

        const retrieved = await repo.get(pattern.id);
        expect(retrieved).toBeNull();
      });

      it('should return false when deleting non-existent pattern', async () => {
        const deleted = await repo.delete('non-existent');
        expect(deleted).toBe(false);
      });

      it('should add many patterns', async () => {
        const patterns = [
          createTestPattern({ id: 'pattern-1' }),
          createTestPattern({ id: 'pattern-2' }),
          createTestPattern({ id: 'pattern-3' }),
        ];

        await repo.addMany(patterns);

        const count = await repo.count();
        expect(count).toBe(3);
      });
    });

    describe('Querying', () => {
      beforeEach(async () => {
        // Add test patterns
        await repo.addMany([
          createTestPattern({
            id: 'p1',
            category: 'structural',
            status: 'discovered',
            confidence: 0.9,
          }),
          createTestPattern({
            id: 'p2',
            category: 'security',
            status: 'approved',
            confidence: 0.7,
          }),
          createTestPattern({
            id: 'p3',
            category: 'structural',
            status: 'ignored',
            confidence: 0.5,
          }),
        ]);
      });

      it('should query all patterns', async () => {
        const result = await repo.query({});
        expect(result.patterns.length).toBe(3);
        expect(result.total).toBe(3);
      });

      it('should filter by category', async () => {
        const result = await repo.query({
          filter: { categories: ['structural'] },
        });
        expect(result.patterns.length).toBe(2);
      });

      it('should filter by status', async () => {
        const result = await repo.query({
          filter: { statuses: ['discovered'] },
        });
        expect(result.patterns.length).toBe(1);
        expect(result.patterns[0].id).toBe('p1');
      });

      it('should filter by minimum confidence', async () => {
        const result = await repo.query({
          filter: { minConfidence: 0.8 },
        });
        expect(result.patterns.length).toBe(1);
        expect(result.patterns[0].id).toBe('p1');
      });

      it('should sort by confidence descending', async () => {
        const result = await repo.query({
          sort: { field: 'confidence', direction: 'desc' },
        });
        expect(result.patterns[0].confidence).toBeGreaterThanOrEqual(
          result.patterns[1].confidence
        );
      });

      it('should paginate results', async () => {
        const result = await repo.query({
          pagination: { offset: 0, limit: 2 },
        });
        expect(result.patterns.length).toBe(2);
        expect(result.total).toBe(3);
        expect(result.hasMore).toBe(true);
      });

      it('should get patterns by category', async () => {
        const patterns = await repo.getByCategory('structural');
        expect(patterns.length).toBe(2);
      });

      it('should get patterns by status', async () => {
        const patterns = await repo.getByStatus('approved');
        expect(patterns.length).toBe(1);
      });

      it('should get patterns by file', async () => {
        const patterns = await repo.getByFile('src/test.ts');
        expect(patterns.length).toBe(3);
      });

      it('should count patterns', async () => {
        const count = await repo.count();
        expect(count).toBe(3);
      });

      it('should count patterns with filter', async () => {
        const count = await repo.count({ categories: ['structural'] });
        expect(count).toBe(2);
      });
    });

    describe('Status Transitions', () => {
      it('should approve a discovered pattern', async () => {
        const pattern = createTestPattern({ status: 'discovered' });
        await repo.add(pattern);

        const approved = await repo.approve(pattern.id, 'test-user');
        expect(approved.status).toBe('approved');
        expect(approved.approvedBy).toBe('test-user');
        expect(approved.approvedAt).toBeDefined();
      });

      it('should ignore a discovered pattern', async () => {
        const pattern = createTestPattern({ status: 'discovered' });
        await repo.add(pattern);

        const ignored = await repo.ignore(pattern.id);
        expect(ignored.status).toBe('ignored');
      });

      it('should throw on invalid status transition', async () => {
        const pattern = createTestPattern({ status: 'approved' });
        await repo.add(pattern);

        await expect(repo.approve(pattern.id)).rejects.toThrow(
          InvalidStatusTransitionError
        );
      });

      it('should allow re-approving an ignored pattern', async () => {
        const pattern = createTestPattern({ status: 'ignored' });
        await repo.add(pattern);

        const approved = await repo.approve(pattern.id);
        expect(approved.status).toBe('approved');
      });
    });

    describe('Utilities', () => {
      it('should check if pattern exists', async () => {
        const pattern = createTestPattern();
        await repo.add(pattern);

        expect(await repo.exists(pattern.id)).toBe(true);
        expect(await repo.exists('non-existent')).toBe(false);
      });

      it('should get pattern summaries', async () => {
        const pattern = createTestPattern();
        await repo.add(pattern);

        const summaries = await repo.getSummaries();
        expect(summaries.length).toBe(1);
        expect(summaries[0].id).toBe(pattern.id);
        expect(summaries[0].locationCount).toBe(1);
      });

      it('should clear all patterns', async () => {
        await repo.addMany([
          createTestPattern({ id: 'p1' }),
          createTestPattern({ id: 'p2' }),
        ]);

        await repo.clear();

        const count = await repo.count();
        expect(count).toBe(0);
      });
    });

    describe('Events', () => {
      it('should emit pattern:added event', async () => {
        const pattern = createTestPattern();
        let emittedPattern: Pattern | undefined;

        repo.on('pattern:added', (p) => {
          emittedPattern = p;
        });

        await repo.add(pattern);

        expect(emittedPattern).toBeDefined();
        expect(emittedPattern!.id).toBe(pattern.id);
      });

      it('should emit pattern:updated event', async () => {
        const pattern = createTestPattern();
        await repo.add(pattern);

        let emittedPattern: Pattern | undefined;
        repo.on('pattern:updated', (p) => {
          emittedPattern = p;
        });

        await repo.update(pattern.id, { name: 'Updated' });

        expect(emittedPattern).toBeDefined();
        expect(emittedPattern!.name).toBe('Updated');
      });

      it('should emit pattern:deleted event', async () => {
        const pattern = createTestPattern();
        await repo.add(pattern);

        let emittedPattern: Pattern | undefined;
        repo.on('pattern:deleted', (p) => {
          emittedPattern = p;
        });

        await repo.delete(pattern.id);

        expect(emittedPattern).toBeDefined();
        expect(emittedPattern!.id).toBe(pattern.id);
      });

      it('should emit pattern:approved event', async () => {
        const pattern = createTestPattern({ status: 'discovered' });
        await repo.add(pattern);

        let emittedPattern: Pattern | undefined;
        repo.on('pattern:approved', (p) => {
          emittedPattern = p;
        });

        await repo.approve(pattern.id);

        expect(emittedPattern).toBeDefined();
        expect(emittedPattern!.status).toBe('approved');
      });
    });
  });
}

// ============================================================================
// Run Tests for Each Implementation
// ============================================================================

// In-Memory Repository Tests
runRepositoryTests('InMemoryPatternRepository', async () => {
  const repo = new InMemoryPatternRepository();
  return {
    repo,
    cleanup: async () => {},
  };
});

// File Repository Tests
runRepositoryTests('FilePatternRepository', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'drift-test-'));
  const repo = new FilePatternRepository({ rootDir: tempDir });
  return {
    repo,
    cleanup: async () => {
      await fs.rm(tempDir, { recursive: true, force: true });
    },
  };
});

// Cached Repository Tests
runRepositoryTests('CachedPatternRepository', async () => {
  const inner = new InMemoryPatternRepository();
  const repo = new CachedPatternRepository(inner);
  return {
    repo,
    cleanup: async () => {},
  };
});

// ============================================================================
// Cached Repository Specific Tests
// ============================================================================

describe('CachedPatternRepository (cache-specific)', () => {
  let inner: InMemoryPatternRepository;
  let cached: CachedPatternRepository;

  beforeEach(async () => {
    inner = new InMemoryPatternRepository();
    cached = new CachedPatternRepository(inner, {
      patternTtlMs: 100,
      queryTtlMs: 50,
    });
    await cached.initialize();
  });

  afterEach(async () => {
    await cached.close();
  });

  it('should cache pattern lookups', async () => {
    const pattern = createTestPattern();
    await cached.add(pattern);

    // First lookup - from inner
    const first = await cached.get(pattern.id);
    expect(first).not.toBeNull();

    // Modify inner directly (bypassing cache)
    await inner.update(pattern.id, { name: 'Modified' });

    // Second lookup - should still return cached value
    const second = await cached.get(pattern.id);
    expect(second!.name).toBe(pattern.name); // Original name from cache
  });

  it('should invalidate cache on update', async () => {
    const pattern = createTestPattern();
    await cached.add(pattern);

    // Update through cached repo
    await cached.update(pattern.id, { name: 'Updated' });

    // Should return updated value
    const retrieved = await cached.get(pattern.id);
    expect(retrieved!.name).toBe('Updated');
  });

  it('should provide cache stats', async () => {
    const pattern = createTestPattern();
    await cached.add(pattern);
    await cached.get(pattern.id);

    const stats = cached.getCacheStats();
    expect(stats.patternCacheSize).toBeGreaterThan(0);
  });

  it('should clear cache manually', async () => {
    const pattern = createTestPattern();
    await cached.add(pattern);
    await cached.get(pattern.id);

    cached.clearCache();

    const stats = cached.getCacheStats();
    expect(stats.patternCacheSize).toBe(0);
  });
});
