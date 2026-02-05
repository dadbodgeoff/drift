/**
 * Detector Worker - Worker thread for running pattern detectors
 *
 * NOTE: This is a re-export from driftdetect-core for backward compatibility.
 * The actual implementation lives in driftdetect-core/services.
 */

// Re-export types from core
export type {
  DetectorWorkerTask,
  DetectorWorkerResult,
  WorkerPatternMatch,
  WorkerViolation,
  WarmupTask,
  WarmupResult,
} from 'driftdetect-core';

// The actual worker implementation is in core
// This file exists for backward compatibility with existing imports
