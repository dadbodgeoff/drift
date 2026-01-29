/**
 * Confidence Scorer - Pattern confidence calculation
 *
 * Calculates confidence scores based on frequency, consistency,
 * age, and spread. Classifies patterns into confidence levels.
 *
 * The confidence score is a weighted combination of four factors:
 * - Frequency: How often the pattern appears relative to applicable locations
 * - Consistency: How consistent the pattern implementation is across occurrences
 * - Age: How long the pattern has been observed (normalized)
 * - Spread: How many files contain the pattern relative to total files
 *
 * @requirements 5.1 - Pattern confidence scoring with frequency, consistency, age, spread factors
 * @requirements 5.2 - Confidence score SHALL be a decimal value between 0.0 and 1.0
 * @requirements 5.3 - High confidence: score >= 0.85
 * @requirements 5.4 - Medium confidence: score >= 0.70 and < 0.85
 * @requirements 5.5 - Low confidence: score >= 0.50 and < 0.70
 * @requirements 5.6 - Uncertain: score < 0.50
 */

import {
  CONFIDENCE_THRESHOLDS,
  DEFAULT_CONFIDENCE_WEIGHTS,
} from './types.js';

import type {
  ConfidenceScore,
  ConfidenceLevel,
  ConfidenceWeights,
  ConfidenceInput,
} from './types.js';


/**
 * Configuration for age normalization
 */
export interface AgeNormalizationConfig {
  /**
   * Number of days at which age factor reaches maximum (1.0)
   * Default: 30 days
   */
  maxAgeDays: number;

  /**
   * Minimum age factor for newly observed patterns
   * Default: 0.1
   */
  minAgeFactor: number;
}

/**
 * Default age normalization configuration
 */
export const DEFAULT_AGE_CONFIG: AgeNormalizationConfig = {
  maxAgeDays: 30,
  minAgeFactor: 0.1,
};

/**
 * ConfidenceScorer class for calculating pattern confidence scores.
 *
 * Calculates a weighted confidence score from four factors:
 * - Frequency: occurrences / totalLocations
 * - Consistency: 1 - variance (inverted so higher is better)
 * - Age: normalized based on days since first seen
 * - Spread: fileCount / totalFiles
 *
 * The final score is classified into confidence levels:
 * - High: score >= 0.85
 * - Medium: score >= 0.70 and < 0.85
 * - Low: score >= 0.50 and < 0.70
 * - Uncertain: score < 0.50
 *
 * @requirements 5.1, 5.2, 5.3, 5.4, 5.5, 5.6
 */
export class ConfidenceScorer {
  private weights: ConfidenceWeights;
  private ageConfig: AgeNormalizationConfig;

  /**
   * Create a new ConfidenceScorer instance.
   *
   * @param weights - Optional custom weights for score calculation
   * @param ageConfig - Optional custom age normalization configuration
   */
  constructor(
    weights?: Partial<ConfidenceWeights>,
    ageConfig?: Partial<AgeNormalizationConfig>
  ) {
    this.weights = {
      ...DEFAULT_CONFIDENCE_WEIGHTS,
      ...weights,
    };
    this.ageConfig = {
      ...DEFAULT_AGE_CONFIG,
      ...ageConfig,
    };

    // Validate weights sum to 1.0 (with small tolerance for floating point)
    this.validateWeights();
  }

  /**
   * Calculate the confidence score for a pattern.
   *
   * @param input - The input data for confidence calculation
   * @returns The calculated confidence score with all factors
   *
   * @requirements 5.1 - Pattern confidence scoring with frequency, consistency, age, spread factors
   * @requirements 5.2 - Confidence score SHALL be a decimal value between 0.0 and 1.0
   */
  calculateScore(input: ConfidenceInput): ConfidenceScore {
    // Calculate individual factors
    const frequency = this.calculateFrequency(input.occurrences, input.totalLocations);
    const consistency = this.calculateConsistency(input.variance);
    const ageFactor = this.calculateAgeFactor(input.daysSinceFirstSeen);
    const spread = this.calculateSpread(input.fileCount, input.totalFiles);

    // Calculate weighted score
    const weightedScore =
      frequency * this.weights.frequency +
      consistency * this.weights.consistency +
      ageFactor * this.weights.age +
      spread * this.weights.spread;

    // Clamp score to [0.0, 1.0] range
    const score = this.clamp(weightedScore, 0.0, 1.0);

    // Classify into confidence level
    const level = this.classifyLevel(score);

    return {
      frequency,
      consistency,
      age: input.daysSinceFirstSeen,
      spread: input.fileCount,
      score,
      level,
    };
  }

  /**
   * Calculate the frequency factor.
   *
   * Frequency = occurrences / totalLocations
   * Represents how often the pattern appears relative to applicable locations.
   *
   * @param occurrences - Number of pattern occurrences
   * @param totalLocations - Total applicable locations
   * @returns Frequency factor (0.0 to 1.0)
   *
   * @requirements 5.1 - Frequency factor in confidence scoring
   */
  calculateFrequency(occurrences: number, totalLocations: number): number {
    // Handle edge cases
    if (totalLocations <= 0) {
      return 0.0;
    }
    if (occurrences <= 0) {
      return 0.0;
    }

    // Calculate frequency ratio
    const frequency = occurrences / totalLocations;

    // Clamp to [0.0, 1.0] range
    return this.clamp(frequency, 0.0, 1.0);
  }

