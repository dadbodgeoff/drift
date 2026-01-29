/**
 * Regression Detection Gate
 * 
 * @license Apache-2.0
 * 
 * Detects pattern regressions by comparing current state against a baseline.
 * Catches when changes cause patterns to degrade (lower confidence, more outliers).
 * 
 * FUTURE_GATE: gate:regression-detection (Team tier)
 */

import { BaseGate } from '../base-gate.js';

import type {
  GateId,
  GateInput,
  GateResult,
  GateConfig,
  RegressionDetectionConfig,
  RegressionDetectionDetails,
  GateViolation,
  PatternRegression,
  PatternImprovement,
  Pattern,
  HealthSnapshot,
} from '../../types.js';

/**
 * Regression Detection Gate
 * 
 * Compares current pattern health against a baseline to detect regressions.
 */
export class RegressionDetectionGate extends BaseGate {
  readonly id: GateId = 'regression-detection';
  readonly name = 'Regression Detection';
  readonly description = 'Detects pattern regressions from baseline';

  protected async executeGate(input: GateInput): Promise<GateResult> {
    const config = input.config as RegressionDetectionConfig;
    const patterns = input.context.patterns ?? [];
    const previousSnapshot = input.context.previousSnapshot;
    
    if (!previousSnapshot) {
      return this.createPassedResult(
        'No baseline snapshot available for comparison',
        {
          regressions: [],
          improvements: [],
          overallHealthDelta: 0,
          categoryDeltas: {},
          baseline: {
            type: config.baseline,
            reference: 'none',
            timestamp: new Date().toISOString(),
          },
        } as unknown as Record<string, unknown>,
        ['No baseline snapshot found. Run `drift gate` on main branch first to establish baseline.']
      );
    }

    // Compare current patterns against baseline
    const comparison = this.comparePatterns(patterns, previousSnapshot, config);

    // Build violations from regressions
    const violations = this.buildViolations(comparison.regressions, config);

    // Determine pass/fail based on thresholds
    const passed = this.evaluateThresholds(comparison, config);
    const score = this.calculateScore(comparison);
    const status = passed ? (comparison.regressions.length > 0 ? 'warned' : 'passed') : 'failed';

    const details: RegressionDetectionDetails = {
      regressions: comparison.regressions,
      improvements: comparison.improvements,
      overallHealthDelta: comparison.overallHealthDelta,
      categoryDeltas: comparison.categoryDeltas,
      baseline: {
        type: config.baseline,
        reference: previousSnapshot.commitSha || previousSnapshot.branch,
        timestamp: previousSnapshot.timestamp,
      },
    };

    const summary = this.buildSummary(comparison, passed);
    const warnings = this.buildWarnings(comparison);

    if (!passed) {
      return this.createFailedResult(summary, violations, details as unknown as Record<string, unknown>, score, warnings);
    }

    if (comparison.regressions.length > 0) {
      return this.createWarnedResult(summary, violations, details as unknown as Record<string, unknown>, score, warnings);
    }

    return {
      gateId: this.id,
      gateName: this.name,
      status,
      passed,
      score,
      summary,
      violations,
      warnings,
      executionTimeMs: 0,
      details: details as unknown as Record<string, unknown>,
    };
  }

  validateConfig(config: GateConfig): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    const c = config as RegressionDetectionConfig;

    if (c.maxConfidenceDrop < 0 || c.maxConfidenceDrop > 100) {
      errors.push('maxConfidenceDrop must be between 0 and 100');
    }
    if (c.maxComplianceDrop < 0 || c.maxComplianceDrop > 100) {
      errors.push('maxComplianceDrop must be between 0 and 100');
    }
    if (c.maxNewOutliersPerPattern < 0) {
      errors.push('maxNewOutliersPerPattern must be non-negative');
    }

