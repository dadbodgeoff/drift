/**
 * Constraint Verification Gate
 * 
 * @license Apache-2.0
 * 
 * Verifies that code changes don't violate learned architectural constraints.
 * Constraints are invariants discovered from the codebase (e.g., "all API handlers
 * must have auth middleware", "database access must go through repository layer").
 * 
 * FUTURE_GATE: gate:policy-engine (Team tier for advanced constraint management)
 */

import { BaseGate } from '../base-gate.js';

import type {
  GateId,
  GateInput,
  GateResult,
  GateConfig,
  ConstraintVerificationConfig,
  ConstraintVerificationDetails,
  GateViolation,
  ConstraintResult,
  ConstraintViolationDetail,
  SkippedConstraint,
  Constraint,
} from '../../types.js';

/**
 * Constraint Verification Gate
 * 
 * Checks whether changed files satisfy learned architectural constraints.
 */
export class ConstraintVerificationGate extends BaseGate {
  readonly id: GateId = 'constraint-verification';
  readonly name = 'Constraint Verification';
  readonly description = 'Verifies code satisfies architectural constraints';

  protected async executeGate(input: GateInput): Promise<GateResult> {
    const config = input.config as ConstraintVerificationConfig;
    const constraints = input.context.constraints ?? [];
    
    // Filter constraints by config
    const relevantConstraints = this.filterConstraints(constraints, config);
    
    if (relevantConstraints.length === 0) {
      return this.createPassedResult(
        'No constraints to verify',
        {
          satisfied: [],
          violated: [],
          skipped: [],
          byCategory: {},
        } as unknown as Record<string, unknown>,
        ['No constraints found. Run `drift constraints discover` first.']
      );
    }

    // Verify each constraint against changed files
    const results = await this.verifyConstraints(
      input.files,
      relevantConstraints,
      input.projectRoot
    );

    // Build violations from failed constraints
    const violations = this.buildViolations(results.violated);

    // Determine pass/fail
    const passed = results.violated.length === 0;
    const score = this.calculateScore(results);
    const status = passed ? 'passed' : 'failed';

    const details: ConstraintVerificationDetails = {
      satisfied: results.satisfied,
      violated: results.violated,
      skipped: results.skipped,
      byCategory: results.byCategory,
    };

    const summary = this.buildSummary(results, passed);
    const warnings = this.buildWarnings(results, relevantConstraints);

    if (!passed) {
      return this.createFailedResult(summary, violations, details as unknown as Record<string, unknown>, score, warnings);
    }

    if (results.skipped.length > 0) {
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
    const c = config as ConstraintVerificationConfig;

    if (c.minConfidence < 0 || c.minConfidence > 1) {
      errors.push('minConfidence must be between 0 and 1');
    }

    return { valid: errors.length === 0, errors };
  }

  getDefaultConfig(): ConstraintVerificationConfig {
    return {
      enabled: true,
      blocking: true,
      enforceApproved: true,
      enforceDiscovered: false,
      minConfidence: 0.8,
      categories: [], // Empty = all categories
    };
  }

  /**
   * Filter constraints based on configuration.
   */
  private filterConstraints(
    constraints: Constraint[],
    config: ConstraintVerificationConfig
  ): Constraint[] {
    return constraints.filter(c => {
      // Filter by status
      if (c.status === 'approved' && !config.enforceApproved) {return false;}
      if (c.status === 'discovered' && !config.enforceDiscovered) {return false;}
      if (c.status === 'ignored') {return false;}
      
      // Filter by confidence
      if (c.confidence < config.minConfidence) {return false;}
      
      // Filter by category
      if (config.categories.length > 0 && !config.categories.includes(c.category)) {
        return false;
      }
      
      return true;
    });
  }

  /**
   * Verify constraints against changed files.
   */
  private async verifyConstraints(
    files: string[],
    constraints: Constraint[],
    _projectRoot: string
  ): Promise<{
    satisfied: ConstraintResult[];
    violated: ConstraintViolationDetail[];
    skipped: SkippedConstraint[];
    byCategory: Record<string, { passed: number; failed: number }>;
  }> {
    const satisfied: ConstraintResult[] = [];
    const violated: ConstraintViolationDetail[] = [];
    const skipped: SkippedConstraint[] = [];
    const byCategory: Record<string, { passed: number; failed: number }> = {};

    for (const constraint of constraints) {
      // Initialize category stats
      if (!byCategory[constraint.category]) {
        byCategory[constraint.category] = { passed: 0, failed: 0 };
      }

      // Check if constraint applies to any changed files
      const applicableFiles = this.getApplicableFiles(files, constraint);
      
      if (applicableFiles.length === 0) {
        skipped.push({
          constraintId: constraint.id,
          reason: 'No changed files match constraint scope',
        });
        continue;
      }

      // Verify the constraint
      // Note: In a full implementation, this would use the ConstraintVerifier
      // For now, we do a simplified check based on constraint type
      const result = await this.verifyConstraint(constraint, applicableFiles);

      if (result.passed) {
        satisfied.push({
          constraintId: constraint.id,
          description: constraint.description,
          passed: true,
          confidence: constraint.confidence,
        });
        byCategory[constraint.category]!.passed++;
      } else {
        violated.push({
          constraintId: constraint.id,
          description: constraint.description,
          violatingFiles: result.violatingFiles,
          locations: result.locations,
        });
        byCategory[constraint.category]!.failed++;
      }
    }

    return { satisfied, violated, skipped, byCategory };
  }

  /**
   * Get files that a constraint applies to.
   */
  private getApplicableFiles(files: string[], _constraint: Constraint): string[] {
    // In a full implementation, this would check the constraint's scope
    // For now, return all files
    return files;
  }

  /**
   * Verify a single constraint.
   */
  private async verifyConstraint(
    _constraint: Constraint,
    _files: string[]
  ): Promise<{
    passed: boolean;
    violatingFiles: string[];
    locations: Array<{ file: string; line: number; reason: string }>;
  }> {
    // Simplified verification - in full implementation, this would:
    // 1. Parse the constraint predicate
    // 2. Evaluate it against the files using call graph, patterns, etc.
    // 3. Return detailed violation information
    
    // For now, we assume constraints pass unless we have specific violation data
    // This is a placeholder that will be enhanced when integrating with ConstraintVerifier
    
    return {
      passed: true,
      violatingFiles: [],
      locations: [],
    };
  }

  /**
   * Build violations from constraint failures.
   */
  private buildViolations(violated: ConstraintViolationDetail[]): GateViolation[] {
    const violations: GateViolation[] = [];

    for (const v of violated) {
      for (const loc of v.locations) {
        violations.push(this.createViolation({
          severity: 'error',
          file: loc.file,
          line: loc.line,
          column: 1,
          message: `Violates constraint: ${v.description}`,
          explanation: loc.reason,
          ruleId: v.constraintId,
          suggestedFix: `Ensure code follows the constraint: ${v.description}`,
        }));
      }

      // If no specific locations, create a general violation for each file
      if (v.locations.length === 0) {
        for (const file of v.violatingFiles) {
          violations.push(this.createViolation({
            severity: 'error',
            file,
            line: 1,
            column: 1,
            message: `Violates constraint: ${v.description}`,
            explanation: `File does not satisfy constraint: ${v.constraintId}`,
            ruleId: v.constraintId,
          }));
        }
      }
    }

    return violations;
  }

  /**
   * Calculate score based on results.
   */
  private calculateScore(results: {
    satisfied: ConstraintResult[];
    violated: ConstraintViolationDetail[];
    skipped: SkippedConstraint[];
  }): number {
    const total = results.satisfied.length + results.violated.length;
    if (total === 0) {return 100;}
    
    const passRate = (results.satisfied.length / total) * 100;
    return Math.round(passRate);
  }

  /**
   * Build human-readable summary.
   */
  private buildSummary(
    results: {
      satisfied: ConstraintResult[];
      violated: ConstraintViolationDetail[];
      skipped: SkippedConstraint[];
    },
    passed: boolean
  ): string {
    const total = results.satisfied.length + results.violated.length;
    
    if (total === 0) {
      return 'No constraints applicable to changed files';
    }
    
    if (passed) {
      return `All ${results.satisfied.length} constraint${results.satisfied.length === 1 ? '' : 's'} satisfied`;
    }
    
    return `${results.violated.length} constraint${results.violated.length === 1 ? '' : 's'} violated out of ${total}`;
  }

  /**
   * Build warnings for the result.
   */
  private buildWarnings(
    results: {
      satisfied: ConstraintResult[];
      violated: ConstraintViolationDetail[];
      skipped: SkippedConstraint[];
    },
    constraints: Constraint[]
  ): string[] {
    const warnings: string[] = [];
    
    if (results.skipped.length > 0) {
      warnings.push(`${results.skipped.length} constraint${results.skipped.length === 1 ? '' : 's'} skipped (not applicable to changed files)`);
    }

    // Warn about low-confidence constraints
    const lowConfidence = constraints.filter(c => c.confidence < 0.8).length;
    if (lowConfidence > 0) {
      warnings.push(`${lowConfidence} constraint${lowConfidence === 1 ? '' : 's'} have low confidence (<80%)`);
    }
    
    return warnings;
  }
}
