/**
 * UI module exports
 *
 * Provides CLI UI components for interactive prompts, spinners,
 * tables, and progress bars.
 */

// Prompts
export {
  confirmPrompt,
  inputPrompt,
  selectPrompt,
  multiSelectPrompt,
  promptPatternAction,
  promptBatchPatternApproval,
  promptSeverity,
  promptVariantReason,
  promptVariantScope,
  promptInitOptions,
  promptIgnoreReason,
  promptReportFormat,
  promptCategorySelection,
  type PatternChoice,
  type PatternAction,
  type VariantScope,
  type InitPromptResult,
  type ReportFormat,
} from './prompts.js';

// Spinner
export {
  Spinner,
  createSpinner,
  withSpinner,
  spinners,
  status,
  type SpinnerOptions,
} from './spinner.js';

// Table
export {
  createTable,
  formatSeverity,
  formatConfidence,
  formatCount,
  formatPath,
  createPatternsTable,
  createViolationsTable,
  createSummaryTable,
  createStatusTable,
  createCategoryTable,
  type TableStyle,
  type TableOptions,
  type PatternRow,
  type ViolationRow,
  type SummaryRow,
  type StatusSummary,
  type CategoryBreakdown,
} from './table.js';

// Progress
export {
  Progress,
  MultiProgress,
  createScanProgress,
  createAnalysisProgress,
  createDetectionProgress,
  withProgress,
  logProgress,
  type ProgressOptions,
} from './progress.js';
