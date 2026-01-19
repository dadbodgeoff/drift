/**
 * Unit tests for PatternStore
 *
 * Tests pattern persistence, querying, and state transitions.
 *
 * @requirements 4.1 - THE Pattern_Store SHALL persist patterns as JSON in .drift/patterns/
 * @requirements 4.3 - WHEN a pattern is approved, THE Pattern_Store SHALL move it from discovered/ to approved/
 * @requirements 4.6 - THE Pattern_Store SHALL support querying patterns by category, confidence, and status
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  PatternStore,
  PatternNotFoundError,
  InvalidStateTransitionError,
  PatternStoreError,
} from './pattern-store.js';
import type {
  Pattern,
  PatternCategory,
  PatternStatus,
  ConfidenceLevel,
  Severity,
} from './types.js';

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Create a test pattern with default values
 */
function createTestPattern(overrides: Partial<Pattern> = {}): Pattern {
  const now = new Date().toISOString();
  return {
    id: `test-pattern-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    category: 'structural',
    subcategory: 'file-naming',
    name: 'Test Pattern',
    description: 'A test pattern for unit testing',
    detector: {
      type: 'regex',
      config: { pattern: '.*\\.test\\.ts$' },
    },
    confidence: {
      frequency: 0.9,
      consistency: 0.85,
      age: 30,
      spread: 10,
      score: 0.87,
      level: 'high',
    },
    locations: [
      { file: 'src/test.ts', line: 1, column: 1 },
    ],
    outliers: [],
    metadata: {
      firstSeen: now,
      lastSeen: now,
    },
    severity: 'warning',
    autoFixable: false,
    status: 'discovered',
    ...overrides,
  };
}

describe('PatternStore', () => {
  let store: PatternStore;
  let testDir: string;

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'drift-pattern-store-test-'));
    store = new PatternStore({ rootDir: testDir, validateSchema: true });
    await store.initialize();
  });

  afterEach(async () => {
    store.dispose();
    await fs.rm(testDir, { recursive: true, force: true });
  });

  // ==========================================================================
  // Initialization Tests
  // ==========================================================================

  describe('initialization', () => {
    it('should create directory structure on initialize', async () => {
      const patternsDir = path.join(testDir, '.drift', 'patterns');
      
      const discoveredExists = await fs.access(path.join(patternsDir, 'discovered'))
        .then(() => true).catch(() => false);
      const approvedExists = await fs.access(path.join(patternsDir, 'approved'))
        .then(() => true).catch(() => false);
      const ignoredExists = await fs.access(path.join(patternsDir, 'ignored'))
        .then(() => true).catch(() => false);

      expect(discoveredExists).toBe(true);
      expect(approvedExists).toBe(true);
      expect(ignoredExists).toBe(true);
    });

    it('should set isLoaded to true after initialization', () => {
      expect(store.isLoaded).toBe(true);
    });

    it('should start with empty store', () => {
      expect(store.size).toBe(0);
    });
  });

  // ==========================================================================
  // CRUD Operations Tests
  // ==========================================================================

  describe('CRUD operations', () => {
    describe('add()', () => {
      it('should add a new pattern', () => {
        const pattern = createTestPattern();
        store.add(pattern);
        
        expect(store.has(pattern.id)).toBe(true);
        expect(store.size).toBe(1);
      });

      it('should throw error when adding duplicate pattern', () => {
        const pattern = createTestPattern();
        store.add(pattern);
        
        expect(() => store.add(pattern)).toThrow(PatternStoreError);
      });

      it('should mark store as dirty after add', () => {
        const pattern = createTestPattern();
        store.add(pattern);
        
        expect(store.isDirty).toBe(true);
      });
    });

    describe('get()', () => {
      it('should retrieve an existing pattern', () => {
        const pattern = createTestPattern();
        store.add(pattern);
        
        const retrieved = store.get(pattern.id);
        expect(retrieved).toEqual(pattern);
      });

      it('should return undefined for non-existent pattern', () => {
        expect(store.get('nonexistent')).toBeUndefined();
      });
    });

    describe('getOrThrow()', () => {
      it('should retrieve an existing pattern', () => {
        const pattern = createTestPattern();
        store.add(pattern);
        
        const retrieved = store.getOrThrow(pattern.id);
        expect(retrieved).toEqual(pattern);
      });

      it('should throw PatternNotFoundError for non-existent pattern', () => {
        expect(() => store.getOrThrow('nonexistent')).toThrow(PatternNotFoundError);
      });
    });

    describe('has()', () => {
      it('should return true for existing pattern', () => {
        const pattern = createTestPattern();
        store.add(pattern);
        
        expect(store.has(pattern.id)).toBe(true);
      });

      it('should return false for non-existent pattern', () => {
        expect(store.has('nonexistent')).toBe(false);
      });
    });

    describe('update()', () => {
      it('should update an existing pattern', () => {
        const pattern = createTestPattern();
        store.add(pattern);
        
        const updated = store.update(pattern.id, { name: 'Updated Name' });
        
        expect(updated.name).toBe('Updated Name');
        expect(store.get(pattern.id)?.name).toBe('Updated Name');
      });

      it('should throw PatternNotFoundError for non-existent pattern', () => {
        expect(() => store.update('nonexistent', { name: 'Test' })).toThrow(PatternNotFoundError);
      });

      it('should not allow changing pattern ID', () => {
        const pattern = createTestPattern();
        store.add(pattern);
        
        const updated = store.update(pattern.id, { id: 'new-id' } as any);
        
        expect(updated.id).toBe(pattern.id);
      });
    });

    describe('delete()', () => {
      it('should delete an existing pattern', () => {
        const pattern = createTestPattern();
        store.add(pattern);
        
        const result = store.delete(pattern.id);
        
        expect(result).toBe(true);
        expect(store.has(pattern.id)).toBe(false);
      });

      it('should return false for non-existent pattern', () => {
        expect(store.delete('nonexistent')).toBe(false);
      });
    });
  });

  // ==========================================================================
  // Status Transition Tests
  // ==========================================================================

  describe('status transitions', () => {
    /**
     * @requirements 4.3 - Move pattern from discovered/ to approved/
     */
    describe('approve()', () => {
      it('should approve a discovered pattern', () => {
        const pattern = createTestPattern({ status: 'discovered' });
        store.add(pattern);
        
        const approved = store.approve(pattern.id, 'test-user');
        
        expect(approved.status).toBe('approved');
        expect(approved.metadata.approvedAt).toBeDefined();
        expect(approved.metadata.approvedBy).toBe('test-user');
      });

      it('should throw InvalidStateTransitionError for already approved pattern', () => {
        const pattern = createTestPattern({ status: 'approved' });
        store.add(pattern);
        
        expect(() => store.approve(pattern.id)).toThrow(InvalidStateTransitionError);
      });

      it('should allow approving an ignored pattern', () => {
        const pattern = createTestPattern({ status: 'ignored' });
        store.add(pattern);
        
        const approved = store.approve(pattern.id);
        
        expect(approved.status).toBe('approved');
      });
    });

    describe('ignore()', () => {
      it('should ignore a discovered pattern', () => {
        const pattern = createTestPattern({ status: 'discovered' });
        store.add(pattern);
        
        const ignored = store.ignore(pattern.id);
        
        expect(ignored.status).toBe('ignored');
      });

      it('should ignore an approved pattern', () => {
        const pattern = createTestPattern({ status: 'approved' });
        store.add(pattern);
        
        const ignored = store.ignore(pattern.id);
        
        expect(ignored.status).toBe('ignored');
      });

      it('should throw InvalidStateTransitionError for already ignored pattern', () => {
        const pattern = createTestPattern({ status: 'ignored' });
        store.add(pattern);
        
        expect(() => store.ignore(pattern.id)).toThrow(InvalidStateTransitionError);
      });
    });
  });

  // ==========================================================================
  // Persistence Tests
  // ==========================================================================

  describe('persistence', () => {
    /**
     * @requirements 4.1 - Persist patterns as JSON in .drift/patterns/
     */
    it('should save patterns to disk', async () => {
      const pattern = createTestPattern({ category: 'structural', status: 'discovered' });
      store.add(pattern);
      
      await store.saveAll();
      
      const filePath = path.join(testDir, '.drift', 'patterns', 'discovered', 'structural.json');
      const content = await fs.readFile(filePath, 'utf-8');
      const parsed = JSON.parse(content);
      
      expect(parsed.version).toBe('1.0.0');
      expect(parsed.category).toBe('structural');
      expect(parsed.patterns).toHaveLength(1);
      expect(parsed.patterns[0].id).toBe(pattern.id);
    });

    it('should load patterns from disk', async () => {
      const pattern = createTestPattern({ category: 'components', status: 'approved' });
      store.add(pattern);
      await store.saveAll();
      
      // Create new store and load
      const newStore = new PatternStore({ rootDir: testDir, validateSchema: true });
      await newStore.initialize();
      
      expect(newStore.has(pattern.id)).toBe(true);
      const loaded = newStore.get(pattern.id);
      expect(loaded?.name).toBe(pattern.name);
      expect(loaded?.status).toBe('approved');
      expect(loaded?.category).toBe('components');
      
      newStore.dispose();
    });

    it('should save patterns to correct status directories', async () => {
      const discovered = createTestPattern({ id: 'discovered-1', status: 'discovered' });
      const approved = createTestPattern({ id: 'approved-1', status: 'approved' });
      const ignored = createTestPattern({ id: 'ignored-1', status: 'ignored' });
      
      store.add(discovered);
      store.add(approved);
      store.add(ignored);
      await store.saveAll();
      
      const discoveredPath = path.join(testDir, '.drift', 'patterns', 'discovered', 'structural.json');
      const approvedPath = path.join(testDir, '.drift', 'patterns', 'approved', 'structural.json');
      const ignoredPath = path.join(testDir, '.drift', 'patterns', 'ignored', 'structural.json');
      
      const discoveredContent = JSON.parse(await fs.readFile(discoveredPath, 'utf-8'));
      const approvedContent = JSON.parse(await fs.readFile(approvedPath, 'utf-8'));
      const ignoredContent = JSON.parse(await fs.readFile(ignoredPath, 'utf-8'));
      
      expect(discoveredContent.patterns.some((p: any) => p.id === 'discovered-1')).toBe(true);
      expect(approvedContent.patterns.some((p: any) => p.id === 'approved-1')).toBe(true);
      expect(ignoredContent.patterns.some((p: any) => p.id === 'ignored-1')).toBe(true);
    });

    it('should remove empty category files', async () => {
      const pattern = createTestPattern({ category: 'api', status: 'discovered' });
      store.add(pattern);
      await store.saveAll();
      
      const filePath = path.join(testDir, '.drift', 'patterns', 'discovered', 'api.json');
      expect(await fs.access(filePath).then(() => true).catch(() => false)).toBe(true);
      
      store.delete(pattern.id);
      await store.saveAll();
      
      expect(await fs.access(filePath).then(() => true).catch(() => false)).toBe(false);
    });

    it('should clear dirty flag after save', async () => {
      const pattern = createTestPattern();
      store.add(pattern);
      expect(store.isDirty).toBe(true);
      
      await store.saveAll();
      
      expect(store.isDirty).toBe(false);
    });
  });

  // ==========================================================================
  // Query Tests
  // ==========================================================================

  describe('querying', () => {
    beforeEach(() => {
      // Add test patterns with various attributes
      store.add(createTestPattern({
        id: 'structural-high-discovered',
        category: 'structural',
        status: 'discovered',
        confidence: { frequency: 0.9, consistency: 0.9, age: 30, spread: 10, score: 0.9, level: 'high' },
        severity: 'error',
      }));
      store.add(createTestPattern({
        id: 'structural-medium-approved',
        category: 'structural',
        status: 'approved',
        confidence: { frequency: 0.7, consistency: 0.7, age: 20, spread: 5, score: 0.7, level: 'medium' },
        severity: 'warning',
      }));
      store.add(createTestPattern({
        id: 'components-low-discovered',
        category: 'components',
        status: 'discovered',
        confidence: { frequency: 0.5, consistency: 0.5, age: 10, spread: 3, score: 0.5, level: 'low' },
        severity: 'info',
      }));
      store.add(createTestPattern({
        id: 'api-uncertain-ignored',
        category: 'api',
        status: 'ignored',
        confidence: { frequency: 0.3, consistency: 0.3, age: 5, spread: 2, score: 0.3, level: 'uncertain' },
        severity: 'hint',
      }));
    });

    /**
     * @requirements 4.6 - Query by category
     */
    describe('query by category', () => {
      it('should filter by single category', () => {
        const result = store.query({ filter: { category: 'structural' } });
        
        expect(result.patterns).toHaveLength(2);
        expect(result.patterns.every(p => p.category === 'structural')).toBe(true);
      });

      it('should filter by multiple categories', () => {
        const result = store.query({ filter: { category: ['structural', 'components'] } });
        
        expect(result.patterns).toHaveLength(3);
      });
    });

    /**
     * @requirements 4.6 - Query by status
     */
    describe('query by status', () => {
      it('should filter by single status', () => {
        const result = store.query({ filter: { status: 'discovered' } });
        
        expect(result.patterns).toHaveLength(2);
        expect(result.patterns.every(p => p.status === 'discovered')).toBe(true);
      });

      it('should filter by multiple statuses', () => {
        const result = store.query({ filter: { status: ['discovered', 'approved'] } });
        
        expect(result.patterns).toHaveLength(3);
      });
    });

    /**
     * @requirements 4.6 - Query by confidence
     */
    describe('query by confidence', () => {
      it('should filter by confidence level', () => {
        const result = store.query({ filter: { confidenceLevel: 'high' } });
        
        expect(result.patterns).toHaveLength(1);
        expect(result.patterns[0].confidence.level).toBe('high');
      });

      it('should filter by minimum confidence score', () => {
        const result = store.query({ filter: { minConfidence: 0.6 } });
        
        expect(result.patterns).toHaveLength(2);
        expect(result.patterns.every(p => p.confidence.score >= 0.6)).toBe(true);
      });

      it('should filter by maximum confidence score', () => {
        const result = store.query({ filter: { maxConfidence: 0.6 } });
        
        expect(result.patterns).toHaveLength(2);
        expect(result.patterns.every(p => p.confidence.score <= 0.6)).toBe(true);
      });

      it('should filter by confidence range', () => {
        const result = store.query({ filter: { minConfidence: 0.4, maxConfidence: 0.8 } });
        
        expect(result.patterns).toHaveLength(2);
      });
    });

    describe('query by severity', () => {
      it('should filter by single severity', () => {
        const result = store.query({ filter: { severity: 'error' } });
        
        expect(result.patterns).toHaveLength(1);
        expect(result.patterns[0].severity).toBe('error');
      });

      it('should filter by multiple severities', () => {
        const result = store.query({ filter: { severity: ['error', 'warning'] } });
        
        expect(result.patterns).toHaveLength(2);
      });
    });

    describe('query with sorting', () => {
      it('should sort by confidence ascending', () => {
        const result = store.query({ sort: { field: 'confidence', direction: 'asc' } });
        
        const scores = result.patterns.map(p => p.confidence.score);
        expect(scores).toEqual([...scores].sort((a, b) => a - b));
      });

      it('should sort by confidence descending', () => {
        const result = store.query({ sort: { field: 'confidence', direction: 'desc' } });
        
        const scores = result.patterns.map(p => p.confidence.score);
        expect(scores).toEqual([...scores].sort((a, b) => b - a));
      });

      it('should sort by name', () => {
        const result = store.query({ sort: { field: 'name', direction: 'asc' } });
        
        const names = result.patterns.map(p => p.name);
        expect(names).toEqual([...names].sort());
      });
    });

    describe('query with pagination', () => {
      it('should limit results', () => {
        const result = store.query({ pagination: { limit: 2 } });
        
        expect(result.patterns).toHaveLength(2);
        expect(result.total).toBe(4);
        expect(result.hasMore).toBe(true);
      });

      it('should offset results', () => {
        const allResult = store.query({});
        const offsetResult = store.query({ pagination: { offset: 2 } });
        
        expect(offsetResult.patterns).toHaveLength(2);
        expect(offsetResult.patterns[0].id).toBe(allResult.patterns[2].id);
      });

      it('should combine limit and offset', () => {
        const result = store.query({ pagination: { offset: 1, limit: 2 } });
        
        expect(result.patterns).toHaveLength(2);
        expect(result.total).toBe(4);
        expect(result.hasMore).toBe(true);
      });
    });

    describe('combined queries', () => {
      it('should combine filter, sort, and pagination', () => {
        const result = store.query({
          filter: { status: 'discovered' },
          sort: { field: 'confidence', direction: 'desc' },
          pagination: { limit: 1 },
        });
        
        expect(result.patterns).toHaveLength(1);
        expect(result.patterns[0].status).toBe('discovered');
        expect(result.total).toBe(2);
        expect(result.hasMore).toBe(true);
      });
    });
  });

  // ==========================================================================
  // Convenience Query Methods Tests
  // ==========================================================================

  describe('convenience query methods', () => {
    beforeEach(() => {
      store.add(createTestPattern({
        id: 'p1',
        status: 'discovered',
        category: 'structural',
        confidence: { frequency: 0.5, consistency: 0.5, age: 10, spread: 3, score: 0.5, level: 'low' },
      }));
      store.add(createTestPattern({
        id: 'p2',
        status: 'approved',
        category: 'components',
        confidence: { frequency: 0.6, consistency: 0.6, age: 15, spread: 4, score: 0.6, level: 'low' },
      }));
      store.add(createTestPattern({
        id: 'p3',
        status: 'ignored',
        category: 'api',
        confidence: { frequency: 0.4, consistency: 0.4, age: 5, spread: 2, score: 0.4, level: 'uncertain' },
      }));
      store.add(createTestPattern({
        id: 'p4',
        status: 'discovered',
        category: 'structural',
        confidence: { frequency: 0.9, consistency: 0.9, age: 30, spread: 10, score: 0.9, level: 'high' },
      }));
    });

    it('getAll() should return all patterns', () => {
      expect(store.getAll()).toHaveLength(4);
    });

    it('getByCategory() should filter by category', () => {
      expect(store.getByCategory('structural')).toHaveLength(2);
    });

    it('getByStatus() should filter by status', () => {
      expect(store.getByStatus('discovered')).toHaveLength(2);
    });

    it('getApproved() should return approved patterns', () => {
      expect(store.getApproved()).toHaveLength(1);
      expect(store.getApproved()[0].status).toBe('approved');
    });

    it('getDiscovered() should return discovered patterns', () => {
      expect(store.getDiscovered()).toHaveLength(2);
    });

    it('getIgnored() should return ignored patterns', () => {
      expect(store.getIgnored()).toHaveLength(1);
    });

    it('getHighConfidence() should return high confidence patterns', () => {
      expect(store.getHighConfidence()).toHaveLength(1);
      expect(store.getHighConfidence()[0].confidence.level).toBe('high');
    });

    it('getByConfidenceLevel() should filter by confidence level', () => {
      expect(store.getByConfidenceLevel('high')).toHaveLength(1);
    });

    it('getByMinConfidence() should filter by minimum confidence', () => {
      expect(store.getByMinConfidence(0.85)).toHaveLength(1);
    });
  });

  // ==========================================================================
  // Statistics Tests
  // ==========================================================================

  describe('statistics', () => {
    beforeEach(() => {
      store.add(createTestPattern({
        id: 'p1',
        status: 'discovered',
        category: 'structural',
        confidence: { frequency: 0.5, consistency: 0.5, age: 10, spread: 3, score: 0.5, level: 'low' },
      }));
      store.add(createTestPattern({
        id: 'p2',
        status: 'approved',
        category: 'structural',
        confidence: { frequency: 0.6, consistency: 0.6, age: 15, spread: 4, score: 0.6, level: 'low' },
      }));
      store.add(createTestPattern({
        id: 'p3',
        status: 'ignored',
        category: 'components',
        confidence: { frequency: 0.4, consistency: 0.4, age: 5, spread: 2, score: 0.4, level: 'uncertain' },
      }));
      store.add(createTestPattern({
        id: 'p4',
        status: 'discovered',
        category: 'api',
        confidence: { frequency: 0.9, consistency: 0.9, age: 30, spread: 10, score: 0.9, level: 'high' },
        outliers: [{ file: 'test.ts', line: 1, column: 1, reason: 'test' }],
      }));
    });

    it('should return correct total patterns', () => {
      const stats = store.getStats();
      expect(stats.totalPatterns).toBe(4);
    });

    it('should return correct counts by status', () => {
      const stats = store.getStats();
      expect(stats.byStatus.discovered).toBe(2);
      expect(stats.byStatus.approved).toBe(1);
      expect(stats.byStatus.ignored).toBe(1);
    });

    it('should return correct counts by category', () => {
      const stats = store.getStats();
      expect(stats.byCategory.structural).toBe(2);
      expect(stats.byCategory.components).toBe(1);
      expect(stats.byCategory.api).toBe(1);
    });

    it('should return correct counts by confidence level', () => {
      const stats = store.getStats();
      expect(stats.byConfidenceLevel.high).toBe(1);
      expect(stats.byConfidenceLevel.low).toBe(2);
      expect(stats.byConfidenceLevel.uncertain).toBe(1);
    });

    it('should count total locations', () => {
      const stats = store.getStats();
      expect(stats.totalLocations).toBe(4); // Each pattern has 1 location
    });

    it('should count total outliers', () => {
      const stats = store.getStats();
      expect(stats.totalOutliers).toBe(1);
    });
  });

  // ==========================================================================
  // Event Tests
  // ==========================================================================

  describe('events', () => {
    it('should emit pattern:created event on add', () => {
      const events: any[] = [];
      store.on('pattern:created', (e) => events.push(e));
      
      const pattern = createTestPattern();
      store.add(pattern);
      
      expect(events).toHaveLength(1);
      expect(events[0].patternId).toBe(pattern.id);
    });

    it('should emit pattern:updated event on update', () => {
      const events: any[] = [];
      const pattern = createTestPattern();
      store.add(pattern);
      
      store.on('pattern:updated', (e) => events.push(e));
      store.update(pattern.id, { name: 'Updated' });
      
      expect(events).toHaveLength(1);
      expect(events[0].patternId).toBe(pattern.id);
    });

    it('should emit pattern:deleted event on delete', () => {
      const events: any[] = [];
      const pattern = createTestPattern();
      store.add(pattern);
      
      store.on('pattern:deleted', (e) => events.push(e));
      store.delete(pattern.id);
      
      expect(events).toHaveLength(1);
      expect(events[0].patternId).toBe(pattern.id);
    });

    it('should emit pattern:approved event on approve', () => {
      const events: any[] = [];
      const pattern = createTestPattern({ status: 'discovered' });
      store.add(pattern);
      
      store.on('pattern:approved', (e) => events.push(e));
      store.approve(pattern.id);
      
      expect(events).toHaveLength(1);
      expect(events[0].patternId).toBe(pattern.id);
    });

    it('should emit pattern:ignored event on ignore', () => {
      const events: any[] = [];
      const pattern = createTestPattern({ status: 'discovered' });
      store.add(pattern);
      
      store.on('pattern:ignored', (e) => events.push(e));
      store.ignore(pattern.id);
      
      expect(events).toHaveLength(1);
      expect(events[0].patternId).toBe(pattern.id);
    });

    it('should emit wildcard event for all events', () => {
      const events: any[] = [];
      store.on('*', (e) => events.push(e));
      
      const pattern = createTestPattern();
      store.add(pattern);
      store.update(pattern.id, { name: 'Updated' });
      store.delete(pattern.id);
      
      expect(events).toHaveLength(3);
    });
  });

  // ==========================================================================
  // Utility Tests
  // ==========================================================================

  describe('utility methods', () => {
    it('size should return correct count', () => {
      expect(store.size).toBe(0);
      
      store.add(createTestPattern({ id: 'p1' }));
      expect(store.size).toBe(1);
      
      store.add(createTestPattern({ id: 'p2' }));
      expect(store.size).toBe(2);
    });

    it('clear() should remove all patterns from memory', () => {
      store.add(createTestPattern({ id: 'p1' }));
      store.add(createTestPattern({ id: 'p2' }));
      
      store.clear();
      
      expect(store.size).toBe(0);
      expect(store.isDirty).toBe(true);
    });

    it('path should return patterns directory', () => {
      expect(store.path).toBe(path.join(testDir, '.drift', 'patterns'));
    });
  });
});
