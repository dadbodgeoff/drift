/**
 * Friction Scorer
 *
 * Calculates friction metrics for an approach:
 * - Code churn (how much code needs to change)
 * - Pattern deviation (how far from established patterns)
 * - Testing effort (how much testing is needed)
 * - Refactoring required (structural changes needed)
 * - Learning curve (complexity for developers)
 *
 * @module simulation/scorers/friction-scorer
 */

import type { CallGraph } from '../../call-graph/types.js';
import type { IPatternService } from '../../patterns/service.js';
import type {
  SimulationApproach,
  FrictionMetrics,
  FrictionBreakdown,
} from '../types.js';

// ============================================================================
// Types
// ============================================================================

export interface FrictionScorerConfig {
  projectRoot: string;
  callGraph?: CallGraph | undefined;
  patternService?: IPatternService | undefined;
}

// ============================================================================
// Friction Scorer
// ============================================================================

/**
 * Scores the friction of implementing an approach
 */
export class FrictionScorer {
  // Config stored for potential future use
  constructor(_config: FrictionScorerConfig) {
    // Config available for future extensions
  }

  /**
   * Calculate friction metrics for an approach
   */
  async score(approach: SimulationApproach): Promise<FrictionMetrics> {
    const breakdown: FrictionBreakdown[] = [];

    // 1. Code Churn (0-100)
    const codeChurn = this.calculateCodeChurn(approach);
    breakdown.push({
      metric: 'codeChurn',
      value: codeChurn,
      weight: 0.25,
      contribution: codeChurn * 0.25,
      reason: this.getCodeChurnReason(approach),
    });

    // 2. Pattern Deviation (0-100)
    const patternDeviation = await this.calculatePatternDeviation(approach);
    breakdown.push({
      metric: 'patternDeviation',
      value: patternDeviation,
      weight: 0.25,
      contribution: patternDeviation * 0.25,
      reason: this.getPatternDeviationReason(approach, patternDeviation),
    });

    // 3. Testing Effort (0-100)
    const testingEffort = this.calculateTestingEffort(approach);
    breakdown.push({
      metric: 'testingEffort',
      value: testingEffort,
      weight: 0.20,
      contribution: testingEffort * 0.20,
      reason: this.getTestingEffortReason(approach),
    });

    // 4. Refactoring Required (0-100)
    const refactoringRequired = this.calculateRefactoringRequired(approach);
    breakdown.push({
      metric: 'refactoringRequired',
      value: refactoringRequired,
      weight: 0.15,
      contribution: refactoringRequired * 0.15,
      reason: this.getRefactoringReason(approach),
    });

    // 5. Learning Curve (0-100)
    const learningCurve = this.calculateLearningCurve(approach);
    breakdown.push({
      metric: 'learningCurve',
      value: learningCurve,
      weight: 0.15,
      contribution: learningCurve * 0.15,
      reason: this.getLearningCurveReason(approach),
    });

    // Calculate overall friction (weighted average)
    const overall = breakdown.reduce((sum, b) => sum + b.contribution, 0);

    return {
      codeChurn,
      patternDeviation,
      testingEffort,
      refactoringRequired,
      learningCurve,
      overall,
      breakdown,
    };
  }

  // ==========================================================================
  // Code Churn
  // ==========================================================================

  private calculateCodeChurn(approach: SimulationApproach): number {
    const linesAdded = approach.estimatedLinesAdded ?? 0;
    const linesModified = approach.estimatedLinesModified ?? 0;
    const filesAffected = approach.targetFiles.length;
    const newFiles = approach.newFiles?.length ?? 0;

    // Score based on total changes
    // Low: < 50 lines, < 3 files
    // Medium: 50-200 lines, 3-10 files
    // High: > 200 lines, > 10 files

    let score = 0;

    // Lines score (0-50)
    const totalLines = linesAdded + linesModified;
    if (totalLines < 50) {
      score += (totalLines / 50) * 25;
    } else if (totalLines < 200) {
      score += 25 + ((totalLines - 50) / 150) * 25;
    } else {
      score += 50 + Math.min(50, (totalLines - 200) / 200 * 50);
    }

    // Files score (0-50)
    const totalFiles = filesAffected + newFiles;
    if (totalFiles < 3) {
      score += (totalFiles / 3) * 25;
    } else if (totalFiles < 10) {
      score += 25 + ((totalFiles - 3) / 7) * 25;
    } else {
      score += 50 + Math.min(50, (totalFiles - 10) / 10 * 50);
    }

    return Math.min(100, Math.round(score));
  }

