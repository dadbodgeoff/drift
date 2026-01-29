/**
 * GitLab Reporter
 * 
 * @license Apache-2.0
 * 
 * GitLab Code Quality reporter.
 */

import { BaseReporter } from './reporter-interface.js';

import type { QualityGateResult, ReporterOptions } from '../types.js';

/**
 * GitLab Code Quality reporter.
 * Outputs in GitLab Code Quality format for integration with GitLab CI.
 */
export class GitLabReporter extends BaseReporter {
  readonly id = 'gitlab';
  readonly format = 'gitlab' as const;

  generate(result: QualityGateResult, _options?: ReporterOptions): string {
    // GitLab Code Quality format
    const issues = result.violations.map(v => ({
      description: v.message,
      check_name: v.ruleId,
      fingerprint: v.id,
      severity: this.mapSeverity(v.severity),
      location: {
        path: v.file,
        lines: {
          begin: v.line,
          end: v.endLine ?? v.line,
        },
      },
    }));

    return JSON.stringify(issues, null, 2);
  }

  private mapSeverity(severity: string): string {
    switch (severity) {
      case 'error': return 'critical';
      case 'warning': return 'major';
      case 'info': return 'minor';
      default: return 'info';
    }
  }
}
