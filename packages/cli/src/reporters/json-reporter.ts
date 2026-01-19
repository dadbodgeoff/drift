/**
 * JSON Reporter - Machine-readable JSON output
 *
 * @requirements 30.1
 */

import type { Reporter, ReportData } from './types.js';

/**
 * JSON reporter for machine-readable output
 */
export class JsonReporter implements Reporter {
  generate(data: ReportData): string {
    const output = {
      violations: data.violations.map((v) => ({
        id: v.id,
        patternId: v.patternId,
        severity: v.severity,
        file: v.file,
        line: v.range.start.line,
        column: v.range.start.character,
        endLine: v.range.end.line,
        endColumn: v.range.end.character,
        message: v.message,
        explanation: v.explanation,
        expected: v.expected,
        actual: v.actual,
      })),
      summary: {
        total: data.summary.total,
        errors: data.summary.errors,
        warnings: data.summary.warnings,
        infos: data.summary.infos,
        hints: data.summary.hints,
      },
      patterns: data.patterns.map((p) => ({
        id: p.id,
        name: p.name,
        category: p.category,
        severity: p.severity,
      })),
      timestamp: data.timestamp,
    };

    return JSON.stringify(output, null, 2);
  }
}
