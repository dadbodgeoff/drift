/**
 * Scanner module exports
 *
 * Provides file system traversal, change detection, dependency graph building,
 * and parallel processing capabilities.
 */

export * from './types.js';
export { FileWalker } from './file-walker.js';

// Default ignore patterns (enterprise-grade)
export {
  DEFAULT_IGNORE_DIRECTORIES,
  DEFAULT_IGNORE_PATTERNS,
  DEFAULT_IGNORE_EXTENSIONS,
  shouldIgnoreDirectory,
  shouldIgnoreExtension,
  getDefaultIgnorePatterns,
  getDefaultIgnoreDirectories,
  mergeIgnorePatterns,
} from './default-ignores.js';
export {
  ChangeDetector,
  type ChangeType,
  type FileSnapshot,
  type ChangeSet,
  type FileChange,
  type ChangeDetectionOptions,
  type SnapshotFile,
} from './change-detector.js';
export {
  DependencyGraph,
  type ImportType,
  type ExportType,
  type ImportInfo,
  type ImportSpecifier,
  type ExportInfo,
  type ModuleNode,
  type DependencyEdge,
  type CircularDependencyResult,
  type DependencyGraphOptions,
} from './dependency-graph.js';
export {
  WorkerPool,
  createFileProcessorPool,
  type WorkerPoolOptions,
  type TaskStatus,
  type Task,
  type TaskResult,
  type WorkerPoolStats,
  type WorkerPoolEvents,
  type TaskProcessor,
} from './worker-pool.js';

// Threaded Worker Pool (true multi-threading with Piscina)
export {
  ThreadedWorkerPool,
  createThreadedPool,
  getModuleDir,
  type ThreadedWorkerPoolOptions,
  type ThreadedWorkerPoolStats,
  type BatchResult,
  type ThreadedWorkerPoolEvents,
} from './threaded-worker-pool.js';

// File Processor Worker types (for worker thread tasks)
export type {
  FileProcessorTask,
  FileProcessorResult,
} from './file-processor-worker.js';

// Native Rust Scanner (high-performance)
export {
  isNativeScannerAvailable,
  getNativeScannerError,
  getNativeScannerVersion,
  nativeScan,
  scanWithFallback,
  type NativeScanResult,
  type NativeFileInfo,
  type NativeScanStats,
  type NativeScanConfig,
} from './native-scanner.js';