  /**
   * Calculate the consistency factor.
   *
   * Consistency = 1 - variance
   * Higher consistency means less variance in pattern implementation.
   * Variance should be normalized to [0.0, 1.0] range.
   *
   * @param variance - Variance in pattern implementation (0 = perfectly consistent)
   * @returns Consistency factor (0.0 to 1.0)
   *
   * @requirements 5.1 - Consistency factor in confidence scoring
   */
  calculateConsistency(variance: number): number {
    // Handle edge cases
    if (variance < 0) {
      // Negative variance is invalid, treat as 0
      return 1.0;
    }

    // Clamp variance to [0.0, 1.0] range
    const clampedVariance = this.clamp(variance, 0.0, 1.0);

    // Consistency is inverse of variance
    return 1.0 - clampedVariance;
  }

  /**
   * Calculate the age factor.
   *
   * Age factor is normalized based on days since first observation.
   * Older patterns get higher scores (more established).
   * Uses logarithmic scaling for diminishing returns after maxAgeDays.
   *
   * @param daysSinceFirstSeen - Days since pattern was first observed
   * @returns Age factor (0.0 to 1.0)
   *
   * @requirements 5.1 - Age factor in confidence scoring
   */
  calculateAgeFactor(daysSinceFirstSeen: number): number {
    // Handle edge cases
    if (daysSinceFirstSeen <= 0) {
      return this.ageConfig.minAgeFactor;
    }

    // Linear scaling up to maxAgeDays
    if (daysSinceFirstSeen >= this.ageConfig.maxAgeDays) {
      return 1.0;
    }

    // Calculate normalized age factor
    const normalizedAge = daysSinceFirstSeen / this.ageConfig.maxAgeDays;

    // Scale between minAgeFactor and 1.0
    const ageFactor =
      this.ageConfig.minAgeFactor +
      normalizedAge * (1.0 - this.ageConfig.minAgeFactor);

    return this.clamp(ageFactor, 0.0, 1.0);
  }

  /**
   * Calculate the spread factor.
   *
   * Spread = fileCount / totalFiles
   * Represents how widely the pattern is used across the codebase.
   *
   * @param fileCount - Number of files containing the pattern
   * @param totalFiles - Total files in scope
   * @returns Spread factor (0.0 to 1.0)
   *
   * @requirements 5.1 - Spread factor in confidence scoring
   */
  calculateSpread(fileCount: number, totalFiles: number): number {
    // Handle edge cases
    if (totalFiles <= 0) {
      return 0.0;
    }
    if (fileCount <= 0) {
      return 0.0;
    }

    // Calculate spread ratio
    const spread = fileCount / totalFiles;

    // Clamp to [0.0, 1.0] range
    return this.clamp(spread, 0.0, 1.0);
  }

  /**
   * Classify a score into a confidence level.
   *
   * @param score - The confidence score (0.0 to 1.0)
   * @returns The confidence level classification
   *
   * @requirements 5.3 - High confidence: score >= 0.85
   * @requirements 5.4 - Medium confidence: score >= 0.70 and < 0.85
   * @requirements 5.5 - Low confidence: score >= 0.50 and < 0.70
   * @requirements 5.6 - Uncertain: score < 0.50
   */
  classifyLevel(score: number): ConfidenceLevel {
    if (score >= CONFIDENCE_THRESHOLDS.HIGH) {
      return 'high';
    }
    if (score >= CONFIDENCE_THRESHOLDS.MEDIUM) {
      return 'medium';
    }
    if (score >= CONFIDENCE_THRESHOLDS.LOW) {
      return 'low';
    }
    return 'uncertain';
  }

  /**
   * Get the current weights configuration.
   *
   * @returns The current confidence weights
   */
  getWeights(): ConfidenceWeights {
    return { ...this.weights };
  }

  /**
   * Get the current age normalization configuration.
   *
   * @returns The current age configuration
   */
  getAgeConfig(): AgeNormalizationConfig {
    return { ...this.ageConfig };
  }

  /**
   * Validate that weights sum to approximately 1.0.
   * Throws an error if weights are invalid.
   */
  private validateWeights(): void {
    const sum =
      this.weights.frequency +
      this.weights.consistency +
      this.weights.age +
      this.weights.spread;

    // Allow small tolerance for floating point errors
    const tolerance = 0.001;
    if (Math.abs(sum - 1.0) > tolerance) {
      throw new Error(
        `Confidence weights must sum to 1.0, but got ${sum.toFixed(4)}. ` +
          `Weights: frequency=${this.weights.frequency}, consistency=${this.weights.consistency}, ` +
          `age=${this.weights.age}, spread=${this.weights.spread}`
      );
    }
  }

  /**
   * Clamp a value to a range.
   *
   * @param value - The value to clamp
   * @param min - Minimum value
   * @param max - Maximum value
   * @returns The clamped value
   */
  private clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }
}

/**
 * Create a confidence score from raw values.
 * Utility function for creating ConfidenceScore objects directly.
 *
 * @param frequency - Frequency factor (0.0 to 1.0)
 * @param consistency - Consistency factor (0.0 to 1.0)
 * @param age - Age in days
 * @param spread - Number of files
 * @param score - Overall score (0.0 to 1.0)
 * @returns A ConfidenceScore object
 */
export function createConfidenceScore(
  frequency: number,
  consistency: number,
  age: number,
  spread: number,
  score: number
): ConfidenceScore {
  const scorer = new ConfidenceScorer();
  const level = scorer.classifyLevel(score);

  return {
    frequency,
    consistency,
    age,
    spread,
    score,
    level,
  };
}

/**
 * Calculate confidence score using default weights.
 * Convenience function for quick calculations.
 *
 * @param input - The input data for confidence calculation
 * @returns The calculated confidence score
 */
export function calculateConfidence(input: ConfidenceInput): ConfidenceScore {
  const scorer = new ConfidenceScorer();
  return scorer.calculateScore(input);
}