  private getCodeChurnReason(approach: SimulationApproach): string {
    const linesAdded = approach.estimatedLinesAdded ?? 0;
    const linesModified = approach.estimatedLinesModified ?? 0;
    const totalFiles = approach.targetFiles.length + (approach.newFiles?.length ?? 0);

    if (linesAdded + linesModified < 50 && totalFiles < 3) {
      return 'Minimal code changes required';
    } else if (linesAdded + linesModified < 200 && totalFiles < 10) {
      return 'Moderate code changes across several files';
    } else {
      return 'Significant code changes across many files';
    }
  }

  // ==========================================================================
  // Pattern Deviation
  // ==========================================================================

  private async calculatePatternDeviation(approach: SimulationApproach): Promise<number> {
    // If approach follows patterns, lower deviation
    const followsPatterns = approach.followsPatterns?.length ?? 0;

    if (followsPatterns >= 3) {
      return 10; // Very aligned with patterns
    } else if (followsPatterns >= 1) {
      return 30; // Somewhat aligned
    }

    // Check if strategy is common for the language
    const commonStrategies: Record<string, string[]> = {
      typescript: ['middleware', 'decorator', 'wrapper', 'guard'],
      javascript: ['middleware', 'wrapper'],
      python: ['decorator', 'middleware', 'mixin'],
      java: ['aspect', 'interceptor', 'filter', 'guard'],
      csharp: ['filter', 'middleware', 'attribute'],
      php: ['middleware', 'policy', 'guard'],
    };

    const langStrategies = commonStrategies[approach.language] ?? [];
    if (langStrategies.includes(approach.strategy)) {
      return 40; // Common strategy but no pattern match
    }

    return 70; // Uncommon approach
  }

  private getPatternDeviationReason(approach: SimulationApproach, score: number): string {
    if (score <= 20) {
      return `Follows ${approach.followsPatterns?.length ?? 0} established patterns`;
    } else if (score <= 40) {
      return 'Partially aligned with existing patterns';
    } else if (score <= 60) {
      return 'Uses common strategy but no direct pattern match';
    } else {
      return 'May introduce new patterns to the codebase';
    }
  }

  // ==========================================================================
  // Testing Effort
  // ==========================================================================

  private calculateTestingEffort(approach: SimulationApproach): number {
    // Base testing effort on strategy complexity
    const strategyTestingEffort: Record<string, number> = {
      middleware: 40, // Easy to test in isolation
      decorator: 35, // Easy to test
      wrapper: 45, // Moderate
      'per-route': 60, // Need to test each route
      'per-function': 70, // Need to test each function
      centralized: 30, // Single point to test
      distributed: 75, // Many points to test
      aspect: 50, // Moderate
      filter: 40, // Easy to test
      interceptor: 45, // Moderate
      guard: 35, // Easy to test
      policy: 40, // Easy to test
      dependency: 35, // Easy with DI
      mixin: 50, // Moderate
      custom: 65, // Unknown complexity
    };

    let score = strategyTestingEffort[approach.strategy] ?? 50;

    // Adjust based on files affected
    const filesAffected = approach.targetFiles.length;
    if (filesAffected > 10) {
      score += 15;
    } else if (filesAffected > 5) {
      score += 10;
    }

    // Adjust based on new files (need new tests)
    const newFiles = approach.newFiles?.length ?? 0;
    score += newFiles * 5;

    return Math.min(100, Math.round(score));
  }

