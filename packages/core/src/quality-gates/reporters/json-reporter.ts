/**
 * JSON Reporter
 * 
 * @license Apache-2.0
 * 
 * JSON reporter for machine-readable output.
 */

import { BaseReporter } from './reporter-interface.js';

import type { QualityGateResult, ReporterOptions } from '../types.js';

/**
 * JSON reporter for machine-readable output.
 */
export class JsonReporter extends BaseReporter {
  readonly id = 'json';
  readonly format = 'json' as const;

  generate(result: QualityGateResult, _options?: ReporterOptions): string {
    const output = {
      passed: result.passed,
      status: result.status,
      score: result.score,
      summary: result.summary,
      gates: Object.fromEntries(
        Object.entries(result.gates).map(([id, gate]) => [
          id,
          {
            passed: gate.passed,
            status: gate.status,
            score: gate.score,
            summary: gate.summary,
            violationCount: gate.violations.length,
            warningCount: gate.warnings.length,
          },
        ])
      ),
      violations: result.violations.map(v => ({
        id: v.id,
        gateId: v.gateId,
        severity: v.severity,
        file: v.file,
        line: v.line,
        column: v.column,
        message: v.message,
        ruleId: v.ruleId,
        suggestedFix: v.suggestedFix,
      })),
      warnings: result.warnings,
      policy: result.policy,
      metadata: result.metadata,
      exitCode: result.exitCode,
    };

    return JSON.stringify(output, null, 2);
  }
}
