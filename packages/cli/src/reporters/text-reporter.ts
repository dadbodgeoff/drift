/**
 * Text Reporter - Human-readable text output
 *
 * @requirements 29.7
 */

import chalk from 'chalk';

import type { Reporter, ReportData } from './types.js';
import type { Severity } from 'driftdetect-core';

/**
 * Format severity with color
 */
function formatSeverity(severity: Severity): string {
  switch (severity) {
    case 'error':
      return chalk.red('error');
    case 'warning':
      return chalk.yellow('warning');
    case 'info':
      return chalk.blue('info');
    case 'hint':
      return chalk.gray('hint');
    default:
      return severity;
  }
}

/**
 * Get severity icon
 */
function getSeverityIcon(severity: Severity): string {
  switch (severity) {
    case 'error':
      return chalk.red('✖');
    case 'warning':
      return chalk.yellow('⚠');
    case 'info':
      return chalk.blue('ℹ');
    case 'hint':
      return chalk.gray('○');
    default:
      return ' ';
  }
}

/**
 * Text reporter for human-readable output
 */
export class TextReporter implements Reporter {
  generate(data: ReportData): string {
    const lines: string[] = [];

    if (data.violations.length === 0) {
      lines.push(chalk.green('✔ No violations found'));
      return lines.join('\n');
    }

    // Group violations by file
    const byFile = new Map<string, typeof data.violations>();
    for (const violation of data.violations) {
      const existing = byFile.get(violation.file) ?? [];
      existing.push(violation);
      byFile.set(violation.file, existing);
    }

    // Output violations grouped by file
    for (const [file, violations] of Array.from(byFile.entries())) {
      lines.push('');
      lines.push(chalk.underline(file));

      // Sort by line number
      violations.sort((a, b) => a.range.start.line - b.range.start.line);

      for (const violation of violations) {
        const icon = getSeverityIcon(violation.severity);
        const location = chalk.gray(`${violation.range.start.line}:${violation.range.start.character}`);
        const severity = formatSeverity(violation.severity);
        const message = violation.message;
        const patternId = chalk.gray(`(${violation.patternId})`);

        lines.push(`  ${icon} ${location}  ${severity}  ${message} ${patternId}`);

        if (violation.explanation) {
          lines.push(chalk.gray(`    ${violation.explanation}`));
        }
      }
    }

    // Summary
    lines.push('');
    lines.push(chalk.gray('─'.repeat(60)));

    const parts: string[] = [];
    if (data.summary.errors > 0) {
      parts.push(chalk.red(`${data.summary.errors} error${data.summary.errors !== 1 ? 's' : ''}`));
    }
    if (data.summary.warnings > 0) {
      parts.push(chalk.yellow(`${data.summary.warnings} warning${data.summary.warnings !== 1 ? 's' : ''}`));
    }
    if (data.summary.infos > 0) {
      parts.push(chalk.blue(`${data.summary.infos} info`));
    }
    if (data.summary.hints > 0) {
      parts.push(chalk.gray(`${data.summary.hints} hint${data.summary.hints !== 1 ? 's' : ''}`));
    }

    lines.push(`${parts.join(', ')} (${data.summary.total} total)`);

    return lines.join('\n');
  }
}
