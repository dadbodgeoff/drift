/**
 * Outlier Detector - Statistical outlier detection for pattern deviations
 *
 * Identifies code that deviates from established patterns using statistical
 * methods including z-score analysis, IQR (Interquartile Range) detection,
 * and rule-based detection for specific pattern violations.
 *
 * @requirements 5.7 - Outlier detection for code that deviates from patterns
 */

import type {
  PatternMatchResult,
  OutlierInfo,
  OutlierType,
  OutlierSignificance,
  OutlierStatistics,
  OutlierDetectionResult,
  OutlierDetectionMethod,
} from './types.js';

/**
 * Configuration for outlier detection
 */
export interface OutlierDetectorConfig {
  /**
   * Sensitivity threshold for outlier detection (0.0 to 1.0)
   * Lower values = more sensitive (more outliers detected)
   * Default: 0.5
   */
  sensitivity: number;

  /**
   * Z-score threshold for statistical outlier detection
   * Values with z-score above this are considered outliers
   * Default: 2.0 (approximately 95% confidence)
   */
  zScoreThreshold: number;

  /**
   * IQR multiplier for IQR-based outlier detection
   * Values outside Q1 - (multiplier * IQR) or Q3 + (multiplier * IQR) are outliers
   * Default: 1.5 (standard Tukey fence)
   */
  iqrMultiplier: number;

  /**
   * Minimum sample size for statistical detection
   * Below this, rule-based detection is used instead
   * Default: 5
   */
  minSampleSize: number;

  /**
   * Detection method to use
   * Default: 'statistical'
   */
  method: OutlierDetectionMethod;

  /**
   * Whether to include context information in outlier results
   * Default: true
   */
  includeContext: boolean;
}

/**
 * Default outlier detector configuration
 */
export const DEFAULT_OUTLIER_CONFIG: OutlierDetectorConfig = {
  sensitivity: 0.5,
  zScoreThreshold: 2.0,
  iqrMultiplier: 1.5,
  minSampleSize: 5,
  method: 'statistical',
  includeContext: true,
};

/**
 * Input data point for outlier analysis
 */
export interface DataPoint {
  /** The value to analyze */
  value: number;

  /** Associated pattern match result */
  match: PatternMatchResult;

  /** Optional label for the data point */
  label?: string;
}

/**
 * Rule definition for rule-based outlier detection
 */
export interface OutlierRule {
  /** Rule identifier */
  id: string;

  /** Rule name */
  name: string;

  /** Outlier type this rule detects */
  type: OutlierType;

  /** Function to check if a match violates the rule */
  check: (match: PatternMatchResult, allMatches: PatternMatchResult[]) => boolean;

  /** Function to generate the reason for the outlier */
  getReason: (match: PatternMatchResult) => string;

  /** Expected value/structure */
  getExpected?: (match: PatternMatchResult, allMatches: PatternMatchResult[]) => string;

  /** Suggested fix */
  getSuggestedFix?: (match: PatternMatchResult) => string;
}

/**
 * OutlierDetector class for detecting statistical outliers in pattern matches.
 *
 * Supports multiple detection methods:
 * - Statistical: Uses z-score and IQR analysis
 * - Rule-based: Uses predefined rules for specific violations
 * - Clustering: Groups similar matches and identifies outliers (future)
 * - ML-based: Machine learning-based detection (future)
 *
 * @requirements 5.7 - Outlier detection for code that deviates from patterns
 */
export class OutlierDetector {
  private config: OutlierDetectorConfig;
  private rules: Map<string, OutlierRule>;

  /**
   * Create a new OutlierDetector instance.
   *
   * @param config - Optional configuration for outlier detection
   */
  constructor(config?: Partial<OutlierDetectorConfig>) {
    this.config = {
      ...DEFAULT_OUTLIER_CONFIG,
      ...config,
    };
    this.rules = new Map();

    // Register default rules
    this.registerDefaultRules();
  }

