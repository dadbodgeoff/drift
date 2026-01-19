/**
 * Unit tests for HistoryStore
 *
 * Tests pattern history tracking, querying, and pruning.
 *
 * @requirements 4.4 - THE Pattern_Store SHALL maintain history of pattern changes in .drift/history/
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  HistoryStore,
  HistoryStoreError,
  PatternHistoryNotFoundError,
} from './history-store.js';
import type {
  Pattern,
  PatternCategory,
  HistoryEventType,
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

describe('HistoryStore', () => {
  let store: HistoryStore;
  let testDir: string;

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'drift-history-store-test-'));
    store = new HistoryStore({ rootDir: testDir });
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
    it('should create history directory on initialize', async () => {
      const historyDir = path.join(testDir, '.drift', 'history');
      
      const exists = await fs.access(historyDir)
        .then(() => true).catch(() => false);

      expect(exists).toBe(true);
    });

    it('should set isLoaded to true after initialization', () => {
      expect(store.isLoaded).toBe(true);
    });

    it('should start with empty store', () => {
      expect(store.size).toBe(0);
    });
  });

  // ==========================================================================
  // Recording Events Tests
  // ==========================================================================

  describe('recording events', () => {
    describe('recordEvent()', () => {
      it('should record a basic event', () => {
        const event = store.recordEvent('pattern-1', 'structural', 'created');
        
        expect(event.patternId).toBe('pattern-1');
        expect(event.type).toBe('created');
        expect(event.timestamp).toBeDefined();
      });

      it('should record event with user', () => {
        const event = store.recordEvent('pattern-1', 'structural', 'approved', {
          user: 'test-user',
        });
        
        expect(event.user).toBe('test-user');
      });

      it('should record event with previous and new values', () => {
        const event = store.recordEvent('pattern-1', 'structural', 'updated', {
          previousValue: { name: 'Old Name' },
          newValue: { name: 'New Name' },
        });
        
        expect(event.previousValue).toEqual({ name: 'Old Name' });
        expect(event.newValue).toEqual({ name: 'New Name' });
      });

      it('should record event with details', () => {
        const event = store.recordEvent('pattern-1', 'structural', 'locations_changed', {
          details: { added: 5, removed: 2 },
        });
        
        expect(event.details).toEqual({ added: 5, removed: 2 });
      });

      it('should create pattern history if not exists', () => {
        expect(store.hasPatternHistory('pattern-1')).toBe(false);
        
        store.recordEvent('pattern-1', 'structural', 'created');
        
        expect(store.hasPatternHistory('pattern-1')).toBe(true);
      });

      it('should add event to existing pattern history', () => {
        store.recordEvent('pattern-1', 'structural', 'created');
        store.recordEvent('pattern-1', 'structural', 'approved');
        
        const history = store.getPatternHistory('pattern-1');
        expect(history?.events).toHaveLength(2);
      });

      it('should mark store as dirty after recording', () => {
        store.recordEvent('pattern-1', 'structural', 'created');
        
        expect(store.isDirty).toBe(true);
      });
    });

    describe('recordCreated()', () => {
      it('should record pattern creation', () => {
        const pattern = createTestPattern({ id: 'pattern-1' });
        const event = store.recordCreated(pattern, 'test-user');
        
        expect(event.type).toBe('created');
        expect(event.patternId).toBe('pattern-1');
        expect(event.user).toBe('test-user');
        expect(event.newValue).toBeDefined();
      });
    });

    describe('recordApproved()', () => {
      it('should record pattern approval', () => {
        const pattern = createTestPattern({ id: 'pattern-1', status: 'approved' });
        const event = store.recordApproved(pattern, 'test-user');
        
        expect(event.type).toBe('approved');
        expect(event.patternId).toBe('pattern-1');
        expect(event.user).toBe('test-user');
        expect(event.details?.confidence).toBe(pattern.confidence.score);
      });
    });

    describe('recordIgnored()', () => {
      it('should record pattern ignore', () => {
        const pattern = createTestPattern({ id: 'pattern-1', status: 'ignored' });
        const event = store.recordIgnored(pattern, 'test-user');
        
        expect(event.type).toBe('ignored');
        expect(event.patternId).toBe('pattern-1');
        expect(event.user).toBe('test-user');
      });
    });

    describe('recordDeleted()', () => {
      it('should record pattern deletion', () => {
        const pattern = createTestPattern({ id: 'pattern-1' });
        const event = store.recordDeleted(pattern, 'test-user');
        
        expect(event.type).toBe('deleted');
        expect(event.patternId).toBe('pattern-1');
        expect(event.previousValue).toBeDefined();
      });
    });

    describe('recordConfidenceChanged()', () => {
      it('should record confidence change', () => {
        const pattern = createTestPattern({ id: 'pattern-1' });
        const event = store.recordConfidenceChanged(pattern, 0.5, 'test-user');
        
        expect(event.type).toBe('confidence_changed');
        expect(event.previousValue).toBe(0.5);
        expect(event.newValue).toBe(pattern.confidence.score);
      });
    });

    describe('recordLocationsChanged()', () => {
      it('should record locations change', () => {
        const pattern = createTestPattern({ id: 'pattern-1' });
        const event = store.recordLocationsChanged(pattern, 5, 'test-user');
        
        expect(event.type).toBe('locations_changed');
        expect(event.previousValue).toBe(5);
        expect(event.newValue).toBe(pattern.locations.length);
        expect(event.details?.added).toBeDefined();
        expect(event.details?.removed).toBeDefined();
      });
    });

    describe('recordSeverityChanged()', () => {
      it('should record severity change', () => {
        const pattern = createTestPattern({ id: 'pattern-1', severity: 'error' });
        const event = store.recordSeverityChanged(pattern, 'warning', 'test-user');
        
        expect(event.type).toBe('severity_changed');
        expect(event.previousValue).toBe('warning');
        expect(event.newValue).toBe('error');
      });
    });
  });

  // ==========================================================================
  // Querying Tests
  // ==========================================================================

  describe('querying', () => {
    beforeEach(() => {
      // Add test events
      const pattern1 = createTestPattern({ id: 'pattern-1', category: 'structural' });
      const pattern2 = createTestPattern({ id: 'pattern-2', category: 'components' });
      const pattern3 = createTestPattern({ id: 'pattern-3', category: 'api' });
      
      store.recordCreated(pattern1, 'user-1');
      store.recordApproved(pattern1, 'user-1');
      store.recordCreated(pattern2, 'user-2');
      store.recordIgnored(pattern2, 'user-2');
      store.recordCreated(pattern3, 'user-1');
    });

    describe('getPatternHistory()', () => {
      it('should return history for existing pattern', () => {
        const history = store.getPatternHistory('pattern-1');
        
        expect(history).toBeDefined();
        expect(history?.patternId).toBe('pattern-1');
        expect(history?.events).toHaveLength(2);
      });

      it('should return undefined for non-existent pattern', () => {
        expect(store.getPatternHistory('nonexistent')).toBeUndefined();
      });
    });

    describe('getPatternHistoryOrThrow()', () => {
      it('should return history for existing pattern', () => {
        const history = store.getPatternHistoryOrThrow('pattern-1');
        
        expect(history.patternId).toBe('pattern-1');
      });

      it('should throw PatternHistoryNotFoundError for non-existent pattern', () => {
        expect(() => store.getPatternHistoryOrThrow('nonexistent'))
          .toThrow(PatternHistoryNotFoundError);
      });
    });

    describe('hasPatternHistory()', () => {
      it('should return true for existing pattern', () => {
        expect(store.hasPatternHistory('pattern-1')).toBe(true);
      });

      it('should return false for non-existent pattern', () => {
        expect(store.hasPatternHistory('nonexistent')).toBe(false);
      });
    });

    describe('query()', () => {
      it('should return all events when no filter', () => {
        const result = store.query();
        
        expect(result.events).toHaveLength(5);
        expect(result.total).toBe(5);
      });

      it('should filter by pattern ID', () => {
        const result = store.query({ patternId: 'pattern-1' });
        
        expect(result.events).toHaveLength(2);
        expect(result.events.every(e => e.patternId === 'pattern-1')).toBe(true);
      });

      it('should filter by multiple pattern IDs', () => {
        const result = store.query({ patternIds: ['pattern-1', 'pattern-2'] });
        
        expect(result.events).toHaveLength(4);
      });

      it('should filter by event type', () => {
        const result = store.query({ eventType: 'created' });
        
        expect(result.events).toHaveLength(3);
        expect(result.events.every(e => e.type === 'created')).toBe(true);
      });

      it('should filter by multiple event types', () => {
        const result = store.query({ eventType: ['approved', 'ignored'] });
        
        expect(result.events).toHaveLength(2);
      });

      it('should filter by category', () => {
        const result = store.query({ category: 'structural' });
        
        expect(result.events).toHaveLength(2);
      });

      it('should filter by user', () => {
        const result = store.query({ user: 'user-1' });
        
        expect(result.events).toHaveLength(3);
        expect(result.events.every(e => e.user === 'user-1')).toBe(true);
      });

      it('should sort by timestamp descending', () => {
        const result = store.query();
        
        for (let i = 1; i < result.events.length; i++) {
          const prev = new Date(result.events[i - 1].timestamp).getTime();
          const curr = new Date(result.events[i].timestamp).getTime();
          expect(prev).toBeGreaterThanOrEqual(curr);
        }
      });

      it('should apply pagination with limit', () => {
        const result = store.query({ limit: 2 });
        
        expect(result.events).toHaveLength(2);
        expect(result.total).toBe(5);
        expect(result.hasMore).toBe(true);
      });

      it('should apply pagination with offset', () => {
        const allResult = store.query();
        const offsetResult = store.query({ offset: 2 });
        
        expect(offsetResult.events).toHaveLength(3);
        expect(offsetResult.events[0].timestamp).toBe(allResult.events[2].timestamp);
      });

      it('should combine limit and offset', () => {
        const result = store.query({ offset: 1, limit: 2 });
        
        expect(result.events).toHaveLength(2);
        expect(result.total).toBe(5);
        expect(result.hasMore).toBe(true);
      });
    });

    describe('convenience query methods', () => {
      it('getAllEvents() should return all events', () => {
        expect(store.getAllEvents()).toHaveLength(5);
      });

      it('getEventsByType() should filter by type', () => {
        expect(store.getEventsByType('created')).toHaveLength(3);
      });

      it('getEventsByCategory() should filter by category', () => {
        expect(store.getEventsByCategory('structural')).toHaveLength(2);
      });

      it('getRecentEvents() should return limited events', () => {
        expect(store.getRecentEvents(2)).toHaveLength(2);
      });

      it('getApprovalHistory() should return approval events', () => {
        const approvals = store.getApprovalHistory();
        expect(approvals).toHaveLength(1);
        expect(approvals[0].type).toBe('approved');
      });

      it('getEventsByUser() should filter by user', () => {
        expect(store.getEventsByUser('user-1')).toHaveLength(3);
      });
    });
  });

  // ==========================================================================
  // Date Range Query Tests
  // ==========================================================================

  describe('date range queries', () => {
    it('should filter events after a date', async () => {
      const pattern = createTestPattern({ id: 'pattern-1' });
      
      // Record an event
      store.recordCreated(pattern);
      
      // Wait a bit
      await new Promise(resolve => setTimeout(resolve, 10));
      
      const afterDate = new Date().toISOString();
      
      // Wait a bit more
      await new Promise(resolve => setTimeout(resolve, 10));
      
      // Record another event
      store.recordApproved(pattern);
      
      const result = store.query({ after: afterDate });
      
      expect(result.events).toHaveLength(1);
      expect(result.events[0].type).toBe('approved');
    });

    it('should filter events before a date', async () => {
      const pattern = createTestPattern({ id: 'pattern-1' });
      
      // Record an event
      store.recordCreated(pattern);
      
      // Wait a bit
      await new Promise(resolve => setTimeout(resolve, 10));
      
      const beforeDate = new Date().toISOString();
      
      // Wait a bit more
      await new Promise(resolve => setTimeout(resolve, 10));
      
      // Record another event
      store.recordApproved(pattern);
      
      const result = store.query({ before: beforeDate });
      
      expect(result.events).toHaveLength(1);
      expect(result.events[0].type).toBe('created');
    });
  });

  // ==========================================================================
  // Persistence Tests
  // ==========================================================================

  describe('persistence', () => {
    /**
     * @requirements 4.4 - Persist history in .drift/history/
     */
    it('should save history to disk', async () => {
      const pattern = createTestPattern({ id: 'pattern-1' });
      store.recordCreated(pattern);
      store.recordApproved(pattern);
      
      await store.save();
      
      const filePath = path.join(testDir, '.drift', 'history', 'patterns.json');
      const content = await fs.readFile(filePath, 'utf-8');
      const parsed = JSON.parse(content);
      
      expect(parsed.version).toBe('1.0.0');
      expect(parsed.patterns).toHaveLength(1);
      expect(parsed.patterns[0].patternId).toBe('pattern-1');
      expect(parsed.patterns[0].events).toHaveLength(2);
    });

    it('should load history from disk', async () => {
      const pattern = createTestPattern({ id: 'pattern-1' });
      store.recordCreated(pattern);
      store.recordApproved(pattern);
      await store.save();
      
      // Create new store and load
      const newStore = new HistoryStore({ rootDir: testDir });
      await newStore.initialize();
      
      expect(newStore.hasPatternHistory('pattern-1')).toBe(true);
      const history = newStore.getPatternHistory('pattern-1');
      expect(history?.events).toHaveLength(2);
      
      newStore.dispose();
    });

    it('should clear dirty flag after save', async () => {
      const pattern = createTestPattern({ id: 'pattern-1' });
      store.recordCreated(pattern);
      expect(store.isDirty).toBe(true);
      
      await store.save();
      
      expect(store.isDirty).toBe(false);
    });
  });

  // ==========================================================================
  // Pruning Tests
  // ==========================================================================

  describe('pruning', () => {
    it('should prune events exceeding maxEntriesPerPattern', async () => {
      const storeWithLimit = new HistoryStore({
        rootDir: testDir,
        maxEntriesPerPattern: 3,
      });
      await storeWithLimit.initialize();
      
      const pattern = createTestPattern({ id: 'pattern-1' });
      
      // Record more events than the limit
      for (let i = 0; i < 5; i++) {
        storeWithLimit.recordEvent('pattern-1', 'structural', 'updated', {
          details: { index: i },
        });
      }
      
      const history = storeWithLimit.getPatternHistory('pattern-1');
      expect(history?.events.length).toBeLessThanOrEqual(3);
      
      storeWithLimit.dispose();
    });

    it('should prune old events based on maxAgeDays', async () => {
      const storeWithAge = new HistoryStore({
        rootDir: testDir,
        maxAgeDays: 0, // Immediately expire
      });
      await storeWithAge.initialize();
      
      const pattern = createTestPattern({ id: 'pattern-1' });
      storeWithAge.recordCreated(pattern);
      
      // Wait a tiny bit
      await new Promise(resolve => setTimeout(resolve, 10));
      
      // Prune should remove the event
      storeWithAge.prune();
      
      const history = storeWithAge.getPatternHistory('pattern-1');
      expect(history).toBeUndefined(); // History removed because empty
      
      storeWithAge.dispose();
    });

    it('should remove empty histories after prune', async () => {
      const storeWithAge = new HistoryStore({
        rootDir: testDir,
        maxAgeDays: 0,
      });
      await storeWithAge.initialize();
      
      const pattern = createTestPattern({ id: 'pattern-1' });
      storeWithAge.recordCreated(pattern);
      
      await new Promise(resolve => setTimeout(resolve, 10));
      
      storeWithAge.prune();
      
      expect(storeWithAge.size).toBe(0);
      
      storeWithAge.dispose();
    });
  });

  // ==========================================================================
  // Delete Pattern History Tests
  // ==========================================================================

  describe('deletePatternHistory()', () => {
    it('should delete history for a pattern', () => {
      const pattern = createTestPattern({ id: 'pattern-1' });
      store.recordCreated(pattern);
      
      expect(store.hasPatternHistory('pattern-1')).toBe(true);
      
      const result = store.deletePatternHistory('pattern-1');
      
      expect(result).toBe(true);
      expect(store.hasPatternHistory('pattern-1')).toBe(false);
    });

    it('should return false for non-existent pattern', () => {
      expect(store.deletePatternHistory('nonexistent')).toBe(false);
    });

    it('should mark store as dirty after delete', () => {
      const pattern = createTestPattern({ id: 'pattern-1' });
      store.recordCreated(pattern);
      
      // Clear dirty flag
      store['dirty'] = false;
      
      store.deletePatternHistory('pattern-1');
      
      expect(store.isDirty).toBe(true);
    });
  });

  // ==========================================================================
  // Statistics Tests
  // ==========================================================================

  describe('statistics', () => {
    beforeEach(() => {
      const pattern1 = createTestPattern({ id: 'pattern-1' });
      const pattern2 = createTestPattern({ id: 'pattern-2' });
      
      store.recordCreated(pattern1);
      store.recordApproved(pattern1);
      store.recordCreated(pattern2);
      store.recordIgnored(pattern2);
      store.recordConfidenceChanged(pattern1, 0.5);
    });

    it('should return correct total patterns', () => {
      const stats = store.getStats();
      expect(stats.totalPatterns).toBe(2);
    });

    it('should return correct total events', () => {
      const stats = store.getStats();
      expect(stats.totalEvents).toBe(5);
    });

    it('should return correct events by type', () => {
      const stats = store.getStats();
      expect(stats.eventsByType.created).toBe(2);
      expect(stats.eventsByType.approved).toBe(1);
      expect(stats.eventsByType.ignored).toBe(1);
      expect(stats.eventsByType.confidence_changed).toBe(1);
    });

    it('should return oldest and newest event timestamps', () => {
      const stats = store.getStats();
      expect(stats.oldestEvent).toBeDefined();
      expect(stats.newestEvent).toBeDefined();
      expect(new Date(stats.oldestEvent!).getTime())
        .toBeLessThanOrEqual(new Date(stats.newestEvent!).getTime());
    });
  });

  // ==========================================================================
  // Event Tests
  // ==========================================================================

  describe('events', () => {
    it('should emit event:recorded on recordEvent', () => {
      const events: any[] = [];
      store.on('event:recorded', (e) => events.push(e));
      
      store.recordEvent('pattern-1', 'structural', 'created');
      
      expect(events).toHaveLength(1);
      expect(events[0].patternId).toBe('pattern-1');
      expect(events[0].data?.eventType).toBe('created');
    });

    it('should emit history:pruned on prune', () => {
      const events: any[] = [];
      store.on('history:pruned', (e) => events.push(e));
      
      store.prune();
      
      expect(events).toHaveLength(1);
    });

    it('should emit wildcard event for all events', () => {
      const events: any[] = [];
      store.on('*', (e) => events.push(e));
      
      const pattern = createTestPattern({ id: 'pattern-1' });
      store.recordCreated(pattern);
      store.prune();
      
      expect(events.length).toBeGreaterThanOrEqual(2);
    });
  });

  // ==========================================================================
  // Utility Tests
  // ==========================================================================

  describe('utility methods', () => {
    it('size should return correct count', () => {
      expect(store.size).toBe(0);
      
      store.recordEvent('pattern-1', 'structural', 'created');
      expect(store.size).toBe(1);
      
      store.recordEvent('pattern-2', 'components', 'created');
      expect(store.size).toBe(2);
    });

    it('clear() should remove all history from memory', () => {
      store.recordEvent('pattern-1', 'structural', 'created');
      store.recordEvent('pattern-2', 'components', 'created');
      
      store.clear();
      
      expect(store.size).toBe(0);
      expect(store.isDirty).toBe(true);
    });

    it('path should return history directory', () => {
      expect(store.path).toBe(path.join(testDir, '.drift', 'history'));
    });
  });
});
