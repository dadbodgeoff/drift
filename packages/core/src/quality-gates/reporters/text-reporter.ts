/**
 * Text Reporter
 * 
 * @license Apache-2.0
 * 
 * Human-readable text reporter for CLI output.
 */

import { BaseReporter } from './reporter-interface.js';

import type { QualityGateResult, ReporterOptions } from '../types.js';

/**
 * Human-readable text reporter.
 */
export class TextReporter extends BaseReporter {
  readonly id = 'text';
  readonly format = 'text' as const;

  generate(result: QualityGateResult, options?: ReporterOptions): string {
    const lines: string[] = [];
    const verbose = options?.verbose ?? false;

    // Header
    lines.push('');
    lines.push('═'.repeat(60));
    lines.push('  DRIFT QUALITY GATE RESULTS');
    lines.push('═'.repeat(60));
    lines.push('');

    // Overall status
    const statusIcon = result.passed ? '✅' : '❌';
    lines.push(`  Status:  ${statusIcon} ${result.status.toUpperCase()}`);
    lines.push(`  Score:   ${result.score}/100`);
    lines.push(`  Policy:  ${result.policy.name}`);
    lines.push('');

    // Gate results
    if (Object.keys(result.gates).length > 0) {
      lines.push('─'.repeat(60));
      lines.push('  GATE RESULTS');
      lines.push('─'.repeat(60));
      lines.push('');

      for (const [_gateId, gate] of Object.entries(result.gates)) {
        const icon = gate.passed ? '✅' : gate.status === 'warned' ? '⚠️' : '❌';
        lines.push(`  ${icon} ${gate.gateName}`);
        lines.push(`     Score: ${gate.score}/100`);
        lines.push(`     ${gate.summary}`);
        
        if (verbose && gate.violations.length > 0) {
          lines.push(`     Violations: ${gate.violations.length}`);
        }
        lines.push('');
      }
    }

    // Violations
    if (result.violations.length > 0) {
      lines.push('─'.repeat(60));
      lines.push('  VIOLATIONS');
      lines.push('─'.repeat(60));
      lines.push('');

      const maxViolations = verbose ? result.violations.length : 10;
      for (const v of result.violations.slice(0, maxViolations)) {
        const icon = v.severity === 'error' ? '❌' : v.severity === 'warning' ? '⚠️' : 'ℹ️';
        lines.push(`  ${icon} ${v.file}:${v.line}`);
        lines.push(`     ${v.message}`);
        if (verbose && v.explanation) {
          lines.push(`     ${v.explanation}`);
        }
        if (verbose && v.suggestedFix) {
          lines.push(`     💡 ${v.suggestedFix}`);
        }
        lines.push('');
      }

      if (!verbose && result.violations.length > 10) {
        lines.push(`  ... and ${result.violations.length - 10} more violations`);
        lines.push('');
      }
    }

    // Warnings
    if (result.warnings.length > 0) {
      lines.push('─'.repeat(60));
      lines.push('  WARNINGS');
      lines.push('─'.repeat(60));
      lines.push('');

      for (const w of result.warnings) {
        lines.push(`  ⚠️ ${w}`);
      }
      lines.push('');
    }

    // Footer
    lines.push('─'.repeat(60));
    lines.push(`  Files checked: ${result.metadata.filesChecked}`);
    lines.push(`  Gates run: ${result.metadata.gatesRun.length}`);
    lines.push(`  Time: ${result.metadata.executionTimeMs}ms`);
    lines.push('═'.repeat(60));
    lines.push('');

    return lines.join('\n');
  }
}
