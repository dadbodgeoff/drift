/**
 * Audit Engine Tests
 *
 * Unit tests for the AuditEngine class covering:
 * - runAudit() - full audit workflow
 * - detectDuplicates() - duplicate pattern detection
 * - crossValidate() - pattern validation
 * - generateRecommendations() - recommendation logic
 * - calculateHealthScore() - health score formula
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { AuditEngine } from './audit-engine.js';
import type { Pattern, PatternCategory } from '../store/types.js';

// =============================================================================
// Test Helpers
// =============================================================================

function createTestPattern(overrides: Partial<Pattern> = {}): Pattern {
  const id = overrides.id ?? `pattern-${Math.random().toString(36).slice(2, 8)}`;
  return {
    id,
    name: overrides.name ?? `Test Pattern ${id}`,
    category: overrides.category ?? 'api',
    description: overrides.description ?? 'Test pattern description',
    confidence: overrides.confidence ?? {
      score: 0.85,
      frequency: 0.8,
      consistency: 0.9,
      recency: 0.85,
    },
    locations: overrides.locations ?? [
      { file: 'src/api/users.ts', line: 10, column: 0, snippet: 'router.get' },
      { file: 'src/api/posts.ts', line: 15, column: 0, snippet: 'router.get' },
      { file: 'src/api/comments.ts', line: 20, column: 0, snippet: 'router.get' },
    ],
    outliers: overrides.outliers ?? [],
    status: overrides.status ?? 'discovered',
    metadata: overrides.metadata ?? {
      firstSeen: new Date().toISOString(),
      lastSeen: new Date().toISOString(),
      scanCount: 1,
    },
  };
}

// =============================================================================
// Tests
// =============================================================================

describe('AuditEngine', () => {
  let engine: AuditEngine;

  beforeEach(() => {
    engine = new AuditEngine({
      rootDir: '/tmp/test-project',
      autoApproveThreshold: 0.90,
      reviewThreshold: 0.70,
      duplicateSimilarityThreshold: 0.85,
    });
  });

  // ===========================================================================
  // runAudit Tests
  // ===========================================================================

  describe('runAudit', () => {
    it('should return audit result with all required fields', async () => {
      const patterns = [createTestPattern()];
      const result = await engine.runAudit(patterns);

      expect(result).toHaveProperty('version');
      expect(result).toHaveProperty('generatedAt');
      expect(result).toHaveProperty('scanHash');
      expect(result).toHaveProperty('summary');
      expect(result).toHaveProperty('patterns');
      expect(result).toHaveProperty('duplicates');
      expect(result).toHaveProperty('crossValidation');
    });

    it('should filter patterns by category when specified', async () => {
      const patterns = [
        createTestPattern({ category: 'api' }),
        createTestPattern({ category: 'auth' }),
        createTestPattern({ category: 'errors' }),
      ];

      const result = await engine.runAudit(patterns, { categories: ['api'] });

      expect(result.summary.totalPatterns).toBe(1);
      expect(result.patterns[0]?.category).toBe('api');
    });

    it('should handle empty pattern list', async () => {
      const result = await engine.runAudit([]);

      expect(result.summary.totalPatterns).toBe(0);
      expect(result.summary.healthScore).toBe(100);
      expect(result.patterns).toHaveLength(0);
      expect(result.duplicates).toHaveLength(0);
    });

    it('should generate unique scan hash', async () => {
      const patterns = [createTestPattern()];
      
      const result1 = await engine.runAudit(patterns);
      const result2 = await engine.runAudit(patterns);

      // Same patterns should produce same hash
      expect(result1.scanHash).toBe(result2.scanHash);

      // Different patterns should produce different hash
      const result3 = await engine.runAudit([createTestPattern({ id: 'different' })]);
      expect(result3.scanHash).not.toBe(result1.scanHash);
    });
  });

  // ===========================================================================
  // detectDuplicates Tests
  // ===========================================================================

  describe('detectDuplicates', () => {
    it('should detect patterns with overlapping locations', async () => {
      const sharedLocations = [
        { file: 'src/api/users.ts', line: 10, column: 0, snippet: 'code' },
        { file: 'src/api/posts.ts', line: 15, column: 0, snippet: 'code' },
      ];

      const patterns = [
        createTestPattern({ id: 'pattern-a', locations: sharedLocations }),
        createTestPattern({ id: 'pattern-b', locations: sharedLocations }),
      ];

      const duplicates = await engine.detectDuplicates(patterns);

      expect(duplicates).toHaveLength(1);
      expect(duplicates[0]?.patterns).toContain('pattern-a');
      expect(duplicates[0]?.patterns).toContain('pattern-b');
      expect(duplicates[0]?.similarity).toBeGreaterThan(0);
    });

    it('should not flag patterns with different locations', async () => {
      const patterns = [
        createTestPattern({
          id: 'pattern-a',
          locations: [{ file: 'src/a.ts', line: 1, column: 0, snippet: 'a' }],
        }),
        createTestPattern({
          id: 'pattern-b',
          locations: [{ file: 'src/b.ts', line: 1, column: 0, snippet: 'b' }],
        }),
      ];

      const duplicates = await engine.detectDuplicates(patterns);

      expect(duplicates).toHaveLength(0);
    });

    it('should not flag patterns from different categories', async () => {
      const sharedLocations = [
        { file: 'src/api/users.ts', line: 10, column: 0, snippet: 'code' },
      ];

      const patterns = [
        createTestPattern({ id: 'pattern-a', category: 'api', locations: sharedLocations }),
        createTestPattern({ id: 'pattern-b', category: 'auth', locations: sharedLocations }),
      ];

      const duplicates = await engine.detectDuplicates(patterns);

      expect(duplicates).toHaveLength(0);
    });

    it('should recommend merge for high similarity', async () => {
      const locations = [
        { file: 'src/a.ts', line: 1, column: 0, snippet: 'a' },
        { file: 'src/b.ts', line: 1, column: 0, snippet: 'b' },
        { file: 'src/c.ts', line: 1, column: 0, snippet: 'c' },
      ];

      const patterns = [
        createTestPattern({ id: 'pattern-a', locations }),
        createTestPattern({ id: 'pattern-b', locations }),
      ];

      const duplicates = await engine.detectDuplicates(patterns);

      expect(duplicates).toHaveLength(1);
      // High overlap should recommend merge
      expect(['merge', 'review']).toContain(duplicates[0]?.recommendation);
    });
  });

  // ===========================================================================
  // crossValidate Tests
  // ===========================================================================

  describe('crossValidate', () => {
    it('should flag patterns with no locations as orphans', async () => {
      const patterns = [
        createTestPattern({ locations: [] }),
      ];

      const result = await engine.crossValidate(patterns, {});

      expect(result.patternsNotInCallGraph).toBe(1);
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0]?.type).toBe('orphan-pattern');
    });

    it('should flag patterns with high outlier ratio', async () => {
      const patterns = [
        createTestPattern({
          locations: [{ file: 'a.ts', line: 1, column: 0, snippet: 'a' }],
          outliers: [
            { file: 'b.ts', line: 1, column: 0, snippet: 'b', reason: 'test' },
            { file: 'c.ts', line: 1, column: 0, snippet: 'c', reason: 'test' },
            { file: 'd.ts', line: 1, column: 0, snippet: 'd', reason: 'test' },
          ],
        }),
      ];

      const result = await engine.crossValidate(patterns, {});

      const outlierIssue = result.issues.find(i => i.message.includes('outlier ratio'));
      expect(outlierIssue).toBeDefined();
      expect(outlierIssue?.severity).toBe('warning');
    });

    it('should flag approved patterns with low confidence', async () => {
      const patterns = [
        createTestPattern({
          status: 'approved',
          confidence: { score: 0.4, frequency: 0.4, consistency: 0.4, recency: 0.4 },
        }),
      ];

      const result = await engine.crossValidate(patterns, {});

      const lowConfIssue = result.issues.find(i => i.message.includes('low confidence'));
      expect(lowConfIssue).toBeDefined();
      expect(lowConfIssue?.severity).toBe('info');
    });

    it('should calculate constraint alignment based on issues', async () => {
      const patterns = [
        createTestPattern({ locations: [] }), // Will generate issue
        createTestPattern(), // No issues
        createTestPattern(), // No issues
      ];

      const result = await engine.crossValidate(patterns, {});

      // 1 issue out of 3 patterns = ~0.67 alignment
      expect(result.constraintAlignment).toBeLessThan(1);
      expect(result.constraintAlignment).toBeGreaterThan(0);
    });
  });

  // ===========================================================================
  // generateRecommendations Tests
  // ===========================================================================

  describe('generateRecommendations', () => {
    it('should recommend auto-approve for high confidence patterns', () => {
      const patterns = [
        createTestPattern({
          confidence: { score: 0.95, frequency: 0.95, consistency: 0.95, recency: 0.95 },
          locations: [
            { file: 'a.ts', line: 1, column: 0, snippet: 'a' },
            { file: 'b.ts', line: 2, column: 0, snippet: 'b' },
            { file: 'c.ts', line: 3, column: 0, snippet: 'c' },
          ],
          outliers: [],
        }),
      ];

      const crossValidation = {
        patternsMatchingCallGraph: 1,
        patternsNotInCallGraph: 0,
        callGraphEntriesWithoutPatterns: 0,
        constraintAlignment: 1,
        testCoverageAlignment: 1,
        issues: [],
      };

      const results = engine.generateRecommendations(patterns, crossValidation, []);

      expect(results[0]?.recommendation).toBe('auto-approve');
      expect(results[0]?.reasons).toContain('High confidence (95%)');
    });

    it('should recommend review for moderate confidence patterns', () => {
      const patterns = [
        createTestPattern({
          confidence: { score: 0.75, frequency: 0.75, consistency: 0.75, recency: 0.75 },
        }),
      ];

      const crossValidation = {
        patternsMatchingCallGraph: 1,
        patternsNotInCallGraph: 0,
        callGraphEntriesWithoutPatterns: 0,
        constraintAlignment: 1,
        testCoverageAlignment: 1,
        issues: [],
      };

      const results = engine.generateRecommendations(patterns, crossValidation, []);

      expect(results[0]?.recommendation).toBe('review');
      expect(results[0]?.reasons).toContain('Moderate confidence (75%)');
    });

    it('should recommend likely-false-positive for low confidence patterns', () => {
      const patterns = [
        createTestPattern({
          confidence: { score: 0.5, frequency: 0.5, consistency: 0.5, recency: 0.5 },
        }),
      ];

      const crossValidation = {
        patternsMatchingCallGraph: 1,
        patternsNotInCallGraph: 0,
        callGraphEntriesWithoutPatterns: 0,
        constraintAlignment: 1,
        testCoverageAlignment: 1,
        issues: [],
      };

      const results = engine.generateRecommendations(patterns, crossValidation, []);

      expect(results[0]?.recommendation).toBe('likely-false-positive');
      expect(results[0]?.reasons).toContain('Low confidence (50%)');
    });

    it('should downgrade auto-approve to review if in duplicate group', () => {
      const patterns = [
        createTestPattern({
          id: 'pattern-a',
          confidence: { score: 0.95, frequency: 0.95, consistency: 0.95, recency: 0.95 },
        }),
      ];

      const crossValidation = {
        patternsMatchingCallGraph: 1,
        patternsNotInCallGraph: 0,
        callGraphEntriesWithoutPatterns: 0,
        constraintAlignment: 1,
        testCoverageAlignment: 1,
        issues: [],
      };

      const duplicates = [{
        id: 'dup-1',
        patterns: ['pattern-a', 'pattern-b'],
        patternNames: ['Pattern A', 'Pattern B'],
        similarity: 0.9,
        reason: 'test',
        recommendation: 'review' as const,
        overlappingLocations: 3,
        totalLocations: 6,
      }];

      const results = engine.generateRecommendations(patterns, crossValidation, duplicates);

      expect(results[0]?.recommendation).toBe('review');
      expect(results[0]?.reasons).toContain('Part of potential duplicate group');
    });

    it('should include cross-validation issues in reasons', () => {
      const patterns = [
        createTestPattern({ id: 'pattern-a' }),
      ];

      const crossValidation = {
        patternsMatchingCallGraph: 0,
        patternsNotInCallGraph: 1,
        callGraphEntriesWithoutPatterns: 0,
        constraintAlignment: 0.5,
        testCoverageAlignment: 1,
        issues: [{
          type: 'orphan-pattern' as const,
          severity: 'warning' as const,
          patternId: 'pattern-a',
          message: 'Pattern has no call graph entry',
        }],
      };

      const results = engine.generateRecommendations(patterns, crossValidation, []);

      expect(results[0]?.reasons).toContain('Pattern has no call graph entry');
    });
  });

  // ===========================================================================
  // calculateHealthScore Tests
  // ===========================================================================

  describe('calculateHealthScore', () => {
    it('should return 100 for empty pattern list', () => {
      const score = engine.calculateHealthScore([], {
        patternsMatchingCallGraph: 0,
        patternsNotInCallGraph: 0,
        callGraphEntriesWithoutPatterns: 0,
        constraintAlignment: 1,
        testCoverageAlignment: 1,
        issues: [],
      }, []);

      expect(score).toBe(100);
    });

    it('should return high score for healthy patterns', () => {
      const patterns = [
        createTestPattern({
          status: 'approved',
          confidence: { score: 0.95, frequency: 0.95, consistency: 0.95, recency: 0.95 },
          outliers: [],
        }),
        createTestPattern({
          status: 'approved',
          confidence: { score: 0.92, frequency: 0.92, consistency: 0.92, recency: 0.92 },
          outliers: [],
        }),
      ];

      const crossValidation = {
        patternsMatchingCallGraph: 2,
        patternsNotInCallGraph: 0,
        callGraphEntriesWithoutPatterns: 0,
        constraintAlignment: 1,
        testCoverageAlignment: 1,
        issues: [],
      };

      const score = engine.calculateHealthScore(patterns, crossValidation, []);

      expect(score).toBeGreaterThan(80);
    });

    it('should return lower score for patterns with issues', () => {
      const patterns = [
        createTestPattern({
          status: 'discovered',
          confidence: { score: 0.5, frequency: 0.5, consistency: 0.5, recency: 0.5 },
          outliers: [
            { file: 'a.ts', line: 1, column: 0, snippet: 'a', reason: 'test' },
            { file: 'b.ts', line: 2, column: 0, snippet: 'b', reason: 'test' },
          ],
        }),
      ];

      const crossValidation = {
        patternsMatchingCallGraph: 0,
        patternsNotInCallGraph: 1,
        callGraphEntriesWithoutPatterns: 0,
        constraintAlignment: 0.5,
        testCoverageAlignment: 0.5,
        issues: [],
      };

      const duplicates = [{
        id: 'dup-1',
        patterns: [patterns[0]!.id],
        patternNames: [patterns[0]!.name],
        similarity: 0.9,
        reason: 'test',
        recommendation: 'review' as const,
        overlappingLocations: 1,
        totalLocations: 2,
      }];

      const score = engine.calculateHealthScore(patterns, crossValidation, duplicates);

      expect(score).toBeLessThan(50);
    });

    it('should weight factors according to HEALTH_SCORE_WEIGHTS', () => {
      // All approved, high confidence, no outliers, all in call graph, no duplicates
      const perfectPatterns = [
        createTestPattern({
          status: 'approved',
          confidence: { score: 1.0, frequency: 1.0, consistency: 1.0, recency: 1.0 },
          outliers: [],
        }),
      ];

      const perfectCrossValidation = {
        patternsMatchingCallGraph: 1,
        patternsNotInCallGraph: 0,
        callGraphEntriesWithoutPatterns: 0,
        constraintAlignment: 1,
        testCoverageAlignment: 1,
        issues: [],
      };

      const perfectScore = engine.calculateHealthScore(
        perfectPatterns, 
        perfectCrossValidation, 
        []
      );

      // Perfect score should be 100
      expect(perfectScore).toBe(100);
    });
  });

  // ===========================================================================
  // Summary Building Tests
  // ===========================================================================

  describe('summary building', () => {
    it('should correctly count patterns by recommendation', async () => {
      const patterns = [
        createTestPattern({ 
          confidence: { score: 0.95, frequency: 0.95, consistency: 0.95, recency: 0.95 },
          locations: [
            { file: 'a.ts', line: 1, column: 0, snippet: 'a' },
            { file: 'b.ts', line: 2, column: 0, snippet: 'b' },
            { file: 'c.ts', line: 3, column: 0, snippet: 'c' },
          ],
          outliers: [],
        }),
        createTestPattern({ confidence: { score: 0.75, frequency: 0.75, consistency: 0.75, recency: 0.75 } }),
        createTestPattern({ confidence: { score: 0.5, frequency: 0.5, consistency: 0.5, recency: 0.5 } }),
      ];

      const result = await engine.runAudit(patterns);

      expect(result.summary.autoApproveEligible).toBe(1);
      expect(result.summary.flaggedForReview).toBe(1);
      expect(result.summary.likelyFalsePositives).toBe(1);
    });

    it('should break down by category', async () => {
      const patterns = [
        createTestPattern({ category: 'api' }),
        createTestPattern({ category: 'api' }),
        createTestPattern({ category: 'auth' }),
      ];

      const result = await engine.runAudit(patterns);

      expect(result.summary.byCategory['api']?.total).toBe(2);
      expect(result.summary.byCategory['auth']?.total).toBe(1);
    });

    it('should calculate average confidence per category', async () => {
      const patterns = [
        createTestPattern({ 
          category: 'api', 
          confidence: { score: 0.8, frequency: 0.8, consistency: 0.8, recency: 0.8 } 
        }),
        createTestPattern({ 
          category: 'api', 
          confidence: { score: 0.6, frequency: 0.6, consistency: 0.6, recency: 0.6 } 
        }),
      ];

      const result = await engine.runAudit(patterns);

      expect(result.summary.byCategory['api']?.avgConfidence).toBeCloseTo(0.7, 1);
    });
  });
});
