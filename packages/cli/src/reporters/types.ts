/**
 * Reporter type definitions
 */

import type { Violation, Pattern } from 'driftdetect-core';

/**
 * Summary of violations
 */
export interface ViolationSummary {
  /** Total number of violations */
  total: number;
  /** Number of errors */
  errors: number;
  /** Number of warnings */
  warnings: number;
  /** Number of info violations */
  infos: number;
  /** Number of hints */
  hints: number;
}

/**
 * Data passed to reporters
 */
export interface ReportData {
  /** Violations found */
  violations: Violation[];
  /** Summary statistics */
  summary: ViolationSummary;
  /** Patterns checked */
  patterns: Pattern[];
  /** Timestamp of the report */
  timestamp: string;
  /** Root directory */
  rootDir: string;
}

/**
 * Reporter interface
 */
export interface Reporter {
  /** Generate a report from the data */
  generate(data: ReportData): string;
}
