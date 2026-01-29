/**
 * Audit Store Tests
 *
 * Unit tests for the AuditStore class covering:
 * - saveAudit() / loadLatest() - persistence
 * - loadSnapshot() / listSnapshots() - snapshot management
 * - compareAudits() - degradation detection
 * - getDegradationTracking() - trend tracking
 * - cleanupSnapshots() - retention management
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { AuditStore } from './audit-store.js';
import type { AuditResult, PatternAuditResult, CrossValidationResult } from './types.js';

// =============================================================================
// Test Helpers
// =============================================================================

function createTestAuditResult(overrides: Partial<AuditResult> = {}): AuditResult {
  const now = new Date().toISOString();
  return {
    version: '1.0.0',
    generatedAt: overrides.generatedAt ?? now,
    scanHash: overrides.scanHash ?? 'test-hash-123',
    summary: overrides.summary ?? {
      totalPatterns: 10,
      autoApproveEligible: 5,
      flaggedForReview: 3,
      likelyFalsePositives: 2,
      duplicateCandidates: 1,
      healthScore: 85,
      byCategory: {},
    },
    patterns: overrides.patterns ?? [
      createTestPatternResult({ id: 'p1', confidence: 0.95, recommendation: 'auto-approve' }),
      createTestPatternResult({ id: 'p2', confidence: 0.75, recommendation: 'review' }),
    ],
    duplicates: overrides.duplicates ?? [],
    crossValidation: overrides.crossValidation ?? {
      patternsMatchingCallGraph: 8,
      patternsNotInCallGraph: 2,
      callGraphEntriesWithoutPatterns: 0,
      constraintAlignment: 0.9,
      testCoverageAlignment: 0.85,
      issues: [],
    },
    ...(overrides.degradation ? { degradation: overrides.degradation } : {}),
  };
}

function createTestPatternResult(overrides: Partial<PatternAuditResult> = {}): PatternAuditResult {
  return {
    id: overrides.id ?? `pattern-${Math.random().toString(36).slice(2, 8)}`,
    name: overrides.name ?? 'Test Pattern',
    category: overrides.category ?? 'api',
    confidence: overrides.confidence ?? 0.85,
    locationCount: overrides.locationCount ?? 5,
    outlierCount: overrides.outlierCount ?? 1,
    recommendation: overrides.recommendation ?? 'review',
    reasons: overrides.reasons ?? ['Test reason'],
    crossValidation: overrides.crossValidation ?? {
      inCallGraph: true,
      matchesConstraints: true,
      hasTestCoverage: true,
      issues: [],
    },
  };
}

// =============================================================================
// Tests
// =============================================================================

describe('AuditStore', () => {
  let store: AuditStore;
  let testDir: string;

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'audit-store-test-'));
    store = new AuditStore({ rootDir: testDir });
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  // ===========================================================================
  // Initialization Tests
  // ===========================================================================

  describe('initialize', () => {
    it('should create audit directory structure', async () => {
      await store.initialize();

      const auditDir = path.join(testDir, '.drift', 'audit');
      const snapshotsDir = path.join(auditDir, 'snapshots');

      const auditStat = await fs.stat(auditDir);
      const snapshotsStat = await fs.stat(snapshotsDir);

      expect(auditStat.isDirectory()).toBe(true);
      expect(snapshotsStat.isDirectory()).toBe(true);
    });

    it('should be idempotent', async () => {
      await store.initialize();
      await store.initialize();

      const auditDir = path.join(testDir, '.drift', 'audit');
      const stat = await fs.stat(auditDir);
      expect(stat.isDirectory()).toBe(true);
    });
  });

  // ===========================================================================
  // Save/Load Tests
  // ===========================================================================

  describe('saveAudit / loadLatest', () => {
    it('should save and load audit result', async () => {
      const audit = createTestAuditResult();
      await store.saveAudit(audit);

      const loaded = await store.loadLatest();

      expect(loaded).not.toBeNull();
      expect(loaded?.version).toBe(audit.version);
      expect(loaded?.scanHash).toBe(audit.scanHash);
      expect(loaded?.summary.healthScore).toBe(audit.summary.healthScore);
    });

    it('should return null when no audit exists', async () => {
      const loaded = await store.loadLatest();
      expect(loaded).toBeNull();
    });

    it('should overwrite previous latest', async () => {
      const audit1 = createTestAuditResult({ scanHash: 'hash-1' });
      const audit2 = createTestAuditResult({ scanHash: 'hash-2' });

      await store.saveAudit(audit1);
      await store.saveAudit(audit2);

      const loaded = await store.loadLatest();
      expect(loaded?.scanHash).toBe('hash-2');
    });

    it('should create snapshot on save', async () => {
      const audit = createTestAuditResult({
        generatedAt: '2026-01-28T12:00:00Z',
      });
      await store.saveAudit(audit);

      const snapshots = await store.listSnapshots();
      expect(snapshots).toContain('2026-01-28');
    });
  });

  // ===========================================================================
  // Snapshot Tests
  // ===========================================================================

  describe('loadSnapshot / listSnapshots', () => {
    it('should load snapshot by date', async () => {
      const audit = createTestAuditResult({
        generatedAt: '2026-01-28T12:00:00Z',
        scanHash: 'snapshot-hash',
      });
      await store.saveAudit(audit);

      const snapshot = await store.loadSnapshot('2026-01-28');

      expect(snapshot).not.toBeNull();
      expect(snapshot?.scanHash).toBe('snapshot-hash');
    });

    it('should return null for non-existent snapshot', async () => {
      const snapshot = await store.loadSnapshot('2020-01-01');
      expect(snapshot).toBeNull();
    });

    it('should list snapshots in reverse chronological order', async () => {
      await store.saveAudit(createTestAuditResult({ generatedAt: '2026-01-25T12:00:00Z' }));
      await store.saveAudit(createTestAuditResult({ generatedAt: '2026-01-27T12:00:00Z' }));
      await store.saveAudit(createTestAuditResult({ generatedAt: '2026-01-26T12:00:00Z' }));

      const snapshots = await store.listSnapshots();

      expect(snapshots[0]).toBe('2026-01-27');
      expect(snapshots[1]).toBe('2026-01-26');
      expect(snapshots[2]).toBe('2026-01-25');
    });

    it('should return empty array when no snapshots exist', async () => {
      const snapshots = await store.listSnapshots();
      expect(snapshots).toHaveLength(0);
    });
  });

  // ===========================================================================
  // Compare Audits Tests
  // ===========================================================================

  describe('compareAudits', () => {
    it('should detect health score improvement', () => {
      const previous = createTestAuditResult({
        summary: { ...createTestAuditResult().summary, healthScore: 70 },
      });
      const current = createTestAuditResult({
        summary: { ...createTestAuditResult().summary, healthScore: 85 },
      });

      const result = store.compareAudits(current, previous);

      expect(result.healthScoreDelta).toBe(15);
      expect(result.trend).toBe('improving');
    });

    it('should detect health score decline', () => {
      const previous = createTestAuditResult({
        summary: { ...createTestAuditResult().summary, healthScore: 90 },
      });
      const current = createTestAuditResult({
        summary: { ...createTestAuditResult().summary, healthScore: 75 },
      });

      const result = store.compareAudits(current, previous);

      expect(result.healthScoreDelta).toBe(-15);
      expect(result.trend).toBe('declining');
    });

    it('should detect stable health score', () => {
      const previous = createTestAuditResult({
        summary: { ...createTestAuditResult().summary, healthScore: 85 },
      });
      const current = createTestAuditResult({
        summary: { ...createTestAuditResult().summary, healthScore: 86 },
      });

      const result = store.compareAudits(current, previous);

      expect(result.trend).toBe('stable');
    });

    it('should calculate confidence delta', () => {
      const previous = createTestAuditResult({
        patterns: [
          createTestPatternResult({ confidence: 0.8 }),
          createTestPatternResult({ confidence: 0.8 }),
        ],
      });
      const current = createTestAuditResult({
        patterns: [
          createTestPatternResult({ confidence: 0.9 }),
          createTestPatternResult({ confidence: 0.9 }),
        ],
      });

      const result = store.compareAudits(current, previous);

      expect(result.confidenceDelta).toBeCloseTo(0.1, 2);
    });

    it('should identify new issues', () => {
      const previous = createTestAuditResult({
        crossValidation: {
          ...createTestAuditResult().crossValidation,
          issues: [],
        },
      });
      const current = createTestAuditResult({
        crossValidation: {
          ...createTestAuditResult().crossValidation,
          issues: [{
            type: 'orphan-pattern',
            severity: 'warning',
            patternId: 'p1',
            message: 'New issue',
          }],
        },
      });

      const result = store.compareAudits(current, previous);

      expect(result.newIssues).toHaveLength(1);
      expect(result.resolvedIssues).toHaveLength(0);
    });

    it('should identify resolved issues', () => {
      const previous = createTestAuditResult({
        crossValidation: {
          ...createTestAuditResult().crossValidation,
          issues: [{
            type: 'orphan-pattern',
            severity: 'warning',
            patternId: 'p1',
            message: 'Old issue',
          }],
        },
      });
      const current = createTestAuditResult({
        crossValidation: {
          ...createTestAuditResult().crossValidation,
          issues: [],
        },
      });

      const result = store.compareAudits(current, previous);

      expect(result.newIssues).toHaveLength(0);
      expect(result.resolvedIssues).toHaveLength(1);
    });

    it('should generate critical alert for large health drop', () => {
      const previous = createTestAuditResult({
        summary: { ...createTestAuditResult().summary, healthScore: 90 },
      });
      const current = createTestAuditResult({
        summary: { ...createTestAuditResult().summary, healthScore: 70 },
      });

      const result = store.compareAudits(current, previous);

      const criticalAlert = result.alerts.find(a => a.severity === 'critical');
      expect(criticalAlert).toBeDefined();
      expect(criticalAlert?.type).toBe('health-drop');
    });

    it('should generate warning alert for moderate health drop', () => {
      const previous = createTestAuditResult({
        summary: { ...createTestAuditResult().summary, healthScore: 90 },
      });
      const current = createTestAuditResult({
        summary: { ...createTestAuditResult().summary, healthScore: 82 },
      });

      const result = store.compareAudits(current, previous);

      const warningAlert = result.alerts.find(a => a.severity === 'warning' && a.type === 'health-drop');
      expect(warningAlert).toBeDefined();
    });

    it('should generate alert for new false positives', () => {
      const previous = createTestAuditResult({
        summary: { ...createTestAuditResult().summary, likelyFalsePositives: 2 },
      });
      const current = createTestAuditResult({
        summary: { ...createTestAuditResult().summary, likelyFalsePositives: 15 },
      });

      const result = store.compareAudits(current, previous);

      const fpAlert = result.alerts.find(a => a.type === 'new-false-positives');
      expect(fpAlert).toBeDefined();
    });
  });

  // ===========================================================================
  // Degradation Tracking Tests
  // ===========================================================================

  describe('getDegradationTracking', () => {
    it('should return null when no tracking exists', async () => {
      const tracking = await store.getDegradationTracking();
      expect(tracking).toBeNull();
    });

    it('should return tracking after audit saves', async () => {
      await store.saveAudit(createTestAuditResult());

      const tracking = await store.getDegradationTracking();

      expect(tracking).not.toBeNull();
      expect(tracking?.history).toHaveLength(1);
    });

    it('should accumulate history entries', async () => {
      await store.saveAudit(createTestAuditResult({ generatedAt: '2026-01-25T12:00:00Z' }));
      await store.saveAudit(createTestAuditResult({ generatedAt: '2026-01-26T12:00:00Z' }));
      await store.saveAudit(createTestAuditResult({ generatedAt: '2026-01-27T12:00:00Z' }));

      const tracking = await store.getDegradationTracking();

      expect(tracking?.history).toHaveLength(3);
    });

    it('should update same-day entry instead of duplicating', async () => {
      await store.saveAudit(createTestAuditResult({ 
        generatedAt: '2026-01-28T10:00:00Z',
        scanHash: 'morning',
      }));
      await store.saveAudit(createTestAuditResult({ 
        generatedAt: '2026-01-28T15:00:00Z',
        scanHash: 'afternoon',
      }));

      const tracking = await store.getDegradationTracking();

      expect(tracking?.history).toHaveLength(1);
      expect(tracking?.history[0]?.date).toBe('2026-01-28');
    });

    it('should calculate trends from history', async () => {
      // Create declining health scores
      for (let i = 0; i < 14; i++) {
        const date = new Date(2026, 0, 15 + i);
        const healthScore = 90 - i * 2; // Declining from 90 to 64
        await store.saveAudit(createTestAuditResult({
          generatedAt: date.toISOString(),
          summary: { ...createTestAuditResult().summary, healthScore },
        }));
      }

      const tracking = await store.getDegradationTracking();

      expect(tracking?.trends.healthTrend).toBe('declining');
    });
  });

  // ===========================================================================
  // Cleanup Tests
  // ===========================================================================

  describe('cleanupSnapshots', () => {
    it('should remove old snapshots beyond retention', async () => {
      // Create 35 snapshots
      for (let i = 1; i <= 35; i++) {
        const date = new Date(2026, 0, i);
        await store.saveAudit(createTestAuditResult({
          generatedAt: date.toISOString(),
        }));
      }

      // Default retention is 30
      const snapshots = await store.listSnapshots();

      expect(snapshots.length).toBeLessThanOrEqual(30);
    });

    it('should respect custom retention count', async () => {
      const customStore = new AuditStore({ 
        rootDir: testDir, 
        snapshotRetention: 5,
      });

      for (let i = 1; i <= 10; i++) {
        const date = new Date(2026, 0, i);
        await customStore.saveAudit(createTestAuditResult({
          generatedAt: date.toISOString(),
        }));
      }

      const snapshots = await customStore.listSnapshots();

      expect(snapshots.length).toBeLessThanOrEqual(5);
    });

    it('should keep most recent snapshots', async () => {
      const customStore = new AuditStore({ 
        rootDir: testDir, 
        snapshotRetention: 3,
      });

      for (let i = 1; i <= 5; i++) {
        const date = new Date(2026, 0, i);
        await customStore.saveAudit(createTestAuditResult({
          generatedAt: date.toISOString(),
        }));
      }

      const snapshots = await customStore.listSnapshots();

      // Should keep Jan 3, 4, 5 (most recent)
      expect(snapshots).toContain('2026-01-05');
      expect(snapshots).toContain('2026-01-04');
      expect(snapshots).toContain('2026-01-03');
      expect(snapshots).not.toContain('2026-01-01');
      expect(snapshots).not.toContain('2026-01-02');
    });
  });
});
