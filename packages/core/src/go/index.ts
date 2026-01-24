/**
 * Go Language Support Module
 *
 * Exports all Go-related functionality for use by CLI and MCP tools.
 */

// Main analyzer
export {
  GoAnalyzer,
  createGoAnalyzer,
  type GoAnalyzerConfig,
  type GoAnalysisResult,
  type GoAnalysisStats,
  type GoPackage,
  type GoRoute,
  type GoRoutesResult,
  type GoErrorHandlingResult,
  type GoErrorPattern,
  type GoErrorIssue,
  type GoSentinelError,
  type GoCustomError,
  type GoInterfacesResult,
  type GoInterface,
  type GoImplementation,
  type GoDataAccessResult,
  type GoGoroutinesResult,
  type GoGoroutine,
  type GoConcurrencyIssue,
} from './go-analyzer.js';
