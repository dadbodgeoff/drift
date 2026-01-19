/**
 * Scanner module exports
 *
 * Provides file system traversal, change detection, dependency graph building,
 * and parallel processing capabilities.
 */

export * from './types.js';
export { FileWalker } from './file-walker.js';
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
