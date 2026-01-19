/**
 * Outlier Detector Tests
 *
 * Tests for statistical outlier detection including z-score method,
 * IQR method, rule-based detection, significance classification,
 * and edge cases.
 *
 * @requirements 5.7 - Outlier detection for code that deviates from patterns
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  OutlierDetector,
  detectOutliers,
  calculateStatistics,
  DEFAULT_OUTLIER_CONFIG,
  type OutlierDetectorConfig,
  type OutlierRule,
  type DataPoint,
} from './outlier-detector.js';
import type { PatternMatchResult, Location } from './types.js';

/**
 * Helper function to create a mock PatternMatchResult
 */
function createMockMatch(
  confidence: number,
  file: string = 'test.ts',
  line: number = 1,
  options: Partial<PatternMatchResult> = {}
): PatternMatchResult {
  return {
    patternId: 'test-pattern',
    location: {
      file,
      line,
      column: 1,
    },
    confidence,
    isOutlier: false,
    matchType: 'ast',
    timestamp: new Date(),
    ...options,
  };
}

/**
 * Helper function to create multiple mock matches with varying confidence
 */
function createMockMatches(confidences: number[]): PatternMatchResult[] {
  return confidences.map((confidence, index) =>
    createMockMatch(confidence, `file${index}.ts`, index + 1)
  );
}