    return { valid: errors.length === 0, errors };
  }

  getDefaultConfig(): RegressionDetectionConfig {
    return {
      enabled: true,
      blocking: true,
      maxConfidenceDrop: 10, // 10 percentage points
      maxComplianceDrop: 10, // 10 percentage points
      maxNewOutliersPerPattern: 3,
      criticalCategories: ['security', 'auth'],
      baseline: 'branch-base',
    };
  }

  /**
   * Compare current patterns against baseline snapshot.
   */
  private comparePatterns(
    currentPatterns: Pattern[],
    baseline: HealthSnapshot,
    config: RegressionDetectionConfig
  ): {
    regressions: PatternRegression[];
    improvements: PatternImprovement[];
    overallHealthDelta: number;
    categoryDeltas: Record<string, number>;
  } {
    const regressions: PatternRegression[] = [];
    const improvements: PatternImprovement[] = [];
    const categoryDeltas: Record<string, number> = {};

    // Build map of baseline patterns
    const baselineMap = new Map<string, {
      confidence: number;
      compliance: number;
      outliers: number;
      category: string;
    }>();

    for (const bp of baseline.patterns) {
      const compliance = bp.locations > 0 
        ? (bp.locations / (bp.locations + bp.outliers)) * 100 
        : 100;
      baselineMap.set(bp.patternId, {
        confidence: bp.confidence,
        compliance,
        outliers: bp.outliers,
        category: bp.category,
      });
    }

    // Compare each current pattern
    for (const pattern of currentPatterns) {
      const baselinePattern = baselineMap.get(pattern.id);
      if (!baselinePattern) {continue;} // New pattern, not a regression

      const currentOutliers = pattern.outliers?.length ?? 0;
      const currentLocations = pattern.locations?.length ?? 0;
      const currentCompliance = currentLocations > 0
        ? (currentLocations / (currentLocations + currentOutliers)) * 100
        : 100;

      const confidenceDelta = (pattern.confidence * 100) - (baselinePattern.confidence * 100);
      const complianceDelta = currentCompliance - baselinePattern.compliance;
      const newOutliers = currentOutliers - baselinePattern.outliers;

      // Track category deltas
      if (!categoryDeltas[pattern.category]) {
        categoryDeltas[pattern.category] = 0;
      }

      // Check for regression
      if (confidenceDelta < -config.maxConfidenceDrop || 
          complianceDelta < -config.maxComplianceDrop ||
          newOutliers > config.maxNewOutliersPerPattern) {
        
        const severity = this.classifyRegressionSeverity(
          confidenceDelta,
          complianceDelta,
          newOutliers,
          config
        );

        regressions.push({
          patternId: pattern.id,
          patternName: pattern.name,
          previousConfidence: baselinePattern.confidence * 100,
          currentConfidence: pattern.confidence * 100,
          confidenceDelta,
          previousCompliance: baselinePattern.compliance,
          currentCompliance,
          complianceDelta,
          newOutliers: Math.max(0, newOutliers),
          severity,
        });

        categoryDeltas[pattern.category]! += complianceDelta;
      }
      // Check for improvement
      else if (confidenceDelta > 5 || complianceDelta > 5 || newOutliers < 0) {
        improvements.push({
          patternId: pattern.id,
          patternName: pattern.name,
          confidenceImprovement: Math.max(0, confidenceDelta),
          complianceImprovement: Math.max(0, complianceDelta),
          outliersFixed: Math.max(0, -newOutliers),
        });

        categoryDeltas[pattern.category]! += complianceDelta;
      }
    }

    // Calculate overall health delta
    const overallHealthDelta = this.calculateOverallDelta(categoryDeltas);

    return { regressions, improvements, overallHealthDelta, categoryDeltas };
  }

  /**
   * Classify regression severity.
   */
  private classifyRegressionSeverity(
    confidenceDelta: number,
    complianceDelta: number,
    newOutliers: number,
    config: RegressionDetectionConfig
  ): 'minor' | 'moderate' | 'severe' {
    // Severe: More than 2x the threshold
    if (confidenceDelta < -config.maxConfidenceDrop * 2 ||
        complianceDelta < -config.maxComplianceDrop * 2 ||
        newOutliers > config.maxNewOutliersPerPattern * 2) {
      return 'severe';
    }

    // Moderate: Exceeds threshold
    if (confidenceDelta < -config.maxConfidenceDrop ||
        complianceDelta < -config.maxComplianceDrop ||
        newOutliers > config.maxNewOutliersPerPattern) {
      return 'moderate';
    }

    return 'minor';
  }

  /**
   * Calculate overall health delta.
   */
  private calculateOverallDelta(categoryDeltas: Record<string, number>): number {
    const values = Object.values(categoryDeltas);
    if (values.length === 0) {return 0;}
    return values.reduce((sum, v) => sum + v, 0) / values.length;
  }

  /**
   * Evaluate whether the gate passes based on thresholds.
   */
  private evaluateThresholds(
    comparison: {
      regressions: PatternRegression[];
      improvements: PatternImprovement[];
      categoryDeltas: Record<string, number>;
    },
    config: RegressionDetectionConfig
  ): boolean {
    // Check for severe regressions
    const severeRegressions = comparison.regressions.filter(r => r.severity === 'severe');
    if (severeRegressions.length > 0) {return false;}

    // Check for regressions in critical categories
    for (const regression of comparison.regressions) {
      // Find the pattern's category from the regression
      const category = this.getCategoryFromRegression(regression);
      if (config.criticalCategories.includes(category)) {
        return false;
      }
    }

    // Check if moderate regressions exceed threshold
    const moderateRegressions = comparison.regressions.filter(r => r.severity === 'moderate');
    if (moderateRegressions.length > 3) {return false;}

    return true;
  }

  /**
   * Get category from regression (simplified - in full impl would track this).
   */
  private getCategoryFromRegression(_regression: PatternRegression): string {
    // In full implementation, we'd track the category with the regression
    return 'unknown';
  }

  /**
   * Build violations from regressions.
   */
  private buildViolations(
    regressions: PatternRegression[],
    config: RegressionDetectionConfig
  ): GateViolation[] {
    return regressions
      .filter(r => r.severity !== 'minor')
      .map(r => this.createViolation({
        severity: r.severity === 'severe' ? 'error' : 'warning',
        file: 'project',
        line: 1,
        column: 1,
        message: `Pattern "${r.patternName}" regressed`,
        explanation: this.formatRegressionExplanation(r, config),
        ruleId: r.patternId,
        suggestedFix: `Review changes that affected pattern "${r.patternName}" and ensure they follow the established pattern`,
      }));
  }

  /**
   * Format regression explanation.
   */
  private formatRegressionExplanation(
    regression: PatternRegression,
    config: RegressionDetectionConfig
  ): string {
    const parts: string[] = [];

    if (regression.confidenceDelta < -config.maxConfidenceDrop) {
      parts.push(`Confidence dropped ${Math.abs(regression.confidenceDelta).toFixed(1)}pp (${regression.previousConfidence.toFixed(1)}% → ${regression.currentConfidence.toFixed(1)}%)`);
    }

    if (regression.complianceDelta < -config.maxComplianceDrop) {
      parts.push(`Compliance dropped ${Math.abs(regression.complianceDelta).toFixed(1)}pp (${regression.previousCompliance.toFixed(1)}% → ${regression.currentCompliance.toFixed(1)}%)`);
    }

    if (regression.newOutliers > config.maxNewOutliersPerPattern) {
      parts.push(`${regression.newOutliers} new outlier${regression.newOutliers === 1 ? '' : 's'} introduced`);
    }

    return parts.join('. ');
  }

  /**
   * Calculate score based on comparison.
   */
  private calculateScore(comparison: {
    regressions: PatternRegression[];
    improvements: PatternImprovement[];
    overallHealthDelta: number;
  }): number {
    // Start at 100
    let score = 100;

    // Deduct for regressions
    for (const r of comparison.regressions) {
      switch (r.severity) {
        case 'severe': score -= 20; break;
        case 'moderate': score -= 10; break;
        case 'minor': score -= 3; break;
      }
    }

    // Small bonus for improvements (max 10 points)
    const improvementBonus = Math.min(10, comparison.improvements.length * 2);
    score += improvementBonus;

    return Math.max(0, Math.min(100, Math.round(score)));
  }

  /**
   * Build human-readable summary.
   */
  private buildSummary(
    comparison: {
      regressions: PatternRegression[];
      improvements: PatternImprovement[];
      overallHealthDelta: number;
    },
    passed: boolean
  ): string {
    if (comparison.regressions.length === 0 && comparison.improvements.length === 0) {
      return 'No pattern changes detected';
    }

    const parts: string[] = [];

    if (comparison.regressions.length > 0) {
      const severe = comparison.regressions.filter(r => r.severity === 'severe').length;
      const moderate = comparison.regressions.filter(r => r.severity === 'moderate').length;
      
      if (severe > 0) {
        parts.push(`${severe} severe regression${severe === 1 ? '' : 's'}`);
      }
      if (moderate > 0) {
        parts.push(`${moderate} moderate regression${moderate === 1 ? '' : 's'}`);
      }
    }

    if (comparison.improvements.length > 0) {
      parts.push(`${comparison.improvements.length} improvement${comparison.improvements.length === 1 ? '' : 's'}`);
    }

    const prefix = passed ? 'Pattern health:' : 'Pattern regressions detected:';
    return `${prefix} ${parts.join(', ')}`;
  }

  /**
   * Build warnings for the result.
   */
  private buildWarnings(comparison: {
    regressions: PatternRegression[];
    improvements: PatternImprovement[];
    overallHealthDelta: number;
  }): string[] {
    const warnings: string[] = [];

    // Warn about minor regressions
    const minorRegressions = comparison.regressions.filter(r => r.severity === 'minor');
    if (minorRegressions.length > 0) {
      warnings.push(`${minorRegressions.length} minor regression${minorRegressions.length === 1 ? '' : 's'} detected (within threshold)`);
    }

    // Warn about overall health trend
    if (comparison.overallHealthDelta < -5) {
      warnings.push(`Overall pattern health trending down (${comparison.overallHealthDelta.toFixed(1)}pp)`);
    }

    return warnings;
  }
}
