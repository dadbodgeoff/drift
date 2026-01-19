/**
 * Property-Based Tests for ConfidenceScorer
 *
 * Property 2: Confidence Score Bounds
 * All scores SHALL be in [0.0, 1.0]
 * **Validates: Requirements 5.1, 5.2**
 *
 * Property 3: Confidence Level Classification
 * Score >= 0.85 → high, Score >= 0.70 and < 0.85 → medium,
 * Score >= 0.50 and < 0.70 → low, Score < 0.50 → uncertain
 * **Validates: Requirements 5.3, 5.4, 5.5, 5.6**
 *
 * @requirements 5.1 - Pattern confidence scoring with frequency, consistency, age, spread factors
 * @requirements 5.2 - Confidence score SHALL be a decimal value between 0.0 and 1.0
 * @requirements 5.3 - High confidence: score >= 0.85
 * @requirements 5.4 - Medium confidence: score >= 0.70 and < 0.85
 * @requirements 5.5 - Low confidence: score >= 0.50 and < 0.70
 * @requirements 5.6 - Uncertain: score < 0.50
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { ConfidenceScorer, calculateConfidence } from './confidence-scorer.js';
import type { ConfidenceWeights } from './types.js';
import { CONFIDENCE_THRESHOLDS } from './types.js';

/**
 * Arbitrary for generating valid ConfidenceInput values
 * Generates realistic input ranges for confidence calculation
 */
const confidenceInputArb = fc.record({
  occurrences: fc.integer({ min: 0, max: 100000 }),
  totalLocations: fc.integer({ min: 0, max: 100000 }),
  variance: fc.double({ min: -1, max: 2, noNaN: true }),
  daysSinceFirstSeen: fc.integer({ min: -100, max: 10000 }),
  fileCount: fc.integer({ min: 0, max: 100000 }),
  totalFiles: fc.integer({ min: 0, max: 100000 }),
});

/**
 * Arbitrary for generating extreme ConfidenceInput values
 * Tests edge cases with very large and very small numbers
 */
const extremeConfidenceInputArb = fc.record({
  occurrences: fc.oneof(
    fc.constant(0),
    fc.constant(Number.MAX_SAFE_INTEGER),
    fc.integer({ min: -1000000, max: 1000000 })
  ),
  totalLocations: fc.oneof(
    fc.constant(0),
    fc.constant(Number.MAX_SAFE_INTEGER),
    fc.integer({ min: -1000000, max: 1000000 })
  ),
  variance: fc.oneof(
    fc.constant(0),
    fc.constant(1),
    fc.constant(-1000),
    fc.constant(1000),
    fc.double({ min: -1000, max: 1000, noNaN: true })
  ),
  daysSinceFirstSeen: fc.oneof(
    fc.constant(0),
    fc.constant(-1000),
    fc.constant(1000000),
    fc.integer({ min: -10000, max: 100000 })
  ),
  fileCount: fc.oneof(
    fc.constant(0),
    fc.constant(Number.MAX_SAFE_INTEGER),
    fc.integer({ min: -1000000, max: 1000000 })
  ),
  totalFiles: fc.oneof(
    fc.constant(0),
    fc.constant(Number.MAX_SAFE_INTEGER),
    fc.integer({ min: -1000000, max: 1000000 })
  ),
});

/**
 * Arbitrary for generating valid ConfidenceWeights that sum to 1.0
 */
const validWeightsArb = fc
  .tuple(
    fc.double({ min: 0.01, max: 0.97, noNaN: true }),
    fc.double({ min: 0.01, max: 0.97, noNaN: true }),
    fc.double({ min: 0.01, max: 0.97, noNaN: true })
  )
  .filter(([a, b, c]) => a + b + c < 0.99) // Ensure there's room for the fourth weight
  .map(([frequency, consistency, age]) => {
    const spread = 1.0 - frequency - consistency - age;
    return {
      frequency,
      consistency,
      age,
      spread: Math.max(0.01, spread), // Ensure spread is positive
    } as ConfidenceWeights;
  })
  .filter((weights) => {
    const sum = weights.frequency + weights.consistency + weights.age + weights.spread;
    return Math.abs(sum - 1.0) < 0.001;
  });

