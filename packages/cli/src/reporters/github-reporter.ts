/**
 * GitHub Reporter - GitHub Actions annotations
 *
 * @requirements 30.2
 */

import type { Reporter, ReportData } from './types.js';
import type { Severity } from 'driftdetect-core';

/**
 * Map severity to GitHub annotation level
 */
function severityToLevel(severity: Severity): 'error' | 'warning' | 'notice' {
  switch (severity) {
    case 'error':
      return 'error';
    case 'warning':
      return 'warning';
    case 'info':
    case 'hint':
    default:
      return 'notice';
  }
}

/**
 * GitHub Actions reporter for CI annotations
 */
export class GitHubReporter implements Reporter {
  generate(data: ReportData): string {
    const lines: string[] = [];

    for (const violation of data.violations) {
      const level = severityToLevel(violation.severity);
      const file = violation.file;
      const line = violation.range.start.line;
      const endLine = violation.range.end.line;
      const col = violation.range.start.character;
      const endCol = violation.range.end.character;
      const title = `Drift: ${violation.patternId}`;
      const message = violation.message;

      lines.push(
        `::${level} file=${file},line=${line},endLine=${endLine},col=${col},endColumn=${endCol},title=${title}::${message}`
      );
    }

    if (data.violations.length > 0) {
      const parts: string[] = [];
      if (data.summary.errors > 0) {parts.push(`${data.summary.errors} error(s)`);}
      if (data.summary.warnings > 0) {parts.push(`${data.summary.warnings} warning(s)`);}
      if (data.summary.infos > 0) {parts.push(`${data.summary.infos} info`);}
      if (data.summary.hints > 0) {parts.push(`${data.summary.hints} hint(s)`);}
      lines.push(`::notice::Drift found ${data.summary.total} violation(s): ${parts.join(', ')}`);
    } else {
      lines.push('::notice::Drift: No violations found');
    }

    lines.push(`::set-output name=violations::${data.summary.total}`);
    lines.push(`::set-output name=errors::${data.summary.errors}`);
    lines.push(`::set-output name=warnings::${data.summary.warnings}`);

    return lines.join('\n');
  }
}
