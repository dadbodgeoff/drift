/**
 * Pattern Compliance Gate
 * 
 * @license Apache-2.0
 * 
 * Checks whether changed files follow established patterns in the codebase.
 * This is Drift's unique value - no other tool checks architectural consistency.
 * 
 * "SonarQube tells you if your code is bad. Drift tells you if your code fits YOUR codebase."
 */

import { BaseGate } from '../base-gate.js';

import type {
  GateId,
  GateInput,
  GateResult,
  GateConfig,
  PatternComplianceConfig,
  PatternComplianceDetails,
  GateViolation,
  OutlierDetail,
  Pattern,
} from '../../types.js';

/**
 * Pattern Compliance Gate
 * 
 * Checks whether changed files follow established patterns in the codebase.
 */
export class PatternComplianceGate extends BaseGate {
  readonly id: GateId = 'pattern-compliance';
  readonly name = 'Pattern Compliance';
  readonly description = 'Checks if code follows established patterns';

  protected async executeGate(input: GateInput): Promise<GateResult> {
    const config = input.config as PatternComplianceConfig;
    const patterns = input.context.patterns ?? [];
    
    // Filter patterns by config
    const relevantPatterns = this.filterPatterns(patterns, config);
    
    if (relevantPatterns.length === 0) {
      return this.createPassedResult(
        'No patterns to check against',
        {
          complianceRate: 100,
          patternsChecked: 0,
          filesChecked: input.files.length,
          newOutliers: [],
          existingOutliers: 0,
          byCategory: {},
        } as unknown as Record<string, unknown>,
        ['No approved patterns found. Run `drift scan` and `drift approve` first.']
      );
    }

    // Calculate compliance for changed files
    const compliance = this.calculateCompliance(input.files, relevantPatterns);

    // Detect new outliers in changed files
    const newOutliers = this.detectNewOutliers(
      input.files,
      relevantPatterns,
      input.context.previousSnapshot
    );

    // Build violations from new outliers
    const violations = this.buildViolations(newOutliers);

    // Determine pass/fail based on thresholds
    const passed = this.evaluateThresholds(compliance, newOutliers, config);
    const score = this.calculateComplianceScore(compliance, newOutliers, config);
    const status = passed ? 'passed' : 'failed';

    const details: PatternComplianceDetails = {
      complianceRate: compliance.overallRate,
      patternsChecked: relevantPatterns.length,
      filesChecked: input.files.length,
      newOutliers,
      existingOutliers: compliance.existingOutliers,
      byCategory: compliance.byCategory,
    };

    const summary = this.buildSummary(compliance, newOutliers, passed);
    const warnings = this.buildWarnings(compliance, relevantPatterns);

    if (!passed) {
      return this.createFailedResult(summary, violations, details as unknown as Record<string, unknown>, score, warnings);
    }

    if (violations.length > 0) {
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
    const c = config as PatternComplianceConfig;

    if (c.minComplianceRate < 0 || c.minComplianceRate > 100) {
      errors.push('minComplianceRate must be between 0 and 100');
    }
    if (c.maxNewOutliers < 0) {
      errors.push('maxNewOutliers must be non-negative');
    }
    if (c.minPatternConfidence < 0 || c.minPatternConfidence > 1) {
      errors.push('minPatternConfidence must be between 0 and 1');
    }

    return { valid: errors.length === 0, errors };
  }

  getDefaultConfig(): PatternComplianceConfig {
    return {
      enabled: true,
      blocking: true,
      minComplianceRate: 80,
      maxNewOutliers: 0,
      categories: [], // Empty = all categories
      minPatternConfidence: 0.7,
      approvedOnly: true,
    };
  }

  /**
   * Filter patterns based on configuration.
   */
  private filterPatterns(patterns: Pattern[], config: PatternComplianceConfig): Pattern[] {
    return patterns.filter(p => {
      // Filter by approval status
      if (config.approvedOnly && p.status !== 'approved') {return false;}
      
      // Filter by confidence
      if (p.confidence < config.minPatternConfidence) {return false;}
      
      // Filter by category
      if (config.categories.length > 0 && !config.categories.includes(p.category)) {
        return false;
      }
      
      return true;
    });
  }

  /**
   * Calculate compliance metrics for changed files.
   */
  private calculateCompliance(
    files: string[],
    patterns: Pattern[]
  ): {
    overallRate: number;
    existingOutliers: number;
    byCategory: Record<string, { compliant: number; total: number }>;
    lowConfidencePatterns: number;
  } {
    const byCategory: Record<string, { compliant: number; total: number }> = {};
    let totalLocations = 0;
    let totalOutliers = 0;
    let lowConfidencePatterns = 0;

    for (const pattern of patterns) {
      const category = pattern.category;
      if (!byCategory[category]) {
        byCategory[category] = { compliant: 0, total: 0 };
      }

      // Count locations and outliers in changed files
      const locationsInFiles = (pattern.locations ?? []).filter(loc => 
        files.some(f => loc.file.endsWith(f) || f.endsWith(loc.file))
      );
      const outliersInFiles = (pattern.outliers ?? []).filter(out =>
        files.some(f => out.file.endsWith(f) || f.endsWith(out.file))
      );

      const patternLocations = locationsInFiles.length;
      const patternOutliers = outliersInFiles.length;
      const patternTotal = patternLocations + patternOutliers;

      if (patternTotal > 0) {
        byCategory[category].compliant += patternLocations;
        byCategory[category].total += patternTotal;
        totalLocations += patternLocations;
        totalOutliers += patternOutliers;
      }

      if (pattern.confidence < 0.8) {
        lowConfidencePatterns++;
      }
    }

    const total = totalLocations + totalOutliers;
    const overallRate = total > 0 ? (totalLocations / total) * 100 : 100;

    return {
      overallRate,
      existingOutliers: totalOutliers,
      byCategory,
      lowConfidencePatterns,
    };
  }

  /**
   * Detect new outliers that weren't in the previous snapshot.
   */
  private detectNewOutliers(
    files: string[],
    patterns: Pattern[],
    previousSnapshot?: { patterns?: Array<{ patternId: string; outliers: number }> }
  ): OutlierDetail[] {
    const newOutliers: OutlierDetail[] = [];
    const previousOutlierCounts = new Map<string, number>();

    // Build map of previous outlier counts
    if (previousSnapshot?.patterns) {
      for (const p of previousSnapshot.patterns) {
        previousOutlierCounts.set(p.patternId, p.outliers);
      }
    }

    for (const pattern of patterns) {
      const outliersInFiles = (pattern.outliers ?? []).filter(out =>
        files.some(f => out.file.endsWith(f) || f.endsWith(out.file))
      );

      // If no previous snapshot, all outliers in changed files are "new"
      // Otherwise, compare counts
      const previousCount = previousOutlierCounts.get(pattern.id) ?? 0;
      const currentCount = pattern.outliers?.length ?? 0;
      const isNewPattern = !previousOutlierCounts.has(pattern.id);

      for (const outlier of outliersInFiles) {
        newOutliers.push({
          patternId: pattern.id,
          patternName: pattern.name,
          file: outlier.file,
          line: outlier.line,
          reason: outlier.reason,
          isNew: isNewPattern || currentCount > previousCount,
        });
      }
    }

    return newOutliers;
  }

  /**
   * Build violations from outliers.
   */
  private buildViolations(
    outliers: OutlierDetail[]
  ): GateViolation[] {
    return outliers
      .filter(o => o.isNew) // Only new outliers are violations
      .map(o => this.createViolation({
        severity: 'error',
        file: o.file,
        line: o.line,
        column: 1,
        message: `Deviates from pattern: ${o.patternName}`,
        explanation: o.reason,
        ruleId: o.patternId,
        suggestedFix: `Follow the established ${o.patternName} pattern`,
      }));
  }

  /**
   * Evaluate whether the gate passes based on thresholds.
   */
  private evaluateThresholds(
    compliance: { overallRate: number },
    newOutliers: OutlierDetail[],
    config: PatternComplianceConfig
  ): boolean {
    // Check compliance rate threshold
    if (compliance.overallRate < config.minComplianceRate) {
      return false;
    }

    // Check new outliers threshold
    const actualNewOutliers = newOutliers.filter(o => o.isNew).length;
    if (actualNewOutliers > config.maxNewOutliers) {
      return false;
    }

    return true;
  }

  /**
   * Calculate the compliance score (0-100).
   */
  private calculateComplianceScore(
    compliance: { overallRate: number },
    newOutliers: OutlierDetail[],
    _config: PatternComplianceConfig
  ): number {
    // Base score from compliance rate
    let score = compliance.overallRate;
    
    // Penalty for new outliers (5 points each)
    const actualNewOutliers = newOutliers.filter(o => o.isNew).length;
    const outlierPenalty = actualNewOutliers * 5;
    score = Math.max(0, score - outlierPenalty);
    
    return Math.round(score);
  }

  /**
   * Build human-readable summary.
   */
  private buildSummary(
    compliance: { overallRate: number },
    newOutliers: OutlierDetail[],
    passed: boolean
  ): string {
    const actualNewOutliers = newOutliers.filter(o => o.isNew).length;
    
    if (passed) {
      if (actualNewOutliers === 0) {
        return `Pattern compliance: ${compliance.overallRate.toFixed(1)}%`;
      }
      return `Pattern compliance: ${compliance.overallRate.toFixed(1)}% (${actualNewOutliers} new outlier${actualNewOutliers === 1 ? '' : 's'})`;
    }
    
    return `Pattern compliance failed: ${compliance.overallRate.toFixed(1)}% compliance, ${actualNewOutliers} new outlier${actualNewOutliers === 1 ? '' : 's'}`;
  }

  /**
   * Build warnings for the result.
   */
  private buildWarnings(
    compliance: { lowConfidencePatterns: number },
    patterns: Pattern[]
  ): string[] {
    const warnings: string[] = [];
    
    // Warn about low-confidence patterns
    if (compliance.lowConfidencePatterns > 0) {
      warnings.push(`${compliance.lowConfidencePatterns} pattern${compliance.lowConfidencePatterns === 1 ? '' : 's'} have low confidence (<80%)`);
    }

    // Warn if very few patterns
    if (patterns.length < 3) {
      warnings.push('Few patterns detected. Consider running more scans to establish patterns.');
    }
    
    return warnings;
  }
}
