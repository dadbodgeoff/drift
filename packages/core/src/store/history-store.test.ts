/**
 * Unit tests for HistoryStore
 *
 * Tests pattern snapshot creation, retrieval, and trend analysis.
 *
 * @requirements 4.4 - THE Pattern_Store SHALL maintain history of pattern changes in .drift/history/
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { HistoryStore } from './history-store.js';
import type { Pattern } from './types.js';

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Create a test pattern with default values
 */
function createTestPattern(overrides: Partial<Pattern> = {}): Pattern {
  const now = new Date().toISOString();
  return {
    id: overrides.id ?? `test-pattern-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    category: overrides.category ?? 'structural',
    subcategory: 'file-naming',
    name: overrides.name ?? 'Test Pattern',
    description: 'A test pattern for unit testing',
    detector: {
      type: 'regex',
      config: { pattern: '.*\\.test\\.ts$' },
    },
    confidence: overrides.confidence ?? {
      frequency: 0.9,
      consistency: 0.85,
      age: 30,
      spread: 10,
      score: 0.87,
      level: 'high',
    },
    locations: overrides.locations ?? [
      { file: 'src/test.ts', line: 1, column: 1 },
    ],
    outliers: overrides.outliers ?? [],
    metadata: {
      firstSeen: now,
      lastSeen: now,
    },
    severity: 'warning',
    autoFixable: false,
    status: overrides.status ?? 'discovered',
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
    await fs.rm(testDir, { recursive: true, force: true });
  });

  // ==========================================================================
  // Initialization Tests
  // ==========================================================================

  describe('initialization', () => {
    it('should create history directory on initialize', async () => {
      const historyDir = path.join(testDir, '.drift', 'history', 'snapshots');
      const exists = await fs.access(historyDir).then(() => true).catch(() => false);
      expect(exists).toBe(true);
    });
  });

  // ==========================================================================
  // Snapshot Creation Tests
  // ==========================================================================

  describe('createSnapshot', () => {
    it('should create a snapshot from patterns', async () => {
      const patterns = [
        createTestPattern({ id: 'pattern-1', name: 'Pattern 1' }),
        createTestPattern({ id: 'pattern-2', name: 'Pattern 2' }),
      ];

      const snapshot = await store.createSnapshot(patterns);

      expect(snapshot).toBeDefined();
      expect(snapshot.patterns).toHaveLength(2);
      expect(snapshot.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(snapshot.timestamp).toBeDefined();
    });

    it('should calculate summary correctly', async () => {
      const patterns = [
        createTestPattern({
          id: 'pattern-1',
          confidence: { frequency: 0.9, consistency: 0.9, age: 30, spread: 10, score: 0.9, level: 'high' },
          locations: [{ file: 'a.ts', line: 1, column: 1 }, { file: 'b.ts', line: 1, column: 1 }],
          outliers: [{ file: 'c.ts', line: 1, column: 1 }],
        }),
        createTestPattern({
          id: 'pattern-2',
          confidence: { frequency: 0.8, consistency: 0.8, age: 20, spread: 5, score: 0.8, level: 'high' },
          locations: [{ file: 'd.ts', line: 1, column: 1 }],
          outliers: [],
        }),
      ];

      const snapshot = await store.createSnapshot(patterns);

      expect(snapshot.summary.totalPatterns).toBe(2);
      expect(snapshot.summary.totalLocations).toBe(3);
      expect(snapshot.summary.totalOutliers).toBe(1);
      expect(snapshot.summary.avgConfidence).toBeCloseTo(0.85, 2);
    });

    it('should save snapshot to disk', async () => {
      const patterns = [createTestPattern()];
      const snapshot = await store.createSnapshot(patterns);

      const filePath = path.join(testDir, '.drift', 'history', 'snapshots', `${snapshot.date}.json`);
      const exists = await fs.access(filePath).then(() => true).catch(() => false);
      expect(exists).toBe(true);

      const content = await fs.readFile(filePath, 'utf-8');
      const saved = JSON.parse(content);
      expect(saved.date).toBe(snapshot.date);
    });

    it('should emit snapshot:created event', async () => {
      const patterns = [createTestPattern()];
      let emittedSnapshot: unknown = null;

      store.on('snapshot:created', (s) => {
        emittedSnapshot = s;
      });

      const snapshot = await store.createSnapshot(patterns);
      expect(emittedSnapshot).toBe(snapshot);
    });
  });

  // ==========================================================================
  // Snapshot Retrieval Tests
  // ==========================================================================

  describe('getSnapshots', () => {
    it('should return empty array when no snapshots exist', async () => {
      const snapshots = await store.getSnapshots();
      expect(snapshots).toEqual([]);
    });

    it('should return all snapshots', async () => {
      await store.createSnapshot([createTestPattern({ id: 'p1' })]);
      
      const snapshots = await store.getSnapshots();
      expect(snapshots).toHaveLength(1);
    });
  });

  describe('getLatestSnapshot', () => {
    it('should return null when no snapshots exist', async () => {
      const snapshot = await store.getLatestSnapshot();
      expect(snapshot).toBeNull();
    });

    it('should return the most recent snapshot', async () => {
      await store.createSnapshot([createTestPattern({ id: 'p1' })]);
      
      const snapshot = await store.getLatestSnapshot();
      expect(snapshot).not.toBeNull();
      expect(snapshot?.patterns).toHaveLength(1);
    });
  });

  // ==========================================================================
  // Trend Calculation Tests
  // ==========================================================================

  describe('calculateTrends', () => {
    it('should detect confidence regression', () => {
      const previous = {
        timestamp: '2024-01-01T00:00:00Z',
        date: '2024-01-01',
        patterns: [{
          patternId: 'p1',
          patternName: 'Pattern 1',
          category: 'structural' as const,
          confidence: 0.9,
          locationCount: 10,
          outlierCount: 0,
          complianceRate: 1,
          status: 'discovered' as const,
        }],
        summary: {
          totalPatterns: 1,
          avgConfidence: 0.9,
          totalLocations: 10,
          totalOutliers: 0,
          overallComplianceRate: 1,
          byCategory: {},
        },
      };

      const current = {
        ...previous,
        timestamp: '2024-01-08T00:00:00Z',
        date: '2024-01-08',
        patterns: [{
          ...previous.patterns[0],
          confidence: 0.7, // 20% drop
        }],
      };

      const trends = store.calculateTrends(current, previous);
      
      expect(trends).toHaveLength(1);
      expect(trends[0].type).toBe('regression');
      expect(trends[0].metric).toBe('confidence');
      expect(trends[0].severity).toBe('critical');
    });

    it('should detect compliance improvement', () => {
      const previous = {
        timestamp: '2024-01-01T00:00:00Z',
        date: '2024-01-01',
        patterns: [{
          patternId: 'p1',
          patternName: 'Pattern 1',
          category: 'structural' as const,
          confidence: 0.9,
          locationCount: 5,
          outlierCount: 5,
          complianceRate: 0.5,
          status: 'discovered' as const,
        }],
        summary: {
          totalPatterns: 1,
          avgConfidence: 0.9,
          totalLocations: 5,
          totalOutliers: 5,
          overallComplianceRate: 0.5,
          byCategory: {},
        },
      };

      const current = {
        ...previous,
        timestamp: '2024-01-08T00:00:00Z',
        date: '2024-01-08',
        patterns: [{
          ...previous.patterns[0],
          locationCount: 9,
          outlierCount: 1,
          complianceRate: 0.9, // 40% improvement
        }],
      };

      const trends = store.calculateTrends(current, previous);
      
      const complianceTrend = trends.find(t => t.metric === 'compliance');
      expect(complianceTrend).toBeDefined();
      expect(complianceTrend?.type).toBe('improvement');
    });

    it('should detect outlier increase', () => {
      const previous = {
        timestamp: '2024-01-01T00:00:00Z',
        date: '2024-01-01',
        patterns: [{
          patternId: 'p1',
          patternName: 'Pattern 1',
          category: 'structural' as const,
          confidence: 0.9,
          locationCount: 10,
          outlierCount: 0,
          complianceRate: 1,
          status: 'discovered' as const,
        }],
        summary: {
          totalPatterns: 1,
          avgConfidence: 0.9,
          totalLocations: 10,
          totalOutliers: 0,
          overallComplianceRate: 1,
          byCategory: {},
        },
      };

      const current = {
        ...previous,
        timestamp: '2024-01-08T00:00:00Z',
        date: '2024-01-08',
        patterns: [{
          ...previous.patterns[0],
          outlierCount: 5, // 5 new outliers
          complianceRate: 10 / 15,
        }],
      };

      const trends = store.calculateTrends(current, previous);
      
      const outlierTrend = trends.find(t => t.metric === 'outliers');
      expect(outlierTrend).toBeDefined();
      expect(outlierTrend?.type).toBe('regression');
    });

    it('should skip new patterns', () => {
      const previous = {
        timestamp: '2024-01-01T00:00:00Z',
        date: '2024-01-01',
        patterns: [],
        summary: {
          totalPatterns: 0,
          avgConfidence: 0,
          totalLocations: 0,
          totalOutliers: 0,
          overallComplianceRate: 1,
          byCategory: {},
        },
      };

      const current = {
        ...previous,
        timestamp: '2024-01-08T00:00:00Z',
        date: '2024-01-08',
        patterns: [{
          patternId: 'new-pattern',
          patternName: 'New Pattern',
          category: 'structural' as const,
          confidence: 0.9,
          locationCount: 10,
          outlierCount: 0,
          complianceRate: 1,
          status: 'discovered' as const,
        }],
      };

      const trends = store.calculateTrends(current, previous);
      expect(trends).toHaveLength(0);
    });
  });

  // ==========================================================================
  // Trend Summary Tests
  // ==========================================================================

  describe('getTrendSummary', () => {
    it('should return null when no snapshots exist', async () => {
      const summary = await store.getTrendSummary('7d');
      expect(summary).toBeNull();
    });
  });

  // ==========================================================================
  // Cleanup Tests
  // ==========================================================================

  describe('snapshot cleanup', () => {
    it('should respect maxSnapshots config', async () => {
      const smallStore = new HistoryStore({ rootDir: testDir, maxSnapshots: 2 });
      await smallStore.initialize();

      // Create 3 snapshots with different dates by manipulating files directly
      const snapshotsDir = path.join(testDir, '.drift', 'history', 'snapshots');
      
      await fs.writeFile(
        path.join(snapshotsDir, '2024-01-01.json'),
        JSON.stringify({ date: '2024-01-01', patterns: [], summary: {}, timestamp: '' })
      );
      await fs.writeFile(
        path.join(snapshotsDir, '2024-01-02.json'),
        JSON.stringify({ date: '2024-01-02', patterns: [], summary: {}, timestamp: '' })
      );

      // This should trigger cleanup
      await smallStore.createSnapshot([createTestPattern()]);

      const files = await fs.readdir(snapshotsDir);
      expect(files.filter(f => f.endsWith('.json'))).toHaveLength(2);
    });
  });
});
