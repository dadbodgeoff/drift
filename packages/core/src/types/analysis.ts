/**
 * Analysis type definitions
 */

import type { AnalysisMetrics } from '../analyzers/types.js';
import type { PatternMatch } from '../matcher/types.js';
import type { Violation } from '../rules/types.js';

export interface AnalysisResult {
  /** File that was analyzed */
  file: string;
  /** Patterns found in the file */
  patterns: PatternMatch[];
  /** Violations found in the file */
  violations: Violation[];
  /** Analysis metrics */
  metrics: AnalysisMetrics;
  /** When analysis was performed */
  timestamp: Date;
}