  /**
   * Detect outliers in a set of pattern matches.
   *
   * @param matches - Array of pattern match results to analyze
   * @param patternId - ID of the pattern being analyzed
   * @returns Outlier detection result with all detected outliers
   *
   * @requirements 5.7 - Outlier detection for code that deviates from patterns
   */
  detect(matches: PatternMatchResult[], patternId: string): OutlierDetectionResult {
    const timestamp = new Date();
    const outliers: OutlierInfo[] = [];

    if (matches.length === 0) {
      return {
        patternId,
        outliers: [],
        totalAnalyzed: 0,
        outlierRate: 0,
        timestamp,
        method: this.config.method,
      };
    }

    // Choose detection method based on configuration and sample size
    const method = this.selectMethod(matches.length);

    switch (method) {
      case 'statistical':
        outliers.push(...this.detectStatistical(matches, patternId));
        break;
      case 'rule-based':
        outliers.push(...this.detectRuleBased(matches, patternId));
        break;
      case 'clustering':
        // Fall back to statistical for now
        outliers.push(...this.detectStatistical(matches, patternId));
        break;
      case 'ml-based':
        // Fall back to statistical for now
        outliers.push(...this.detectStatistical(matches, patternId));
        break;
    }

    // Calculate outlier rate
    const outlierRate = matches.length > 0 ? outliers.length / matches.length : 0;

    return {
      patternId,
      outliers,
      totalAnalyzed: matches.length,
      outlierRate,
      timestamp,
      method,
    };
  }

  /**
   * Detect outliers using statistical methods (z-score and IQR).
   *
   * @param matches - Pattern matches to analyze
   * @param patternId - Pattern ID
   * @returns Array of detected outliers
   */
  detectStatistical(matches: PatternMatchResult[], patternId: string): OutlierInfo[] {
    const outliers: OutlierInfo[] = [];

    // Extract confidence values as data points
    const dataPoints: DataPoint[] = matches.map((match) => ({
      value: match.confidence,
      match,
    }));

    // Detect outliers using z-score method
    const zScoreOutliers = this.detectByZScore(dataPoints, patternId);
    outliers.push(...zScoreOutliers);

    // Detect outliers using IQR method (may find additional outliers)
    const iqrOutliers = this.detectByIQR(dataPoints, patternId);

    // Merge results, avoiding duplicates
    for (const iqrOutlier of iqrOutliers) {
      const isDuplicate = outliers.some(
        (o) =>
          o.location.file === iqrOutlier.location.file &&
          o.location.line === iqrOutlier.location.line
      );
      if (!isDuplicate) {
        outliers.push(iqrOutlier);
      }
    }

    return outliers;
  }

  /**
   * Detect outliers using z-score method.
   *
   * Z-score measures how many standard deviations a value is from the mean.
   * Values with |z-score| > threshold are considered outliers.
   *
   * @param dataPoints - Data points to analyze
   * @param patternId - Pattern ID
   * @returns Array of detected outliers
   */
  detectByZScore(dataPoints: DataPoint[], patternId: string): OutlierInfo[] {
    const outliers: OutlierInfo[] = [];

    if (dataPoints.length < this.config.minSampleSize) {
      return outliers;
    }

    const values = dataPoints.map((dp) => dp.value);
    const stats = this.calculateStatistics(values);

    // Skip if standard deviation is 0 (all values are the same)
    if (stats.standardDeviation === 0) {
      return outliers;
    }

    for (const dataPoint of dataPoints) {
      const zScore = (dataPoint.value - stats.mean) / stats.standardDeviation;
      const absZScore = Math.abs(zScore);

      // Adjust threshold based on sensitivity
      const adjustedThreshold = this.config.zScoreThreshold * (1 + (1 - this.config.sensitivity));

      if (absZScore > adjustedThreshold) {
        const significance = this.classifySignificance(absZScore);
        const percentile = this.calculatePercentile(dataPoint.value, values);

        const outlierStats: OutlierStatistics = {
          mean: stats.mean,
          standardDeviation: stats.standardDeviation,
          zScore,
          percentile,
          sampleSize: dataPoints.length,
        };

        const outlier = this.createOutlierInfo(
          dataPoint.match,
          patternId,
          zScore < 0 ? 'Low confidence outlier' : 'High confidence outlier',
          this.calculateDeviationScore(absZScore),
          this.determineOutlierType(dataPoint.match, zScore),
          significance,
          outlierStats
        );

        outliers.push(outlier);
      }
    }

    return outliers;
  }

