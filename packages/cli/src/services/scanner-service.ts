/**
 * Scanner Service - Enterprise-grade pattern detection with Worker Threads
 *
 * Uses the real detectors from driftdetect-detectors to find
 * high-value architectural patterns and violations.
 *
 * Now uses Piscina worker threads for parallel CPU-bound processing.
 * 
 * NOTE: This is a re-export from driftdetect-core for backward compatibility.
 * The actual implementation lives in driftdetect-core/services.
 */

// Re-export everything from core's scanner service
export {
  ScannerService,
  createScannerService,
  type ScannerServiceConfig,
  type ProjectContext,
  type AggregatedPattern,
  type AggregatedViolation,
  type FileScanResult,
  type ScanResults,
} from 'driftdetect-core';
