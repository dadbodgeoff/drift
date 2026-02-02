/**
 * Services - Shared services for CLI and MCP packages
 * 
 * These services orchestrate pattern detection and other high-level operations.
 */

// Scanner Service - Pattern detection with worker threads
export {
  ScannerService,
  createScannerService,
} from './scanner-service.js';

export type {
  ProjectContext,
  ScannerServiceConfig,
  AggregatedPattern,
  AggregatedViolation,
  FileScanResult,
  ScanResults,
} from './scanner-service.js';

// Detector Worker types (for worker thread communication)
export type {
  WarmupTask,
  WarmupResult,
  DetectorWorkerTask,
  WorkerPatternMatch,
  WorkerViolation,
  DetectorWorkerResult,
} from './detector-worker.js';