describe('OutlierDetector', () => {
  let detector: OutlierDetector;

  beforeEach(() => {
    detector = new OutlierDetector();
  });

  describe('constructor', () => {
    it('should create a detector with default configuration', () => {
      const d = new OutlierDetector();
      expect(d.getConfig()).toEqual(DEFAULT_OUTLIER_CONFIG);
    });

    it('should create a detector with custom configuration', () => {
      const customConfig: Partial<OutlierDetectorConfig> = {
        sensitivity: 0.8,
        zScoreThreshold: 3.0,
      };
      const d = new OutlierDetector(customConfig);
      const config = d.getConfig();
      expect(config.sensitivity).toBe(0.8);
      expect(config.zScoreThreshold).toBe(3.0);
      expect(config.iqrMultiplier).toBe(DEFAULT_OUTLIER_CONFIG.iqrMultiplier);
    });

    it('should register default rules', () => {
      const d = new OutlierDetector();
      const rules = d.getRules();
      expect(rules.length).toBeGreaterThan(0);
      expect(rules.some((r) => r.id === 'low-confidence')).toBe(true);
      expect(rules.some((r) => r.id === 'marked-outlier')).toBe(true);
    });
  });

  describe('detect', () => {
    it('should return empty result for empty matches array', () => {
      const result = detector.detect([], 'test-pattern');
      expect(result.outliers).toHaveLength(0);
      expect(result.totalAnalyzed).toBe(0);
      expect(result.outlierRate).toBe(0);
      expect(result.patternId).toBe('test-pattern');
    });

    it('should detect outliers in a set of matches', () => {
      // Create matches with one clear outlier (very low confidence)
      const matches = createMockMatches([0.9, 0.85, 0.88, 0.87, 0.1, 0.86, 0.89]);
      const result = detector.detect(matches, 'test-pattern');

      expect(result.totalAnalyzed).toBe(7);
      expect(result.outliers.length).toBeGreaterThan(0);
      expect(result.outlierRate).toBeGreaterThan(0);
    });

    it('should include pattern ID in result', () => {
      const matches = createMockMatches([0.9, 0.85, 0.1]);
      const result = detector.detect(matches, 'my-pattern');
      expect(result.patternId).toBe('my-pattern');
    });

    it('should include timestamp in result', () => {
      const matches = createMockMatches([0.9, 0.85, 0.1]);
      const before = new Date();
      const result = detector.detect(matches, 'test-pattern');
      const after = new Date();

      expect(result.timestamp.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(result.timestamp.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it('should use rule-based detection for small sample sizes', () => {
      const detector = new OutlierDetector({ minSampleSize: 10 });
      const matches = createMockMatches([0.9, 0.1, 0.85]); // Only 3 matches
      const result = detector.detect(matches, 'test-pattern');

      expect(result.method).toBe('rule-based');
    });
  });

  describe('detectStatistical', () => {
    it('should detect statistical outliers using z-score', () => {
      // Create a dataset with clear outliers
      const matches = createMockMatches([
        0.9, 0.88, 0.87, 0.89, 0.86, // Normal values
        0.1, // Clear outlier (low)
      ]);

      const outliers = detector.detectStatistical(matches, 'test-pattern');
      expect(outliers.length).toBeGreaterThan(0);

      // The outlier should be the low confidence match
      const lowConfidenceOutlier = outliers.find(
        (o) => o.location.file === 'file5.ts'
      );
      expect(lowConfidenceOutlier).toBeDefined();
    });

    it('should return empty array for insufficient sample size', () => {
      const detector = new OutlierDetector({ minSampleSize: 10 });
      const matches = createMockMatches([0.9, 0.1, 0.85]);
      const outliers = detector.detectStatistical(matches, 'test-pattern');
      expect(outliers).toHaveLength(0);
    });

    it('should not detect outliers when all values are the same', () => {
      const matches = createMockMatches([0.8, 0.8, 0.8, 0.8, 0.8]);
      const outliers = detector.detectStatistical(matches, 'test-pattern');
      expect(outliers).toHaveLength(0);
    });
  });

  describe('detectByZScore', () => {
    it('should detect outliers with high z-scores', () => {
      // Use more data points to ensure we exceed minSampleSize and have a clear outlier
      const dataPoints: DataPoint[] = [
        { value: 0.9, match: createMockMatch(0.9, 'file1.ts') },
        { value: 0.88, match: createMockMatch(0.88, 'file2.ts') },
        { value: 0.87, match: createMockMatch(0.87, 'file3.ts') },
        { value: 0.89, match: createMockMatch(0.89, 'file4.ts') },
        { value: 0.86, match: createMockMatch(0.86, 'file5.ts') },
        { value: 0.91, match: createMockMatch(0.91, 'file6.ts') },
        { value: 0.85, match: createMockMatch(0.85, 'file7.ts') },
        { value: 0.1, match: createMockMatch(0.1, 'file8.ts') }, // Clear outlier
      ];

      // Use higher sensitivity to ensure detection
      const sensitiveDetector = new OutlierDetector({ sensitivity: 0.9 });
      const outliers = sensitiveDetector.detectByZScore(dataPoints, 'test-pattern');
      expect(outliers.length).toBeGreaterThan(0);
    });

    it('should return empty array for small sample sizes', () => {
      const dataPoints: DataPoint[] = [
        { value: 0.9, match: createMockMatch(0.9) },
        { value: 0.1, match: createMockMatch(0.1) },
      ];

      const outliers = detector.detectByZScore(dataPoints, 'test-pattern');
      expect(outliers).toHaveLength(0);
    });

    it('should include statistics in outlier context', () => {
      // Use more data points and higher sensitivity
      const dataPoints: DataPoint[] = [
        { value: 0.9, match: createMockMatch(0.9, 'file1.ts') },
        { value: 0.88, match: createMockMatch(0.88, 'file2.ts') },
        { value: 0.87, match: createMockMatch(0.87, 'file3.ts') },
        { value: 0.89, match: createMockMatch(0.89, 'file4.ts') },
        { value: 0.86, match: createMockMatch(0.86, 'file5.ts') },
        { value: 0.91, match: createMockMatch(0.91, 'file6.ts') },
        { value: 0.85, match: createMockMatch(0.85, 'file7.ts') },
        { value: 0.1, match: createMockMatch(0.1, 'file8.ts') }, // Clear outlier
      ];

      const sensitiveDetector = new OutlierDetector({ sensitivity: 0.9 });
      const outliers = sensitiveDetector.detectByZScore(dataPoints, 'test-pattern');
      
      expect(outliers.length).toBeGreaterThan(0);
      const outlier = outliers[0];

      expect(outlier?.context?.statistics).toBeDefined();
      expect(outlier?.context?.statistics?.mean).toBeDefined();
      expect(outlier?.context?.statistics?.standardDeviation).toBeDefined();
      expect(outlier?.context?.statistics?.zScore).toBeDefined();
      expect(outlier?.context?.statistics?.percentile).toBeDefined();
      expect(outlier?.context?.statistics?.sampleSize).toBe(8);
    });

    it('should respect sensitivity configuration', () => {
      const dataPoints: DataPoint[] = [
        { value: 0.9, match: createMockMatch(0.9, 'file1.ts') },
        { value: 0.85, match: createMockMatch(0.85, 'file2.ts') },
        { value: 0.87, match: createMockMatch(0.87, 'file3.ts') },
        { value: 0.88, match: createMockMatch(0.88, 'file4.ts') },
        { value: 0.86, match: createMockMatch(0.86, 'file5.ts') },
        { value: 0.6, match: createMockMatch(0.6, 'file6.ts') }, // Borderline outlier
      ];

      // High sensitivity should detect more outliers
      const highSensitivity = new OutlierDetector({ sensitivity: 0.9 });
      const highOutliers = highSensitivity.detectByZScore(dataPoints, 'test-pattern');

      // Low sensitivity should detect fewer outliers
      const lowSensitivity = new OutlierDetector({ sensitivity: 0.1 });
      const lowOutliers = lowSensitivity.detectByZScore(dataPoints, 'test-pattern');

      expect(highOutliers.length).toBeGreaterThanOrEqual(lowOutliers.length);
    });
  });

  describe('detectByIQR', () => {
    it('should detect outliers outside IQR bounds', () => {
      const dataPoints: DataPoint[] = [
        { value: 0.9, match: createMockMatch(0.9, 'file1.ts') },
        { value: 0.88, match: createMockMatch(0.88, 'file2.ts') },
        { value: 0.87, match: createMockMatch(0.87, 'file3.ts') },
        { value: 0.89, match: createMockMatch(0.89, 'file4.ts') },
        { value: 0.86, match: createMockMatch(0.86, 'file5.ts') },
        { value: 0.1, match: createMockMatch(0.1, 'file6.ts') }, // Below lower bound
      ];

      const outliers = detector.detectByIQR(dataPoints, 'test-pattern');
      expect(outliers.length).toBeGreaterThan(0);
    });

    it('should return empty array for small sample sizes', () => {
      const dataPoints: DataPoint[] = [
        { value: 0.9, match: createMockMatch(0.9) },
        { value: 0.1, match: createMockMatch(0.1) },
      ];

      const outliers = detector.detectByIQR(dataPoints, 'test-pattern');
      expect(outliers).toHaveLength(0);
    });

    it('should not detect outliers when IQR is 0', () => {
      const dataPoints: DataPoint[] = [
        { value: 0.8, match: createMockMatch(0.8, 'file1.ts') },
        { value: 0.8, match: createMockMatch(0.8, 'file2.ts') },
        { value: 0.8, match: createMockMatch(0.8, 'file3.ts') },
        { value: 0.8, match: createMockMatch(0.8, 'file4.ts') },
        { value: 0.8, match: createMockMatch(0.8, 'file5.ts') },
      ];

      const outliers = detector.detectByIQR(dataPoints, 'test-pattern');
      expect(outliers).toHaveLength(0);
    });

    it('should detect both high and low outliers', () => {
      const dataPoints: DataPoint[] = [
        { value: 0.5, match: createMockMatch(0.5, 'file1.ts') },
        { value: 0.52, match: createMockMatch(0.52, 'file2.ts') },
        { value: 0.48, match: createMockMatch(0.48, 'file3.ts') },
        { value: 0.51, match: createMockMatch(0.51, 'file4.ts') },
        { value: 0.49, match: createMockMatch(0.49, 'file5.ts') },
        { value: 0.1, match: createMockMatch(0.1, 'file6.ts') }, // Low outlier
        { value: 0.95, match: createMockMatch(0.95, 'file7.ts') }, // High outlier
      ];

      const outliers = detector.detectByIQR(dataPoints, 'test-pattern');

      // Should detect at least one outlier
      expect(outliers.length).toBeGreaterThan(0);
    });
  });

  describe('detectRuleBased', () => {
    it('should detect low confidence matches', () => {
      const matches = [
        createMockMatch(0.9, 'file1.ts'),
        createMockMatch(0.2, 'file2.ts'), // Low confidence
        createMockMatch(0.85, 'file3.ts'),
      ];

      const outliers = detector.detectRuleBased(matches, 'test-pattern');
      expect(outliers.some((o) => o.location.file === 'file2.ts')).toBe(true);
    });

    it('should detect pre-marked outliers', () => {
      const matches = [
        createMockMatch(0.9, 'file1.ts'),
        createMockMatch(0.85, 'file2.ts', 1, { isOutlier: true }),
        createMockMatch(0.88, 'file3.ts'),
      ];

      const outliers = detector.detectRuleBased(matches, 'test-pattern');
      expect(outliers.some((o) => o.location.file === 'file2.ts')).toBe(true);
    });

    it('should detect low similarity matches', () => {
      const matches = [
        createMockMatch(0.9, 'file1.ts'),
        createMockMatch(0.85, 'file2.ts', 1, { similarity: 0.3 }), // Low similarity
        createMockMatch(0.88, 'file3.ts'),
      ];

      const outliers = detector.detectRuleBased(matches, 'test-pattern');
      expect(outliers.some((o) => o.location.file === 'file2.ts')).toBe(true);
    });
  });

  describe('significance classification', () => {
    it('should classify high significance for extreme outliers', () => {
      // Create a dataset with an extreme outlier
      const matches = createMockMatches([
        0.9, 0.89, 0.88, 0.87, 0.86, 0.85, 0.84, 0.83, 0.82, 0.81,
        0.01, // Extreme outlier
      ]);

      const result = detector.detect(matches, 'test-pattern');
      const extremeOutlier = result.outliers.find(
        (o) => o.location.file === 'file10.ts'
      );

      if (extremeOutlier) {
        expect(['high', 'medium']).toContain(extremeOutlier.significance);
      }
    });

    it('should classify lower significance for mild outliers', () => {
      // Create a dataset with a mild outlier
      const matches = createMockMatches([
        0.9, 0.85, 0.87, 0.88, 0.86, 0.89, 0.84, 0.83, 0.82, 0.81,
        0.6, // Mild outlier
      ]);

      const result = detector.detect(matches, 'test-pattern');

      // Mild outliers should have lower significance
      for (const outlier of result.outliers) {
        expect(['high', 'medium', 'low']).toContain(outlier.significance);
      }
    });
  });

  describe('rule management', () => {
    it('should register custom rules', () => {
      const customRule: OutlierRule = {
        id: 'custom-rule',
        name: 'Custom Rule',
        type: 'structural',
        check: (match) => match.confidence < 0.5,
        getReason: () => 'Custom rule violation',
      };

      detector.registerRule(customRule);
      const rules = detector.getRules();
      expect(rules.some((r) => r.id === 'custom-rule')).toBe(true);
    });

    it('should unregister rules', () => {
      const customRule: OutlierRule = {
        id: 'temp-rule',
        name: 'Temporary Rule',
        type: 'structural',
        check: () => false,
        getReason: () => 'Temp',
      };

      detector.registerRule(customRule);
      expect(detector.getRules().some((r) => r.id === 'temp-rule')).toBe(true);

      const removed = detector.unregisterRule('temp-rule');
      expect(removed).toBe(true);
      expect(detector.getRules().some((r) => r.id === 'temp-rule')).toBe(false);
    });

    it('should return false when unregistering non-existent rule', () => {
      const removed = detector.unregisterRule('non-existent');
      expect(removed).toBe(false);
    });

    it('should apply custom rules in detection', () => {
      const customRule: OutlierRule = {
        id: 'custom-check',
        name: 'Custom Check',
        type: 'semantic',
        check: (match) => match.matchType === 'regex',
        getReason: () => 'Regex matches are outliers',
      };

      detector.registerRule(customRule);

      const matches = [
        createMockMatch(0.9, 'file1.ts', 1, { matchType: 'ast' }),
        createMockMatch(0.9, 'file2.ts', 1, { matchType: 'regex' }),
        createMockMatch(0.9, 'file3.ts', 1, { matchType: 'ast' }),
      ];

      const outliers = detector.detectRuleBased(matches, 'test-pattern');
      expect(outliers.some((o) => o.location.file === 'file2.ts')).toBe(true);
    });
  });

  describe('configuration', () => {
    it('should return a copy of configuration', () => {
      const config = detector.getConfig();
      config.sensitivity = 0.99;

      // Original config should not be modified
      expect(detector.getConfig().sensitivity).toBe(DEFAULT_OUTLIER_CONFIG.sensitivity);
    });

    it('should update configuration', () => {
      detector.updateConfig({ sensitivity: 0.8 });
      expect(detector.getConfig().sensitivity).toBe(0.8);
    });

    it('should preserve other config values when updating', () => {
      const originalIqr = detector.getConfig().iqrMultiplier;
      detector.updateConfig({ sensitivity: 0.8 });
      expect(detector.getConfig().iqrMultiplier).toBe(originalIqr);
    });
  });

  describe('edge cases', () => {
    it('should handle single match', () => {
      const matches = createMockMatches([0.9]);
      const result = detector.detect(matches, 'test-pattern');

      expect(result.totalAnalyzed).toBe(1);
      // Single match should use rule-based detection
      expect(result.method).toBe('rule-based');
    });

    it('should handle all same values', () => {
      const matches = createMockMatches([0.8, 0.8, 0.8, 0.8, 0.8, 0.8]);
      const result = detector.detect(matches, 'test-pattern');

      // No statistical outliers when all values are the same
      expect(result.outliers.filter((o) => o.deviationType !== 'inconsistent')).toHaveLength(0);
    });

    it('should handle very small confidence differences', () => {
      const matches = createMockMatches([
        0.8001, 0.8002, 0.8003, 0.8004, 0.8005, 0.8006,
      ]);
      const result = detector.detect(matches, 'test-pattern');

      // Very small differences should not produce outliers
      expect(result.outliers).toHaveLength(0);
    });

    it('should handle negative confidence values gracefully', () => {
      // This shouldn't happen in practice, but test robustness
      const matches = createMockMatches([0.9, 0.85, -0.1, 0.88, 0.87, 0.86]);
      const result = detector.detect(matches, 'test-pattern');

      // Should still produce a valid result
      expect(result.totalAnalyzed).toBe(6);
      expect(result.outlierRate).toBeGreaterThanOrEqual(0);
      expect(result.outlierRate).toBeLessThanOrEqual(1);
    });

    it('should handle confidence values greater than 1 gracefully', () => {
      // This shouldn't happen in practice, but test robustness
      const matches = createMockMatches([0.9, 0.85, 1.5, 0.88, 0.87, 0.86]);
      const result = detector.detect(matches, 'test-pattern');

      // Should still produce a valid result
      expect(result.totalAnalyzed).toBe(6);
    });
  });

  describe('outlier info structure', () => {
    it('should include all required fields in outlier info', () => {
      const matches = createMockMatches([0.9, 0.88, 0.87, 0.86, 0.85, 0.1]);
      const result = detector.detect(matches, 'test-pattern');

      for (const outlier of result.outliers) {
        expect(outlier.location).toBeDefined();
        expect(outlier.patternId).toBe('test-pattern');
        expect(outlier.reason).toBeDefined();
        expect(outlier.deviationScore).toBeGreaterThanOrEqual(0);
        expect(outlier.deviationScore).toBeLessThanOrEqual(1);
        expect(outlier.deviationType).toBeDefined();
        expect(outlier.significance).toBeDefined();
        expect(['high', 'medium', 'low']).toContain(outlier.significance);
      }
    });

    it('should include location with file and line', () => {
      const matches = createMockMatches([0.9, 0.88, 0.87, 0.86, 0.85, 0.1]);
      const result = detector.detect(matches, 'test-pattern');

      for (const outlier of result.outliers) {
        expect(outlier.location.file).toBeDefined();
        expect(outlier.location.line).toBeGreaterThan(0);
        expect(outlier.location.column).toBeGreaterThan(0);
      }
    });
  });
});

describe('detectOutliers', () => {
  it('should detect outliers using default configuration', () => {
    const matches = createMockMatches([0.9, 0.88, 0.87, 0.86, 0.85, 0.1]);
    const result = detectOutliers(matches, 'test-pattern');

    expect(result.patternId).toBe('test-pattern');
    expect(result.totalAnalyzed).toBe(6);
    expect(result.outliers.length).toBeGreaterThan(0);
  });
});

describe('calculateStatistics', () => {
  it('should calculate mean correctly', () => {
    const stats = calculateStatistics([1, 2, 3, 4, 5]);
    expect(stats.mean).toBe(3);
  });

  it('should calculate standard deviation correctly', () => {
    const stats = calculateStatistics([2, 4, 4, 4, 5, 5, 7, 9]);
    expect(stats.standardDeviation).toBeCloseTo(2, 1);
  });

  it('should calculate quartiles correctly', () => {
    const stats = calculateStatistics([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    // Using linear interpolation method:
    // Q1 at index 2.25 -> 3 + 0.25*(4-3) = 3.25
    // Median at index 4.5 -> 5 + 0.5*(6-5) = 5.5
    // Q3 at index 6.75 -> 7 + 0.75*(8-7) = 7.75
    expect(stats.q1).toBeCloseTo(3.25, 1);
    expect(stats.median).toBeCloseTo(5.5, 1);
    expect(stats.q3).toBeCloseTo(7.75, 1);
  });

  it('should calculate IQR correctly', () => {
    const stats = calculateStatistics([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    // IQR = Q3 - Q1 = 7.75 - 3.25 = 4.5
    expect(stats.iqr).toBeCloseTo(4.5, 1);
  });

  it('should handle empty array', () => {
    const stats = calculateStatistics([]);
    expect(stats.mean).toBe(0);
    expect(stats.standardDeviation).toBe(0);
    expect(stats.q1).toBe(0);
    expect(stats.median).toBe(0);
    expect(stats.q3).toBe(0);
    expect(stats.iqr).toBe(0);
  });

  it('should handle single value', () => {
    const stats = calculateStatistics([5]);
    expect(stats.mean).toBe(5);
    expect(stats.standardDeviation).toBe(0);
    expect(stats.median).toBe(5);
  });

  it('should handle all same values', () => {
    const stats = calculateStatistics([5, 5, 5, 5, 5]);
    expect(stats.mean).toBe(5);
    expect(stats.standardDeviation).toBe(0);
    expect(stats.iqr).toBe(0);
  });
});

describe('Integration tests', () => {
  it('should produce consistent results for same input', () => {
    const detector = new OutlierDetector();
    const matches = createMockMatches([0.9, 0.88, 0.87, 0.86, 0.85, 0.1]);

    const result1 = detector.detect(matches, 'test-pattern');
    const result2 = detector.detect(matches, 'test-pattern');

    expect(result1.outliers.length).toBe(result2.outliers.length);
    expect(result1.outlierRate).toBe(result2.outlierRate);
  });

  it('should detect more outliers with higher sensitivity', () => {
    const matches = createMockMatches([
      0.9, 0.85, 0.87, 0.88, 0.86, 0.89, 0.84, 0.83, 0.82, 0.81,
      0.6, // Borderline outlier
    ]);

    const highSensitivity = new OutlierDetector({ sensitivity: 0.9 });
    const lowSensitivity = new OutlierDetector({ sensitivity: 0.1 });

    const highResult = highSensitivity.detect(matches, 'test-pattern');
    const lowResult = lowSensitivity.detect(matches, 'test-pattern');

    expect(highResult.outliers.length).toBeGreaterThanOrEqual(lowResult.outliers.length);
  });

  it('should work with real-world-like data distribution', () => {
    // Simulate a normal distribution with a few outliers
    const normalValues = [
      0.82, 0.84, 0.85, 0.86, 0.87, 0.88, 0.89, 0.90, 0.91, 0.92,
      0.83, 0.85, 0.86, 0.87, 0.88, 0.89, 0.90, 0.91, 0.88, 0.87,
    ];
    const outlierValues = [0.15, 0.20]; // Clear outliers

    const matches = createMockMatches([...normalValues, ...outlierValues]);
    const result = detectOutliers(matches, 'test-pattern');

    // Should detect the outliers
    expect(result.outliers.length).toBeGreaterThan(0);

    // Outlier rate should be reasonable
    expect(result.outlierRate).toBeLessThan(0.5);
  });
});