  /**
   * Detect outliers using IQR (Interquartile Range) method.
   *
   * IQR is the range between Q1 (25th percentile) and Q3 (75th percentile).
   * Values outside [Q1 - k*IQR, Q3 + k*IQR] are considered outliers.
   *
   * @param dataPoints - Data points to analyze
   * @param patternId - Pattern ID
   * @returns Array of detected outliers
   */
  detectByIQR(dataPoints: DataPoint[], patternId: string): OutlierInfo[] {
    const outliers: OutlierInfo[] = [];

    if (dataPoints.length < this.config.minSampleSize) {
      return outliers;
    }

    const values = dataPoints.map((dp) => dp.value);
    const sortedValues = [...values].sort((a, b) => a - b);

    const q1 = this.calculateQuartile(sortedValues, 0.25);
    const q3 = this.calculateQuartile(sortedValues, 0.75);
    const iqr = q3 - q1;

    // Skip if IQR is 0 (all values are very similar)
    if (iqr === 0) {
      return outliers;
    }

    // Adjust multiplier based on sensitivity
    const adjustedMultiplier = this.config.iqrMultiplier * (1 + (1 - this.config.sensitivity));

    const lowerBound = q1 - adjustedMultiplier * iqr;
    const upperBound = q3 + adjustedMultiplier * iqr;

    const stats = this.calculateStatistics(values);

    for (const dataPoint of dataPoints) {
      if (dataPoint.value < lowerBound || dataPoint.value > upperBound) {
        const zScore = stats.standardDeviation > 0
          ? (dataPoint.value - stats.mean) / stats.standardDeviation
          : 0;
        const percentile = this.calculatePercentile(dataPoint.value, values);

        // Calculate how far outside the bounds the value is
        const distanceFromBound = dataPoint.value < lowerBound
          ? lowerBound - dataPoint.value
          : dataPoint.value - upperBound;
        const normalizedDistance = iqr > 0 ? distanceFromBound / iqr : 0;

        const significance = this.classifySignificanceByIQR(normalizedDistance);

        const outlierStats: OutlierStatistics = {
          mean: stats.mean,
          standardDeviation: stats.standardDeviation,
          zScore,
          percentile,
          sampleSize: dataPoints.length,
        };

        const outlier = this.createOutlierInfo(
          dataPoint.match,
          patternId,
          dataPoint.value < lowerBound
            ? 'Value below IQR lower bound'
            : 'Value above IQR upper bound',
          this.clamp(normalizedDistance / 3, 0, 1), // Normalize to 0-1
          this.determineOutlierType(dataPoint.match, zScore),
          significance,
          outlierStats
        );

        outliers.push(outlier);
      }
    }

    return outliers;
  }

  /**
   * Detect outliers using rule-based detection.
   *
   * @param matches - Pattern matches to analyze
   * @param patternId - Pattern ID
   * @returns Array of detected outliers
   */
  detectRuleBased(matches: PatternMatchResult[], patternId: string): OutlierInfo[] {
    const outliers: OutlierInfo[] = [];

    for (const match of matches) {
      for (const rule of this.rules.values()) {
        if (rule.check(match, matches)) {
          const outlier: OutlierInfo = {
            location: match.location,
            patternId,
            reason: rule.getReason(match),
            deviationScore: this.config.sensitivity,
            deviationType: rule.type,
            significance: 'medium',
          };

          if (rule.getExpected) {
            outlier.expected = rule.getExpected(match, matches);
          }

          if (match.matchedText) {
            outlier.actual = match.matchedText;
          }

          if (rule.getSuggestedFix) {
            outlier.suggestedFix = rule.getSuggestedFix(match);
          }

          outliers.push(outlier);
        }
      }
    }

    return outliers;
  }

  /**
   * Register a custom outlier detection rule.
   *
   * @param rule - The rule to register
   */
  registerRule(rule: OutlierRule): void {
    this.rules.set(rule.id, rule);
  }

  /**
   * Unregister an outlier detection rule.
   *
   * @param ruleId - ID of the rule to unregister
   * @returns True if the rule was removed, false if it didn't exist
   */
  unregisterRule(ruleId: string): boolean {
    return this.rules.delete(ruleId);
  }

