/**
 * Result Aggregator
 * 
 * @license Apache-2.0
 * 
 * Aggregates gate results into a final quality gate result.
 */

import type {
  QualityGateResult,
  QualityGateOptions,
  QualityPolicy,
  GateId,
  GateResult,
  GateViolation,
  GateStatus,
} from '../types.js';

/**
 * Aggregates gate results into a final quality gate result.
 */
export class ResultAggregator {
  /**
   * Aggregate gate results.
   */
  aggregate(
    gateResults: Record<GateId, GateResult>,
    evaluation: {
      passed: boolean;
      status: GateStatus;
      score: number;
      summary: string;
    },
    policy: QualityPolicy,
    context: {
      files: string[];
      startTime: number;
      options: QualityGateOptions;
    }
  ): QualityGateResult {
    // Collect all violations
    const violations: GateViolation[] = [];
    for (const result of Object.values(gateResults)) {
      violations.push(...result.violations);
    }

    // Sort violations by severity (errors first)
    violations.sort((a, b) => {
      const severityOrder = { error: 0, warning: 1, info: 2, hint: 3 };
      return (severityOrder[a.severity] ?? 4) - (severityOrder[b.severity] ?? 4);
    });

    // Collect all warnings
    const warnings: string[] = [];
    for (const result of Object.values(gateResults)) {
      warnings.push(...result.warnings);
    }

    // Determine gates run and skipped
    const gatesRun = Object.keys(gateResults) as GateId[];
    const allGates: GateId[] = [
      'pattern-compliance',
      'constraint-verification',
      'regression-detection',
      'impact-simulation',
      'security-boundary',
      'custom-rules',
    ];
    const gatesSkipped = allGates.filter(g => !gatesRun.includes(g));

    // Determine exit code
    const exitCode = evaluation.passed ? 0 : 1;

    return {
      passed: evaluation.passed,
      status: evaluation.status,
      score: evaluation.score,
      summary: evaluation.summary,
      gates: gateResults,
      violations,
      warnings,
      policy: {
        id: policy.id,
        name: policy.name,
      },
      metadata: {
        executionTimeMs: Date.now() - context.startTime,
        filesChecked: context.files.length,
        gatesRun,
        gatesSkipped,
        timestamp: new Date().toISOString(),
        branch: context.options.branch ?? 'main',
        ...(context.options.commitSha ? { commitSha: context.options.commitSha } : {}),
        ci: context.options.ci ?? false,
      },
      exitCode,
    };
  }
}
