/**
 * Table - Table formatting for output
 *
 * Provides formatted table output for CLI results.
 *
 * @requirements 29.1
 */

import chalk from 'chalk';
import Table from 'cli-table3';

import type { Severity } from 'driftdetect-core';

/**
 * Table style presets
 */
export type TableStyle = 'default' | 'compact' | 'borderless' | 'minimal';

/**
 * Table configuration options
 */
export interface TableOptions {
  /** Table headers */
  head?: string[];
  /** Column widths */
  colWidths?: number[];
  /** Column alignments */
  colAligns?: Array<'left' | 'center' | 'right'>;
  /** Table style preset */
  style?: TableStyle;
  /** Word wrap long content */
  wordWrap?: boolean;
}

/**
 * Get table style configuration
 */
function getStyleConfig(style: TableStyle): {
  'padding-left': number;
  'padding-right': number;
  head: string[];
  border: string[];
} {
  switch (style) {
    case 'compact':
      return {
        'padding-left': 0,
        'padding-right': 0,
        head: ['cyan'],
        border: ['gray'],
      };
    case 'borderless':
      return {
        'padding-left': 1,
        'padding-right': 1,
        head: ['cyan'],
        border: [],
      };
    case 'minimal':
      return {
        'padding-left': 1,
        'padding-right': 1,
        head: ['white'],
        border: ['gray'],
      };
    default:
      return {
        'padding-left': 1,
        'padding-right': 1,
        head: ['cyan'],
        border: ['gray'],
      };
  }
}

/**
 * Get table character configuration for borderless style
 */
function getCharsConfig(style: TableStyle): Record<string, string> | null {
  if (style === 'borderless') {
    return {
      top: '',
      'top-mid': '',
      'top-left': '',
      'top-right': '',
      bottom: '',
      'bottom-mid': '',
      'bottom-left': '',
      'bottom-right': '',
      left: '',
      'left-mid': '',
      mid: '',
      'mid-mid': '',
      right: '',
      'right-mid': '',
      middle: ' ',
    };
  }
  return null;
}

/**
 * Create a formatted table
 */
export function createTable(options: TableOptions = {}): Table.Table {
  const style = options.style ?? 'default';
  const chars = getCharsConfig(style);

  // Build options object to avoid exactOptionalPropertyTypes issues
  const tableConfig: Record<string, unknown> = {
    style: getStyleConfig(style),
    wordWrap: options.wordWrap ?? true,
  };

  if (options.head) {
    tableConfig['head'] = options.head;
  }
  if (options.colWidths) {
    tableConfig['colWidths'] = options.colWidths;
  }
  if (options.colAligns) {
    tableConfig['colAligns'] = options.colAligns;
  }
  if (chars) {
    tableConfig['chars'] = chars;
  }

  return new Table(tableConfig as Table.TableConstructorOptions);
}

/**
 * Format a severity value with color
 */
export function formatSeverity(severity: Severity): string {
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
 * Format a confidence score with color
 */
export function formatConfidence(confidence: number): string {
  const percentage = (confidence * 100).toFixed(0) + '%';
  if (confidence >= 0.85) {
    return chalk.green(percentage);
  } else if (confidence >= 0.65) {
    return chalk.yellow(percentage);
  } else if (confidence >= 0.45) {
    return chalk.red(percentage);
  }
  return chalk.gray(percentage);
}

/**
 * Format a count with color based on value
 */
export function formatCount(count: number, threshold = 0): string {
  if (count > threshold) {
    return chalk.red(count.toString());
  }
  return chalk.green(count.toString());
}

/**
 * Format a file path (truncate if too long)
 */
export function formatPath(path: string, maxLength = 50): string {
  if (path.length <= maxLength) {
    return path;
  }
  const start = path.slice(0, 20);
  const end = path.slice(-27);
  return `${start}...${end}`;
}

/**
 * Pattern table row data
 */
export interface PatternRow {
  id: string;
  name: string;
  category: string;
  confidence: number;
  locations: number;
  outliers: number;
}

/**
 * Create a patterns table
 */
export function createPatternsTable(patterns: PatternRow[]): string {
  const table = createTable({
    head: ['ID', 'Name', 'Category', 'Confidence', 'Locations', 'Outliers'],
    colWidths: [15, 30, 20, 12, 12, 10],
    colAligns: ['left', 'left', 'left', 'right', 'right', 'right'],
  });

  for (const pattern of patterns) {
    table.push([
      pattern.id,
      pattern.name,
      pattern.category,
      formatConfidence(pattern.confidence),
      pattern.locations.toString(),
      formatCount(pattern.outliers),
    ]);
  }

  return table.toString();
}

/**
 * Violation table row data
 */
export interface ViolationRow {
  severity: Severity;
  file: string;
  line: number;
  message: string;
  pattern: string;
}

/**
 * Create a violations table
 */
export function createViolationsTable(violations: ViolationRow[]): string {
  const table = createTable({
    head: ['Severity', 'File', 'Line', 'Message', 'Pattern'],
    colWidths: [10, 35, 8, 40, 20],
    colAligns: ['left', 'left', 'right', 'left', 'left'],
  });

  for (const violation of violations) {
    table.push([
      formatSeverity(violation.severity),
      formatPath(violation.file, 33),
      violation.line.toString(),
      violation.message,
      violation.pattern,
    ]);
  }

  return table.toString();
}

/**
 * Summary table row data
 */
export interface SummaryRow {
  label: string;
  value: string | number;
}

/**
 * Create a summary table
 */
export function createSummaryTable(rows: SummaryRow[]): string {
  const table = createTable({
    style: 'borderless',
    colWidths: [25, 20],
    colAligns: ['left', 'right'],
  });

  for (const row of rows) {
    table.push([chalk.gray(row.label), chalk.white(row.value.toString())]);
  }

  return table.toString();
}

/**
 * Status summary data
 */
export interface StatusSummary {
  totalPatterns: number;
  approvedPatterns: number;
  discoveredPatterns: number;
  ignoredPatterns: number;
  totalViolations: number;
  errors: number;
  warnings: number;
}

/**
 * Create a status summary table
 */
export function createStatusTable(summary: StatusSummary): string {
  const table = createTable({
    head: ['Metric', 'Count'],
    colWidths: [25, 15],
    colAligns: ['left', 'right'],
    style: 'minimal',
  });

  table.push(
    ['Total Patterns', summary.totalPatterns.toString()],
    ['  Approved', chalk.green(summary.approvedPatterns.toString())],
    ['  Discovered', chalk.yellow(summary.discoveredPatterns.toString())],
    ['  Ignored', chalk.gray(summary.ignoredPatterns.toString())],
    ['', ''],
    ['Total Violations', formatCount(summary.totalViolations)],
    ['  Errors', formatCount(summary.errors)],
    ['  Warnings', formatCount(summary.warnings, -1)]
  );

  return table.toString();
}

/**
 * Category breakdown data
 */
export interface CategoryBreakdown {
  category: string;
  patterns: number;
  violations: number;
  coverage: number;
}

/**
 * Create a category breakdown table
 */
export function createCategoryTable(categories: CategoryBreakdown[]): string {
  const table = createTable({
    head: ['Category', 'Patterns', 'Violations', 'Coverage'],
    colWidths: [25, 12, 12, 12],
    colAligns: ['left', 'right', 'right', 'right'],
  });

  for (const cat of categories) {
    table.push([
      cat.category,
      cat.patterns.toString(),
      formatCount(cat.violations),
      formatConfidence(cat.coverage),
    ]);
  }

  return table.toString();
}