  /**
   * Get all registered rules.
   *
   * @returns Array of registered rules
   */
  getRules(): OutlierRule[] {
    return Array.from(this.rules.values());
  }

  /**
   * Get the current configuration.
   *
   * @returns Copy of the current configuration
   */
  getConfig(): OutlierDetectorConfig {
    return { ...this.config };
  }

  /**
   * Update the configuration.
   *
   * @param config - Partial configuration to update
   */
  updateConfig(config: Partial<OutlierDetectorConfig>): void {
    this.config = {
      ...this.config,
      ...config,
    };
  }

  // ============================================================================
  // Private Helper Methods
  // ============================================================================

  /**
   * Select the appropriate detection method based on sample size and config.
   */
  private selectMethod(sampleSize: number): OutlierDetectionMethod {
    if (sampleSize < this.config.minSampleSize) {
      return 'rule-based';
    }
    return this.config.method;
  }

  /**
   * Calculate basic statistics for a set of values.
   */
  private calculateStatistics(values: number[]): { mean: number; standardDeviation: number } {
    if (values.length === 0) {
      return { mean: 0, standardDeviation: 0 };
    }

    const mean = values.reduce((sum, v) => sum + v, 0) / values.length;

    if (values.length === 1) {
      return { mean, standardDeviation: 0 };
    }

    const squaredDiffs = values.map((v) => Math.pow(v - mean, 2));
    const variance = squaredDiffs.reduce((sum, v) => sum + v, 0) / values.length;
    const standardDeviation = Math.sqrt(variance);

    return { mean, standardDeviation };
  }

  /**
   * Calculate a quartile value from sorted data.
   */
  private calculateQuartile(sortedValues: number[], quartile: number): number {
    if (sortedValues.length === 0) {
      return 0;
    }

    const index = quartile * (sortedValues.length - 1);
    const lower = Math.floor(index);
    const upper = Math.ceil(index);

    if (lower === upper) {
      return sortedValues[lower] ?? 0;
    }

    const lowerValue = sortedValues[lower] ?? 0;
    const upperValue = sortedValues[upper] ?? 0;
    const fraction = index - lower;

    return lowerValue + fraction * (upperValue - lowerValue);
  }

  /**
   * Calculate the percentile rank of a value in a dataset.
   */
  private calculatePercentile(value: number, values: number[]): number {
    if (values.length === 0) {
      return 0;
    }

    const belowCount = values.filter((v) => v < value).length;
    const equalCount = values.filter((v) => v === value).length;

    return ((belowCount + 0.5 * equalCount) / values.length) * 100;
  }

  /**
   * Classify outlier significance based on z-score.
   */
  private classifySignificance(absZScore: number): OutlierSignificance {
    if (absZScore >= 3.0) {
      return 'high';
    }
    if (absZScore >= 2.5) {
      return 'medium';
    }
    return 'low';
  }

  /**
   * Classify outlier significance based on IQR distance.
   */
  private classifySignificanceByIQR(normalizedDistance: number): OutlierSignificance {
    if (normalizedDistance >= 3.0) {
      return 'high';
    }
    if (normalizedDistance >= 2.0) {
      return 'medium';
    }
    return 'low';
  }

  /**
   * Calculate deviation score from z-score (normalized to 0-1).
   */
  private calculateDeviationScore(absZScore: number): number {
    // Map z-score to 0-1 range using sigmoid-like function
    // z-score of 2 -> ~0.5, z-score of 4 -> ~0.9
    return this.clamp(1 - 1 / (1 + absZScore / 2), 0, 1);
  }

  /**
   * Determine the outlier type based on match characteristics.
   */
  private determineOutlierType(match: PatternMatchResult, zScore: number): OutlierType {
    // If confidence is very low, it's likely inconsistent
    if (match.confidence < 0.3) {
      return 'inconsistent';
    }

    // If z-score is negative (below mean), might be missing elements
    if (zScore < -2) {
      return 'missing';
    }

    // If z-score is very positive (above mean), might have extra elements
    if (zScore > 2) {
      return 'extra';
    }

    // Default to structural deviation
    switch (match.matchType) {
      case 'ast':
        return 'syntactic';
      case 'structural':
        return 'structural';
      case 'regex':
        return 'stylistic';
      default:
        return 'inconsistent';
    }
  }