describe('ConfidenceScorer Property Tests', () => {
  /**
   * Property 2: Confidence Score Bounds
   * All scores SHALL be in [0.0, 1.0]
   * **Validates: Requirements 5.1, 5.2**
   */
  describe('Property 2: Confidence Score Bounds', () => {
    it('should always produce overall score in [0.0, 1.0] for any valid input', async () => {
      const scorer = new ConfidenceScorer();

      await fc.assert(
        fc.asyncProperty(confidenceInputArb, async (input) => {
          const result = scorer.calculateScore(input);

          // PROPERTY: Overall score SHALL be in [0.0, 1.0]
          expect(result.score).toBeGreaterThanOrEqual(0.0);
          expect(result.score).toBeLessThanOrEqual(1.0);

          return true;
        }),
        { numRuns: 200 }
      );
    });

    it('should always produce frequency factor in [0.0, 1.0] for any input', async () => {
      const scorer = new ConfidenceScorer();

      await fc.assert(
        fc.asyncProperty(confidenceInputArb, async (input) => {
          const result = scorer.calculateScore(input);

          // PROPERTY: Frequency factor SHALL be in [0.0, 1.0]
          expect(result.frequency).toBeGreaterThanOrEqual(0.0);
          expect(result.frequency).toBeLessThanOrEqual(1.0);

          return true;
        }),
        { numRuns: 200 }
      );
    });

    it('should always produce consistency factor in [0.0, 1.0] for any input', async () => {
      const scorer = new ConfidenceScorer();

      await fc.assert(
        fc.asyncProperty(confidenceInputArb, async (input) => {
          const result = scorer.calculateScore(input);

          // PROPERTY: Consistency factor SHALL be in [0.0, 1.0]
          expect(result.consistency).toBeGreaterThanOrEqual(0.0);
          expect(result.consistency).toBeLessThanOrEqual(1.0);

          return true;
        }),
        { numRuns: 200 }
      );
    });

    it('should always produce score in [0.0, 1.0] with extreme input values', async () => {
      const scorer = new ConfidenceScorer();

      await fc.assert(
        fc.asyncProperty(extremeConfidenceInputArb, async (input) => {
          const result = scorer.calculateScore(input);

          // PROPERTY: Score SHALL be in [0.0, 1.0] even with extreme values
          expect(result.score).toBeGreaterThanOrEqual(0.0);
          expect(result.score).toBeLessThanOrEqual(1.0);

          // PROPERTY: All individual factors SHALL also be bounded
          expect(result.frequency).toBeGreaterThanOrEqual(0.0);
          expect(result.frequency).toBeLessThanOrEqual(1.0);
          expect(result.consistency).toBeGreaterThanOrEqual(0.0);
          expect(result.consistency).toBeLessThanOrEqual(1.0);

          return true;
        }),
        { numRuns: 200 }
      );
    });

    it('should always produce score in [0.0, 1.0] with zero values', async () => {
      const scorer = new ConfidenceScorer();

      await fc.assert(
        fc.asyncProperty(
          fc.record({
            occurrences: fc.constant(0),
            totalLocations: fc.integer({ min: 0, max: 1000 }),
            variance: fc.double({ min: 0, max: 1, noNaN: true }),
            daysSinceFirstSeen: fc.constant(0),
            fileCount: fc.constant(0),
            totalFiles: fc.integer({ min: 0, max: 1000 }),
          }),
          async (input) => {
            const result = scorer.calculateScore(input);

            // PROPERTY: Score SHALL be in [0.0, 1.0] even with zero values
            expect(result.score).toBeGreaterThanOrEqual(0.0);
            expect(result.score).toBeLessThanOrEqual(1.0);

            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should always produce score in [0.0, 1.0] with negative values', async () => {
      const scorer = new ConfidenceScorer();

      await fc.assert(
        fc.asyncProperty(
          fc.record({
            occurrences: fc.integer({ min: -1000, max: 1000 }),
            totalLocations: fc.integer({ min: -1000, max: 1000 }),
            variance: fc.double({ min: -10, max: 10, noNaN: true }),
            daysSinceFirstSeen: fc.integer({ min: -1000, max: 1000 }),
            fileCount: fc.integer({ min: -1000, max: 1000 }),
            totalFiles: fc.integer({ min: -1000, max: 1000 }),
          }),
          async (input) => {
            const result = scorer.calculateScore(input);

            // PROPERTY: Score SHALL be in [0.0, 1.0] even with negative values
            expect(result.score).toBeGreaterThanOrEqual(0.0);
            expect(result.score).toBeLessThanOrEqual(1.0);

            return true;
          }
        ),
        { numRuns: 200 }
      );
    });

    it('should always produce score in [0.0, 1.0] with very large values', async () => {
      const scorer = new ConfidenceScorer();

      await fc.assert(
        fc.asyncProperty(
          fc.record({
            occurrences: fc.integer({ min: 1000000, max: 10000000 }),
            totalLocations: fc.integer({ min: 100, max: 1000 }),
            variance: fc.double({ min: 0, max: 100, noNaN: true }),
            daysSinceFirstSeen: fc.integer({ min: 10000, max: 100000 }),
            fileCount: fc.integer({ min: 1000000, max: 10000000 }),
            totalFiles: fc.integer({ min: 100, max: 1000 }),
          }),
          async (input) => {
            const result = scorer.calculateScore(input);

            // PROPERTY: Score SHALL be in [0.0, 1.0] even with very large values
            expect(result.score).toBeGreaterThanOrEqual(0.0);
            expect(result.score).toBeLessThanOrEqual(1.0);

            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should always produce score in [0.0, 1.0] with various weight configurations', async () => {
      await fc.assert(
        fc.asyncProperty(validWeightsArb, confidenceInputArb, async (weights, input) => {
          const scorer = new ConfidenceScorer(weights);
          const result = scorer.calculateScore(input);

          // PROPERTY: Score SHALL be in [0.0, 1.0] regardless of weight configuration
          expect(result.score).toBeGreaterThanOrEqual(0.0);
          expect(result.score).toBeLessThanOrEqual(1.0);

          return true;
        }),
        { numRuns: 100 }
      );
    });

    it('should produce bounded scores using calculateConfidence helper', async () => {
      await fc.assert(
        fc.asyncProperty(confidenceInputArb, async (input) => {
          const result = calculateConfidence(input);

          // PROPERTY: Score from helper function SHALL also be in [0.0, 1.0]
          expect(result.score).toBeGreaterThanOrEqual(0.0);
          expect(result.score).toBeLessThanOrEqual(1.0);

          return true;
        }),
        { numRuns: 100 }
      );
    });

    it('should produce bounded individual factor calculations', async () => {
      const scorer = new ConfidenceScorer();

      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: -1000, max: 1000000 }),
          fc.integer({ min: -1000, max: 1000000 }),
          async (numerator, denominator) => {
            // Test frequency calculation
            const frequency = scorer.calculateFrequency(numerator, denominator);
            expect(frequency).toBeGreaterThanOrEqual(0.0);
            expect(frequency).toBeLessThanOrEqual(1.0);

            // Test spread calculation
            const spread = scorer.calculateSpread(numerator, denominator);
            expect(spread).toBeGreaterThanOrEqual(0.0);
            expect(spread).toBeLessThanOrEqual(1.0);

            return true;
          }
        ),
        { numRuns: 200 }
      );
    });

    it('should produce bounded consistency calculation for any variance', async () => {
      const scorer = new ConfidenceScorer();

      await fc.assert(
        fc.asyncProperty(
          fc.double({ min: -1000, max: 1000, noNaN: true }),
          async (variance) => {
            const consistency = scorer.calculateConsistency(variance);

            // PROPERTY: Consistency SHALL be in [0.0, 1.0]
            expect(consistency).toBeGreaterThanOrEqual(0.0);
            expect(consistency).toBeLessThanOrEqual(1.0);

            return true;
          }
        ),
        { numRuns: 200 }
      );
    });

    it('should produce bounded age factor calculation for any days value', async () => {
      const scorer = new ConfidenceScorer();

      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: -10000, max: 100000 }),
          async (days) => {
            const ageFactor = scorer.calculateAgeFactor(days);

            // PROPERTY: Age factor SHALL be in [0.0, 1.0]
            expect(ageFactor).toBeGreaterThanOrEqual(0.0);
            expect(ageFactor).toBeLessThanOrEqual(1.0);

            return true;
          }
        ),
        { numRuns: 200 }
      );
    });

    it('should produce score that is a valid number (not NaN or Infinity)', async () => {
      const scorer = new ConfidenceScorer();

      await fc.assert(
        fc.asyncProperty(extremeConfidenceInputArb, async (input) => {
          const result = scorer.calculateScore(input);

          // PROPERTY: Score SHALL be a valid finite number
          expect(Number.isFinite(result.score)).toBe(true);
          expect(Number.isNaN(result.score)).toBe(false);

          // PROPERTY: All factors SHALL be valid finite numbers
          expect(Number.isFinite(result.frequency)).toBe(true);
          expect(Number.isFinite(result.consistency)).toBe(true);

          return true;
        }),
        { numRuns: 200 }
      );
    });

    it('should produce bounded scores with custom age configuration', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 1, max: 365 }),
          fc.double({ min: 0.01, max: 0.5, noNaN: true }),
          confidenceInputArb,
          async (maxAgeDays, minAgeFactor, input) => {
            const scorer = new ConfidenceScorer(undefined, { maxAgeDays, minAgeFactor });
            const result = scorer.calculateScore(input);

            // PROPERTY: Score SHALL be in [0.0, 1.0] with custom age config
            expect(result.score).toBeGreaterThanOrEqual(0.0);
            expect(result.score).toBeLessThanOrEqual(1.0);

            return true;
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Property 3: Confidence Level Classification
   * Score >= 0.85 → high, Score >= 0.70 and < 0.85 → medium,
   * Score >= 0.50 and < 0.70 → low, Score < 0.50 → uncertain
   * **Validates: Requirements 5.3, 5.4, 5.5, 5.6**
   */
  describe('Property 3: Confidence Level Classification', () => {
    const scorer = new ConfidenceScorer();

    /**
     * Arbitrary for generating scores in the 'high' confidence range
     * Score >= 0.85
     * **Validates: Requirements 5.3**
     */
    const highConfidenceScoreArb = fc.double({
      min: CONFIDENCE_THRESHOLDS.HIGH,
      max: 1.0,
      noNaN: true,
    });

    /**
     * Arbitrary for generating scores in the 'medium' confidence range
     * Score >= 0.70 and < 0.85
     * **Validates: Requirements 5.4**
     */
    const mediumConfidenceScoreArb = fc.double({
      min: CONFIDENCE_THRESHOLDS.MEDIUM,
      max: CONFIDENCE_THRESHOLDS.HIGH - 0.0001,
      noNaN: true,
    });

    /**
     * Arbitrary for generating scores in the 'low' confidence range
     * Score >= 0.50 and < 0.70
     * **Validates: Requirements 5.5**
     */
    const lowConfidenceScoreArb = fc.double({
      min: CONFIDENCE_THRESHOLDS.LOW,
      max: CONFIDENCE_THRESHOLDS.MEDIUM - 0.0001,
      noNaN: true,
    });

    /**
     * Arbitrary for generating scores in the 'uncertain' confidence range
     * Score < 0.50
     * **Validates: Requirements 5.6**
     */
    const uncertainConfidenceScoreArb = fc.double({
      min: 0.0,
      max: CONFIDENCE_THRESHOLDS.LOW - 0.0001,
      noNaN: true,
    });

    it('should classify score >= 0.85 as "high" confidence', async () => {
      await fc.assert(
        fc.asyncProperty(highConfidenceScoreArb, async (score) => {
          const level = scorer.classifyLevel(score);

          // PROPERTY: Score >= 0.85 SHALL be classified as 'high'
          expect(level).toBe('high');

          return true;
        }),
        { numRuns: 200 }
      );
    });

    it('should classify score >= 0.70 and < 0.85 as "medium" confidence', async () => {
      await fc.assert(
        fc.asyncProperty(mediumConfidenceScoreArb, async (score) => {
          const level = scorer.classifyLevel(score);

          // PROPERTY: Score >= 0.70 and < 0.85 SHALL be classified as 'medium'
          expect(level).toBe('medium');

          return true;
        }),
        { numRuns: 200 }
      );
    });

    it('should classify score >= 0.50 and < 0.70 as "low" confidence', async () => {
      await fc.assert(
        fc.asyncProperty(lowConfidenceScoreArb, async (score) => {
          const level = scorer.classifyLevel(score);

          // PROPERTY: Score >= 0.50 and < 0.70 SHALL be classified as 'low'
          expect(level).toBe('low');

          return true;
        }),
        { numRuns: 200 }
      );
    });

    it('should classify score < 0.50 as "uncertain" confidence', async () => {
      await fc.assert(
        fc.asyncProperty(uncertainConfidenceScoreArb, async (score) => {
          const level = scorer.classifyLevel(score);

          // PROPERTY: Score < 0.50 SHALL be classified as 'uncertain'
          expect(level).toBe('uncertain');

          return true;
        }),
        { numRuns: 200 }
      );
    });

    it('should correctly classify boundary value 0.85 as "high"', async () => {
      const level = scorer.classifyLevel(0.85);
      expect(level).toBe('high');
    });

    it('should correctly classify boundary value 0.70 as "medium"', async () => {
      const level = scorer.classifyLevel(0.70);
      expect(level).toBe('medium');
    });

    it('should correctly classify boundary value 0.50 as "low"', async () => {
      const level = scorer.classifyLevel(0.50);
      expect(level).toBe('low');
    });

    it('should correctly classify boundary value just below 0.85 as "medium"', async () => {
      const level = scorer.classifyLevel(0.8499999999);
      expect(level).toBe('medium');
    });

    it('should correctly classify boundary value just below 0.70 as "low"', async () => {
      const level = scorer.classifyLevel(0.6999999999);
      expect(level).toBe('low');
    });

    it('should correctly classify boundary value just below 0.50 as "uncertain"', async () => {
      const level = scorer.classifyLevel(0.4999999999);
      expect(level).toBe('uncertain');
    });

    it('should correctly classify extreme values', async () => {
      // Test 0.0
      expect(scorer.classifyLevel(0.0)).toBe('uncertain');

      // Test 1.0
      expect(scorer.classifyLevel(1.0)).toBe('high');

      // Test negative (edge case - should still classify based on thresholds)
      expect(scorer.classifyLevel(-0.1)).toBe('uncertain');

      // Test > 1.0 (edge case)
      expect(scorer.classifyLevel(1.5)).toBe('high');
    });

    it('should produce consistent classification for any score in [0.0, 1.0]', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.double({ min: 0.0, max: 1.0, noNaN: true }),
          async (score) => {
            const level = scorer.classifyLevel(score);

            // PROPERTY: Classification SHALL be one of the four valid levels
            expect(['high', 'medium', 'low', 'uncertain']).toContain(level);

            // PROPERTY: Classification SHALL be consistent with thresholds
            if (score >= CONFIDENCE_THRESHOLDS.HIGH) {
              expect(level).toBe('high');
            } else if (score >= CONFIDENCE_THRESHOLDS.MEDIUM) {
              expect(level).toBe('medium');
            } else if (score >= CONFIDENCE_THRESHOLDS.LOW) {
              expect(level).toBe('low');
            } else {
              expect(level).toBe('uncertain');
            }

            return true;
          }
        ),
        { numRuns: 500 }
      );
    });

    it('should produce correct classification in calculateScore result', async () => {
      /**
       * Arbitrary for generating ConfidenceInput that produces scores in specific ranges
       */
      const confidenceInputArb = fc.record({
        occurrences: fc.integer({ min: 0, max: 100000 }),
        totalLocations: fc.integer({ min: 1, max: 100000 }),
        variance: fc.double({ min: 0, max: 1, noNaN: true }),
        daysSinceFirstSeen: fc.integer({ min: 0, max: 10000 }),
        fileCount: fc.integer({ min: 0, max: 100000 }),
        totalFiles: fc.integer({ min: 1, max: 100000 }),
      });

      await fc.assert(
        fc.asyncProperty(confidenceInputArb, async (input) => {
          const result = scorer.calculateScore(input);

          // PROPERTY: The level in the result SHALL match the classification of the score
          const expectedLevel = scorer.classifyLevel(result.score);
          expect(result.level).toBe(expectedLevel);

          // PROPERTY: Classification SHALL be consistent with thresholds
          if (result.score >= CONFIDENCE_THRESHOLDS.HIGH) {
            expect(result.level).toBe('high');
          } else if (result.score >= CONFIDENCE_THRESHOLDS.MEDIUM) {
            expect(result.level).toBe('medium');
          } else if (result.score >= CONFIDENCE_THRESHOLDS.LOW) {
            expect(result.level).toBe('low');
          } else {
            expect(result.level).toBe('uncertain');
          }

          return true;
        }),
        { numRuns: 200 }
      );
    });

    it('should produce correct classification using calculateConfidence helper', async () => {
      const confidenceInputArb = fc.record({
        occurrences: fc.integer({ min: 0, max: 100000 }),
        totalLocations: fc.integer({ min: 1, max: 100000 }),
        variance: fc.double({ min: 0, max: 1, noNaN: true }),
        daysSinceFirstSeen: fc.integer({ min: 0, max: 10000 }),
        fileCount: fc.integer({ min: 0, max: 100000 }),
        totalFiles: fc.integer({ min: 1, max: 100000 }),
      });

      await fc.assert(
        fc.asyncProperty(confidenceInputArb, async (input) => {
          const result = calculateConfidence(input);

          // PROPERTY: Classification SHALL be consistent with thresholds
          if (result.score >= CONFIDENCE_THRESHOLDS.HIGH) {
            expect(result.level).toBe('high');
          } else if (result.score >= CONFIDENCE_THRESHOLDS.MEDIUM) {
            expect(result.level).toBe('medium');
          } else if (result.score >= CONFIDENCE_THRESHOLDS.LOW) {
            expect(result.level).toBe('low');
          } else {
            expect(result.level).toBe('uncertain');
          }

          return true;
        }),
        { numRuns: 200 }
      );
    });

    it('should maintain classification consistency across multiple scorer instances', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.double({ min: 0.0, max: 1.0, noNaN: true }),
          async (score) => {
            const scorer1 = new ConfidenceScorer();
            const scorer2 = new ConfidenceScorer();

            const level1 = scorer1.classifyLevel(score);
            const level2 = scorer2.classifyLevel(score);

            // PROPERTY: Different scorer instances SHALL produce the same classification
            expect(level1).toBe(level2);

            return true;
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
