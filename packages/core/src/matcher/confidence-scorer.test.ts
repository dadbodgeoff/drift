/**
 * Confidence Scorer Tests
 *
 * Tests for confidence score calculation including frequency, consistency,
 * age, spread factors, weighted score calculation, and level classification.
 *
 * @requirements 5.1 - Pattern confidence scoring with frequency, consistency, age, spread factors
 * @requirements 5.2 - Confidence score SHALL be a decimal value between 0.0 and 1.0
 * @requirements 5.3 - High confidence: score >= 0.85
 * @requirements 5.4 - Medium confidence: score >= 0.70 and < 0.85
 * @requirements 5.5 - Low confidence: score >= 0.50 and < 0.70
 * @requirements 5.6 - Uncertain: score < 0.50
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  ConfidenceScorer,
  calculateConfidence,
  createConfidenceScore,
  DEFAULT_AGE_CONFIG,
} from './confidence-scorer.js';
import type { ConfidenceInput, ConfidenceWeights } from './types.js';
import { CONFIDENCE_THRESHOLDS, DEFAULT_CONFIDENCE_WEIGHTS } from './types.js';

describe('ConfidenceScorer', () => {
  let scorer: ConfidenceScorer;

  beforeEach(() => {
    scorer = new ConfidenceScorer();
  });

  describe('constructor', () => {
    it('should create a scorer with default weights', () => {
      const s = new ConfidenceScorer();
      expect(s.getWeights()).toEqual(DEFAULT_CONFIDENCE_WEIGHTS);
    });

    it('should create a scorer with custom weights', () => {
      const customWeights: ConfidenceWeights = {
        frequency: 0.5,
        consistency: 0.2,
        age: 0.2,
        spread: 0.1,
      };
      const s = new ConfidenceScorer(customWeights);
      expect(s.getWeights()).toEqual(customWeights);
    });

    it('should throw error if weights do not sum to 1.0', () => {
      const invalidWeights: ConfidenceWeights = {
        frequency: 0.5,
        consistency: 0.5,
        age: 0.5,
        spread: 0.5,
      };
      expect(() => new ConfidenceScorer(invalidWeights)).toThrow(
        /weights must sum to 1.0/i
      );
    });

    it('should accept partial weights and merge with defaults', () => {
      const partialWeights: Partial<ConfidenceWeights> = {
        frequency: 0.4,
      };
      const s = new ConfidenceScorer(partialWeights);
      const weights = s.getWeights();
      expect(weights.frequency).toBe(0.4);
      expect(weights.consistency).toBe(DEFAULT_CONFIDENCE_WEIGHTS.consistency);
    });

    it('should create a scorer with custom age config', () => {
      const s = new ConfidenceScorer(undefined, { maxAgeDays: 60 });
      expect(s.getAgeConfig().maxAgeDays).toBe(60);
    });
  });

  describe('calculateFrequency', () => {
    it('should calculate frequency as occurrences / totalLocations', () => {
      const frequency = scorer.calculateFrequency(50, 100);
      expect(frequency).toBe(0.5);
    });

    it('should return 0 when totalLocations is 0', () => {
      const frequency = scorer.calculateFrequency(10, 0);
      expect(frequency).toBe(0);
    });

    it('should return 0 when occurrences is 0', () => {
      const frequency = scorer.calculateFrequency(0, 100);
      expect(frequency).toBe(0);
    });

    it('should return 0 when totalLocations is negative', () => {
      const frequency = scorer.calculateFrequency(10, -5);
      expect(frequency).toBe(0);
    });

    it('should return 0 when occurrences is negative', () => {
      const frequency = scorer.calculateFrequency(-10, 100);
      expect(frequency).toBe(0);
    });

    it('should clamp frequency to 1.0 when occurrences > totalLocations', () => {
      const frequency = scorer.calculateFrequency(150, 100);
      expect(frequency).toBe(1.0);
    });

    it('should return 1.0 when all locations have occurrences', () => {
      const frequency = scorer.calculateFrequency(100, 100);
      expect(frequency).toBe(1.0);
    });

    it('should handle small fractions correctly', () => {
      const frequency = scorer.calculateFrequency(1, 1000);
      expect(frequency).toBe(0.001);
    });
  });

  describe('calculateConsistency', () => {
    it('should return 1.0 when variance is 0 (perfectly consistent)', () => {
      const consistency = scorer.calculateConsistency(0);
      expect(consistency).toBe(1.0);
    });

    it('should return 0.0 when variance is 1.0 (maximum variance)', () => {
      const consistency = scorer.calculateConsistency(1.0);
      expect(consistency).toBe(0.0);
    });

    it('should return 0.5 when variance is 0.5', () => {
      const consistency = scorer.calculateConsistency(0.5);
      expect(consistency).toBe(0.5);
    });

    it('should return 1.0 when variance is negative (invalid)', () => {
      const consistency = scorer.calculateConsistency(-0.5);
      expect(consistency).toBe(1.0);
    });

    it('should clamp variance to 1.0 when greater than 1.0', () => {
      const consistency = scorer.calculateConsistency(1.5);
      expect(consistency).toBe(0.0);
    });

    it('should handle small variance values', () => {
      const consistency = scorer.calculateConsistency(0.1);
      expect(consistency).toBe(0.9);
    });
  });

  describe('calculateAgeFactor', () => {
    it('should return minAgeFactor when daysSinceFirstSeen is 0', () => {
      const ageFactor = scorer.calculateAgeFactor(0);
      expect(ageFactor).toBe(DEFAULT_AGE_CONFIG.minAgeFactor);
    });

    it('should return minAgeFactor when daysSinceFirstSeen is negative', () => {
      const ageFactor = scorer.calculateAgeFactor(-5);
      expect(ageFactor).toBe(DEFAULT_AGE_CONFIG.minAgeFactor);
    });

    it('should return 1.0 when daysSinceFirstSeen >= maxAgeDays', () => {
      const ageFactor = scorer.calculateAgeFactor(30);
      expect(ageFactor).toBe(1.0);
    });

    it('should return 1.0 when daysSinceFirstSeen > maxAgeDays', () => {
      const ageFactor = scorer.calculateAgeFactor(100);
      expect(ageFactor).toBe(1.0);
    });

    it('should scale linearly between minAgeFactor and 1.0', () => {
      // At 15 days (half of maxAgeDays=30), should be halfway between min and 1.0
      const ageFactor = scorer.calculateAgeFactor(15);
      const expected =
        DEFAULT_AGE_CONFIG.minAgeFactor +
        0.5 * (1.0 - DEFAULT_AGE_CONFIG.minAgeFactor);
      expect(ageFactor).toBeCloseTo(expected, 5);
    });

    it('should use custom maxAgeDays', () => {
      const customScorer = new ConfidenceScorer(undefined, { maxAgeDays: 60 });
      const ageFactor = customScorer.calculateAgeFactor(60);
      expect(ageFactor).toBe(1.0);
    });

    it('should use custom minAgeFactor', () => {
      const customScorer = new ConfidenceScorer(undefined, { minAgeFactor: 0.2 });
      const ageFactor = customScorer.calculateAgeFactor(0);
      expect(ageFactor).toBe(0.2);
    });
  });

  describe('calculateSpread', () => {
    it('should calculate spread as fileCount / totalFiles', () => {
      const spread = scorer.calculateSpread(25, 100);
      expect(spread).toBe(0.25);
    });

    it('should return 0 when totalFiles is 0', () => {
      const spread = scorer.calculateSpread(10, 0);
      expect(spread).toBe(0);
    });

    it('should return 0 when fileCount is 0', () => {
      const spread = scorer.calculateSpread(0, 100);
      expect(spread).toBe(0);
    });

    it('should return 0 when totalFiles is negative', () => {
      const spread = scorer.calculateSpread(10, -5);
      expect(spread).toBe(0);
    });

    it('should return 0 when fileCount is negative', () => {
      const spread = scorer.calculateSpread(-10, 100);
      expect(spread).toBe(0);
    });

    it('should clamp spread to 1.0 when fileCount > totalFiles', () => {
      const spread = scorer.calculateSpread(150, 100);
      expect(spread).toBe(1.0);
    });

    it('should return 1.0 when pattern is in all files', () => {
      const spread = scorer.calculateSpread(100, 100);
      expect(spread).toBe(1.0);
    });
  });

  describe('classifyLevel', () => {
    it('should classify score >= 0.85 as high', () => {
      expect(scorer.classifyLevel(0.85)).toBe('high');
      expect(scorer.classifyLevel(0.9)).toBe('high');
      expect(scorer.classifyLevel(1.0)).toBe('high');
    });

    it('should classify score >= 0.70 and < 0.85 as medium', () => {
      expect(scorer.classifyLevel(0.70)).toBe('medium');
      expect(scorer.classifyLevel(0.75)).toBe('medium');
      expect(scorer.classifyLevel(0.84)).toBe('medium');
      expect(scorer.classifyLevel(0.849)).toBe('medium');
    });

    it('should classify score >= 0.50 and < 0.70 as low', () => {
      expect(scorer.classifyLevel(0.50)).toBe('low');
      expect(scorer.classifyLevel(0.6)).toBe('low');
      expect(scorer.classifyLevel(0.69)).toBe('low');
      expect(scorer.classifyLevel(0.699)).toBe('low');
    });

    it('should classify score < 0.50 as uncertain', () => {
      expect(scorer.classifyLevel(0.49)).toBe('uncertain');
      expect(scorer.classifyLevel(0.3)).toBe('uncertain');
      expect(scorer.classifyLevel(0.0)).toBe('uncertain');
    });

    it('should use CONFIDENCE_THRESHOLDS constants', () => {
      expect(scorer.classifyLevel(CONFIDENCE_THRESHOLDS.HIGH)).toBe('high');
      expect(scorer.classifyLevel(CONFIDENCE_THRESHOLDS.MEDIUM)).toBe('medium');
      expect(scorer.classifyLevel(CONFIDENCE_THRESHOLDS.LOW)).toBe('low');
      expect(scorer.classifyLevel(CONFIDENCE_THRESHOLDS.LOW - 0.01)).toBe('uncertain');
    });
  });

  describe('calculateScore', () => {
    it('should calculate weighted score from all factors', () => {
      const input: ConfidenceInput = {
        occurrences: 80,
        totalLocations: 100,
        variance: 0.1,
        daysSinceFirstSeen: 30,
        fileCount: 50,
        totalFiles: 100,
      };

      const result = scorer.calculateScore(input);

      // Verify individual factors
      expect(result.frequency).toBe(0.8);
      expect(result.consistency).toBe(0.9);
      expect(result.age).toBe(30);
      expect(result.spread).toBe(50);

      // Verify score is in valid range
      expect(result.score).toBeGreaterThanOrEqual(0.0);
      expect(result.score).toBeLessThanOrEqual(1.0);

      // Verify level is set
      expect(['high', 'medium', 'low', 'uncertain']).toContain(result.level);
    });

    it('should return high confidence for perfect input', () => {
      const input: ConfidenceInput = {
        occurrences: 100,
        totalLocations: 100,
        variance: 0,
        daysSinceFirstSeen: 30,
        fileCount: 100,
        totalFiles: 100,
      };

      const result = scorer.calculateScore(input);

      expect(result.frequency).toBe(1.0);
      expect(result.consistency).toBe(1.0);
      expect(result.score).toBe(1.0);
      expect(result.level).toBe('high');
    });

    it('should return uncertain confidence for poor input', () => {
      const input: ConfidenceInput = {
        occurrences: 5,
        totalLocations: 100,
        variance: 0.8,
        daysSinceFirstSeen: 1,
        fileCount: 2,
        totalFiles: 100,
      };

      const result = scorer.calculateScore(input);

      expect(result.score).toBeLessThan(0.5);
      expect(result.level).toBe('uncertain');
    });

    it('should clamp score to [0.0, 1.0] range', () => {
      // Even with extreme values, score should be clamped
      const input: ConfidenceInput = {
        occurrences: 1000,
        totalLocations: 100,
        variance: -1,
        daysSinceFirstSeen: 1000,
        fileCount: 1000,
        totalFiles: 100,
      };

      const result = scorer.calculateScore(input);

      expect(result.score).toBeLessThanOrEqual(1.0);
      expect(result.score).toBeGreaterThanOrEqual(0.0);
    });

    it('should handle zero values gracefully', () => {
      const input: ConfidenceInput = {
        occurrences: 0,
        totalLocations: 0,
        variance: 0,
        daysSinceFirstSeen: 0,
        fileCount: 0,
        totalFiles: 0,
      };

      const result = scorer.calculateScore(input);

      expect(result.frequency).toBe(0);
      expect(result.consistency).toBe(1.0);
      expect(result.spread).toBe(0);
      expect(result.score).toBeGreaterThanOrEqual(0.0);
      expect(result.score).toBeLessThanOrEqual(1.0);
    });

    it('should apply custom weights correctly', () => {
      const customWeights: ConfidenceWeights = {
        frequency: 1.0,
        consistency: 0.0,
        age: 0.0,
        spread: 0.0,
      };
      const customScorer = new ConfidenceScorer(customWeights);

      const input: ConfidenceInput = {
        occurrences: 50,
        totalLocations: 100,
        variance: 0,
        daysSinceFirstSeen: 30,
        fileCount: 100,
        totalFiles: 100,
      };

      const result = customScorer.calculateScore(input);

      // With 100% weight on frequency, score should equal frequency
      expect(result.score).toBe(0.5);
    });

    it('should calculate correct weighted score with default weights', () => {
      const input: ConfidenceInput = {
        occurrences: 100,
        totalLocations: 100, // frequency = 1.0
        variance: 0, // consistency = 1.0
        daysSinceFirstSeen: 30, // age factor = 1.0
        fileCount: 100,
        totalFiles: 100, // spread = 1.0
      };

      const result = scorer.calculateScore(input);

      // All factors are 1.0, so weighted score should be 1.0
      const expectedScore =
        1.0 * DEFAULT_CONFIDENCE_WEIGHTS.frequency +
        1.0 * DEFAULT_CONFIDENCE_WEIGHTS.consistency +
        1.0 * DEFAULT_CONFIDENCE_WEIGHTS.age +
        1.0 * DEFAULT_CONFIDENCE_WEIGHTS.spread;

      expect(result.score).toBeCloseTo(expectedScore, 5);
    });
  });

  describe('edge cases', () => {
    it('should handle very large numbers', () => {
      const input: ConfidenceInput = {
        occurrences: 1000000,
        totalLocations: 1000000,
        variance: 0.001,
        daysSinceFirstSeen: 365,
        fileCount: 10000,
        totalFiles: 10000,
      };

      const result = scorer.calculateScore(input);

      expect(result.score).toBeGreaterThanOrEqual(0.0);
      expect(result.score).toBeLessThanOrEqual(1.0);
    });

    it('should handle very small numbers', () => {
      const input: ConfidenceInput = {
        occurrences: 1,
        totalLocations: 1000000,
        variance: 0.999,
        daysSinceFirstSeen: 1,
        fileCount: 1,
        totalFiles: 1000000,
      };

      const result = scorer.calculateScore(input);

      expect(result.score).toBeGreaterThanOrEqual(0.0);
      expect(result.score).toBeLessThanOrEqual(1.0);
      expect(result.level).toBe('uncertain');
    });

    it('should handle floating point precision', () => {
      const input: ConfidenceInput = {
        occurrences: 1,
        totalLocations: 3, // 0.333...
        variance: 0.333,
        daysSinceFirstSeen: 10,
        fileCount: 1,
        totalFiles: 3,
      };

      const result = scorer.calculateScore(input);

      expect(result.score).toBeGreaterThanOrEqual(0.0);
      expect(result.score).toBeLessThanOrEqual(1.0);
    });
  });

  describe('getWeights', () => {
    it('should return a copy of weights', () => {
      const weights = scorer.getWeights();
      weights.frequency = 0.99;

      // Original weights should not be modified
      expect(scorer.getWeights().frequency).toBe(DEFAULT_CONFIDENCE_WEIGHTS.frequency);
    });
  });

  describe('getAgeConfig', () => {
    it('should return a copy of age config', () => {
      const config = scorer.getAgeConfig();
      config.maxAgeDays = 999;

      // Original config should not be modified
      expect(scorer.getAgeConfig().maxAgeDays).toBe(DEFAULT_AGE_CONFIG.maxAgeDays);
    });
  });
});

describe('calculateConfidence', () => {
  it('should calculate confidence using default weights', () => {
    const input: ConfidenceInput = {
      occurrences: 80,
      totalLocations: 100,
      variance: 0.1,
      daysSinceFirstSeen: 30,
      fileCount: 50,
      totalFiles: 100,
    };

    const result = calculateConfidence(input);

    expect(result.frequency).toBe(0.8);
    expect(result.consistency).toBe(0.9);
    expect(result.score).toBeGreaterThanOrEqual(0.0);
    expect(result.score).toBeLessThanOrEqual(1.0);
  });
});

describe('createConfidenceScore', () => {
  it('should create a confidence score with correct level', () => {
    const result = createConfidenceScore(0.8, 0.9, 30, 50, 0.9);

    expect(result.frequency).toBe(0.8);
    expect(result.consistency).toBe(0.9);
    expect(result.age).toBe(30);
    expect(result.spread).toBe(50);
    expect(result.score).toBe(0.9);
    expect(result.level).toBe('high');
  });

  it('should classify level based on score', () => {
    expect(createConfidenceScore(0, 0, 0, 0, 0.9).level).toBe('high');
    expect(createConfidenceScore(0, 0, 0, 0, 0.75).level).toBe('medium');
    expect(createConfidenceScore(0, 0, 0, 0, 0.6).level).toBe('low');
    expect(createConfidenceScore(0, 0, 0, 0, 0.3).level).toBe('uncertain');
  });
});

describe('Confidence level boundary tests', () => {
  let scorer: ConfidenceScorer;

  beforeEach(() => {
    scorer = new ConfidenceScorer();
  });

  it('should correctly classify at exact threshold boundaries', () => {
    // Exactly at high threshold
    expect(scorer.classifyLevel(0.85)).toBe('high');

    // Just below high threshold
    expect(scorer.classifyLevel(0.8499999)).toBe('medium');

    // Exactly at medium threshold
    expect(scorer.classifyLevel(0.70)).toBe('medium');

    // Just below medium threshold
    expect(scorer.classifyLevel(0.6999999)).toBe('low');

    // Exactly at low threshold
    expect(scorer.classifyLevel(0.50)).toBe('low');

    // Just below low threshold
    expect(scorer.classifyLevel(0.4999999)).toBe('uncertain');
  });
});

describe('Integration tests', () => {
  it('should produce consistent results for same input', () => {
    const scorer = new ConfidenceScorer();
    const input: ConfidenceInput = {
      occurrences: 75,
      totalLocations: 100,
      variance: 0.15,
      daysSinceFirstSeen: 20,
      fileCount: 40,
      totalFiles: 100,
    };

    const result1 = scorer.calculateScore(input);
    const result2 = scorer.calculateScore(input);

    expect(result1.score).toBe(result2.score);
    expect(result1.level).toBe(result2.level);
  });

  it('should produce higher scores for better patterns', () => {
    const scorer = new ConfidenceScorer();

    const goodInput: ConfidenceInput = {
      occurrences: 90,
      totalLocations: 100,
      variance: 0.05,
      daysSinceFirstSeen: 30,
      fileCount: 80,
      totalFiles: 100,
    };

    const poorInput: ConfidenceInput = {
      occurrences: 10,
      totalLocations: 100,
      variance: 0.8,
      daysSinceFirstSeen: 2,
      fileCount: 5,
      totalFiles: 100,
    };

    const goodResult = scorer.calculateScore(goodInput);
    const poorResult = scorer.calculateScore(poorInput);

    expect(goodResult.score).toBeGreaterThan(poorResult.score);
  });
});