  /**
   * Create an OutlierInfo object from match data.
   */
  private createOutlierInfo(
    match: PatternMatchResult,
    patternId: string,
    reason: string,
    deviationScore: number,
    deviationType: OutlierType,
    significance: OutlierSignificance,
    statistics?: OutlierStatistics
  ): OutlierInfo {
    const outlier: OutlierInfo = {
      location: match.location,
      patternId,
      reason,
      deviationScore,
      deviationType,
      significance,
    };

    if (match.matchedText) {
      outlier.actual = match.matchedText;
    }

    if (this.config.includeContext && statistics) {
      outlier.context = {
        statistics,
      };
    }

    return outlier;
  }

  /**
   * Clamp a value to a range.
   */
  private clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }

  /**
   * Register default outlier detection rules.
   */
  private registerDefaultRules(): void {
    // Rule: Low confidence match
    this.registerRule({
      id: 'low-confidence',
      name: 'Low Confidence Match',
      type: 'inconsistent',
      check: (match) => match.confidence < 0.3,
      getReason: (match) =>
        `Match has very low confidence (${(match.confidence * 100).toFixed(1)}%)`,
      getSuggestedFix: () => 'Review and update the code to match the established pattern',
    });

    // Rule: Already marked as outlier
    this.registerRule({
      id: 'marked-outlier',
      name: 'Pre-marked Outlier',
      type: 'inconsistent',
      check: (match) => match.isOutlier === true,
      getReason: (match) => match.outlierReason ?? 'Match was pre-marked as an outlier',
    });

    // Rule: Missing similarity score
    this.registerRule({
      id: 'low-similarity',
      name: 'Low Similarity',
      type: 'structural',
      check: (match) => match.similarity !== undefined && match.similarity < 0.5,
      getReason: (match) =>
        `Match has low similarity to canonical pattern (${((match.similarity ?? 0) * 100).toFixed(1)}%)`,
      getSuggestedFix: () => 'Refactor code to more closely match the established pattern',
    });
  }
}

/**
 * Detect outliers using default configuration.
 * Convenience function for quick outlier detection.
 *
 * @param matches - Pattern matches to analyze
 * @param patternId - Pattern ID
 * @returns Outlier detection result
 */
export function detectOutliers(
  matches: PatternMatchResult[],
  patternId: string
): OutlierDetectionResult {
  const detector = new OutlierDetector();
  return detector.detect(matches, patternId);
}

/**
 * Calculate statistics for a set of values.
 * Utility function for external use.
 *
 * @param values - Array of numeric values
 * @returns Statistics object with mean, stddev, and quartiles
 */
export function calculateStatistics(values: number[]): {
  mean: number;
  standardDeviation: number;
  q1: number;
  median: number;
  q3: number;
  iqr: number;
} {
  if (values.length === 0) {
    return {
      mean: 0,
      standardDeviation: 0,
      q1: 0,
      median: 0,
      q3: 0,
      iqr: 0,
    };
  }

  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;

  const squaredDiffs = values.map((v) => Math.pow(v - mean, 2));
  const variance = squaredDiffs.reduce((sum, v) => sum + v, 0) / values.length;
  const standardDeviation = Math.sqrt(variance);

  const sortedValues = [...values].sort((a, b) => a - b);

  const calculateQuartile = (q: number): number => {
    const index = q * (sortedValues.length - 1);
    const lower = Math.floor(index);
    const upper = Math.ceil(index);

    if (lower === upper) {
      return sortedValues[lower] ?? 0;
    }

    const lowerValue = sortedValues[lower] ?? 0;
    const upperValue = sortedValues[upper] ?? 0;
    const fraction = index - lower;

    return lowerValue + fraction * (upperValue - lowerValue);
  };

  const q1 = calculateQuartile(0.25);
  const median = calculateQuartile(0.5);
  const q3 = calculateQuartile(0.75);
  const iqr = q3 - q1;

  return {
    mean,
    standardDeviation,
    q1,
    median,
    q3,
    iqr,
  };
}
