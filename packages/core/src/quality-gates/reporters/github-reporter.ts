/**
 * GitHub Reporter
 * 
 * @license Apache-2.0
 * 
 * GitHub Actions reporter with annotations.
 */

import { BaseReporter } from './reporter-interface.js';

import type { QualityGateResult, ReporterOptions, GateViolation } from '../types.js';

/**
 * GitHub Actions reporter with annotations.
 */
export class GitHubReporter extends BaseReporter {
  readonly id = 'github';
  readonly format = 'github' as const;

  generate(result: QualityGateResult, _options?: ReporterOptions): string {
    const lines: string[] = [];

    // Output annotations for violations
    for (const violation of result.violations) {
      lines.push(this.formatAnnotation(violation));
    }

    // Output summary
    lines.push('');
    lines.push('::group::Quality Gate Summary');
    lines.push(`Status: ${result.passed ? '✅ Passed' : '❌ Failed'}`);
    lines.push(`Score: ${result.score}/100`);
    lines.push(`Policy: ${result.policy.name}`);
    lines.push('');

    // Gate results
    for (const [_gateId, gate] of Object.entries(result.gates)) {
      const icon = gate.passed ? '✅' : gate.status === 'warned' ? '⚠️' : '❌';
      lines.push(`${icon} ${gate.gateName}: ${gate.score}/100 - ${gate.summary}`);
    }

    lines.push('::endgroup::');

    // Set output variables (GitHub Actions format)
    lines.push('');
    lines.push(`::set-output name=passed::${result.passed}`);
    lines.push(`::set-output name=score::${result.score}`);
    lines.push(`::set-output name=violations::${result.violations.length}`);

    return lines.join('\n');
  }

  private formatAnnotation(violation: GateViolation): string {
    const level = violation.severity === 'error' ? 'error' : 
                  violation.severity === 'warning' ? 'warning' : 'notice';
    
    // GitHub Actions annotation format
    // ::error file={name},line={line},col={col}::{message}
    return `::${level} file=${violation.file},line=${violation.line},col=${violation.column}::${violation.message}`;
  }
}