  private getTestingEffortReason(approach: SimulationApproach): string {
    const score = this.calculateTestingEffort(approach);
    if (score <= 35) {
      return 'Easy to test in isolation';
    } else if (score <= 50) {
      return 'Moderate testing effort required';
    } else if (score <= 70) {
      return 'Significant testing effort across multiple components';
    } else {
      return 'Extensive testing required due to distributed changes';
    }
  }

  // ==========================================================================
  // Refactoring Required
  // ==========================================================================

  private calculateRefactoringRequired(approach: SimulationApproach): number {
    // Strategies that typically require more refactoring
    const refactoringIntensity: Record<string, number> = {
      middleware: 20, // Usually additive
      decorator: 15, // Usually additive
      wrapper: 30, // May need to wrap existing code
      'per-route': 50, // Need to modify each route
      'per-function': 60, // Need to modify each function
      centralized: 25, // May need to redirect calls
      distributed: 55, // Changes spread out
      aspect: 20, // Usually non-invasive
      filter: 25, // Usually additive
      interceptor: 25, // Usually additive
      guard: 20, // Usually additive
      policy: 25, // Usually additive
      dependency: 35, // May need DI setup
      mixin: 40, // May need class changes
      custom: 50, // Unknown
    };

    let score = refactoringIntensity[approach.strategy] ?? 40;

    // Adjust based on modified lines
    const linesModified = approach.estimatedLinesModified ?? 0;
    if (linesModified > 100) {
      score += 20;
    } else if (linesModified > 50) {
      score += 10;
    }

    return Math.min(100, Math.round(score));
  }

  private getRefactoringReason(approach: SimulationApproach): string {
    const score = this.calculateRefactoringRequired(approach);
    if (score <= 25) {
      return 'Mostly additive changes, minimal refactoring';
    } else if (score <= 45) {
      return 'Some structural changes required';
    } else if (score <= 65) {
      return 'Moderate refactoring of existing code';
    } else {
      return 'Significant refactoring required';
    }
  }

  // ==========================================================================
  // Learning Curve
  // ==========================================================================

  private calculateLearningCurve(approach: SimulationApproach): number {
    // Base learning curve on strategy familiarity
    const strategyComplexity: Record<string, number> = {
      middleware: 25, // Well-known pattern
      decorator: 30, // Common but requires understanding
      wrapper: 25, // Simple concept
      'per-route': 20, // Straightforward
      'per-function': 20, // Straightforward
      centralized: 30, // Need to understand central point
      distributed: 45, // Need to understand all points
      aspect: 55, // AOP concepts
      filter: 25, // Well-known
      interceptor: 35, // Framework-specific
      guard: 30, // Framework-specific
      policy: 35, // Framework-specific
      dependency: 40, // DI concepts
      mixin: 45, // Multiple inheritance concepts
      custom: 50, // Unknown
    };

    let score = strategyComplexity[approach.strategy] ?? 40;

    // Adjust based on framework
    if (approach.framework) {
      // Framework-specific approaches may have steeper learning curve
      // if team is unfamiliar
      score += 10;
    }

    // Adjust based on new files (new concepts to learn)
    const newFiles = approach.newFiles?.length ?? 0;
    score += newFiles * 3;

    return Math.min(100, Math.round(score));
  }

  private getLearningCurveReason(approach: SimulationApproach): string {
    const score = this.calculateLearningCurve(approach);
    if (score <= 30) {
      return 'Uses familiar patterns, easy to understand';
    } else if (score <= 45) {
      return 'Moderate complexity, some learning required';
    } else if (score <= 60) {
      return 'Requires understanding of specific concepts';
    } else {
      return 'Steep learning curve, advanced concepts';
    }
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a friction scorer
 */
export function createFrictionScorer(config: FrictionScorerConfig): FrictionScorer {
  return new FrictionScorer(config);
}
