/**
 * Error Handling Coverage Module
 *
 * Provides error handling analysis, boundary detection, and gap identification.
 */

// Types
export type {
  CatchAction,
  ErrorSeverity,
  ErrorHandlingQuality,
  CatchClause,
  AsyncErrorHandling,
  ErrorHandlingProfile,
  ErrorBoundary,
  UnhandledErrorPath,
  ErrorTransformation,
  ErrorPropagationChain,
  ErrorHandlingTopology,
  ErrorHandlingMetrics,
  ErrorHandlingSummary,
  FunctionErrorAnalysis,
  ErrorHandlingGap,
  ErrorHandlingOptions,
  GapDetectionOptions,
  BoundaryAnalysisOptions,
} from './types.js';

// Analyzer
export {
  ErrorHandlingAnalyzer,
  createErrorHandlingAnalyzer,
} from './error-handling-analyzer.js';
