/**
 * Threaded Worker Pool - True multi-threaded file processing using Piscina
 *
 * Provides actual Node.js Worker Threads for CPU-bound tasks like
 * AST parsing and regex matching, enabling near-linear scaling with CPU cores.
 *
 * @requirements 2.6 - THE Scanner SHALL process files in parallel using worker threads
 */

import { EventEmitter } from 'node:events';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

// Piscina types
interface PiscinaOptions {
  filename: string;
  minThreads?: number;
  maxThreads?: number;
  idleTimeout?: number;
  maxQueue?: number | 'auto';
  concurrentTasksPerWorker?: number;
  useAtomics?: boolean;
  resourceLimits?: {
    maxOldGenerationSizeMb?: number;
    maxYoungGenerationSizeMb?: number;
    codeRangeSizeMb?: number;
    stackSizeMb?: number;
  };
  env?: Record<string, string>;
  workerData?: unknown;
  taskQueue?: unknown;
  niceIncrement?: number;
  trackUnmanagedFds?: boolean;
  closeTimeout?: number;
}

interface Piscina {
  run<T>(task: unknown, options?: { transferList?: unknown[] }): Promise<T>;
  runTask<T>(task: unknown, transferList?: unknown[]): Promise<T>;
  destroy(): Promise<void>;
  readonly threads: unknown[];
  readonly queueSize: number;
  readonly completed: number;
  readonly waitTime: { average: number; min: number; max: number; p99: number };
  readonly runTime: { average: number; min: number; max: number; p99: number };
}

type PiscinaConstructor = new (options: PiscinaOptions) => Piscina;

/**
 * Options for configuring the threaded worker pool
 */
export interface ThreadedWorkerPoolOptions {
  /**
   * Minimum number of worker threads to maintain
   * @default 1
   */
  minThreads?: number;

  /**
   * Maximum number of worker threads
   * @default Number of CPU cores
   */
  maxThreads?: number;

  /**
   * Idle timeout for worker threads in milliseconds
   * @default 30000 (30 seconds)
   */
  idleTimeout?: number;

  /**
   * Maximum queue size (0 = unlimited, 'auto' = based on thread count)
   * @default 'auto'
   */
  maxQueue?: number | 'auto';

  /**
   * Number of concurrent tasks per worker
   * @default 1
   */
  concurrentTasksPerWorker?: number;

  /**
   * Path to the worker script
   */
  workerPath?: string;

  /**
   * Data to pass to workers on initialization
   */
  workerData?: unknown;

  /**
   * Environment variables for workers
   */
  env?: Record<string, string>;

  /**
   * Resource limits for worker threads
   */
  resourceLimits?: {
    maxOldGenerationSizeMb?: number;
    maxYoungGenerationSizeMb?: number;
    codeRangeSizeMb?: number;
    stackSizeMb?: number;
  };
}

/**
 * Statistics about the threaded worker pool
 */
export interface ThreadedWorkerPoolStats {
  /** Number of active worker threads */
  threads: number;

  /** Number of tasks in the queue */
  queueSize: number;

  /** Total tasks completed */
  completed: number;

  /** Average wait time in milliseconds */
  avgWaitTime: number;

  /** Average run time in milliseconds */
  avgRunTime: number;

  /** P99 wait time in milliseconds */
  p99WaitTime: number;

  /** P99 run time in milliseconds */
  p99RunTime: number;

  /** Whether the pool is running */
  isRunning: boolean;
}

/**
 * Result of a batch task execution
 */
export interface BatchResult<T> {
  /** Successful results */
  results: T[];

  /** Errors that occurred */
  errors: Array<{ index: number; error: string }>;

  /** Total duration in milliseconds */
  duration: number;

  /** Number of tasks processed */
  processed: number;
}

/**
 * Events emitted by the threaded worker pool
 */
export interface ThreadedWorkerPoolEvents {
  /** Emitted when a task completes */
  taskComplete: (result: unknown) => void;

  /** Emitted when a task fails */
  taskError: (error: Error) => void;

  /** Emitted when the pool is drained */
  drain: () => void;

  /** Emitted when the pool is destroyed */
  destroy: () => void;
}

/**
 * Default options
 */
const DEFAULT_OPTIONS: Required<Omit<ThreadedWorkerPoolOptions, 'workerPath' | 'workerData' | 'env' | 'resourceLimits'>> = {
  minThreads: 1,
  maxThreads: Math.max(1, os.cpus().length - 1), // Leave one core for main thread
  idleTimeout: 30000,
  maxQueue: 'auto',
  concurrentTasksPerWorker: 1,
};

/**
 * ThreadedWorkerPool - True multi-threaded task processing using Piscina
 *
 * Unlike the async WorkerPool, this uses actual Node.js Worker Threads
 * to parallelize CPU-bound work across multiple cores.
 *
 * @example
 * ```typescript
 * const pool = new ThreadedWorkerPool({
 *   workerPath: './file-parser-worker.js',
 *   maxThreads: 4,
 * });
 *
 * const results = await pool.runBatch([
 *   { file: 'src/index.ts', content: '...' },
 *   { file: 'src/utils.ts', content: '...' },
 * ]);
 *
 * await pool.destroy();
 * ```
 */
export class ThreadedWorkerPool<TInput = unknown, TOutput = unknown> extends EventEmitter {
  private pool: Piscina | null = null;
  private options: Required<Omit<ThreadedWorkerPoolOptions, 'workerPath' | 'workerData' | 'env' | 'resourceLimits'>> & 
    Pick<ThreadedWorkerPoolOptions, 'workerPath' | 'workerData' | 'env' | 'resourceLimits'>;
  private isDestroyed = false;
  private PiscinaClass: PiscinaConstructor | null = null;

  constructor(options: ThreadedWorkerPoolOptions = {}) {
    super();
    this.options = {
      ...DEFAULT_OPTIONS,
      ...options,
    };
  }

  /**
   * Initialize the worker pool
   * Must be called before running tasks
   */
  async initialize(): Promise<void> {
    if (this.pool) {
      return; // Already initialized
    }

    if (this.isDestroyed) {
      throw new Error('Cannot initialize a destroyed pool');
    }

    // Dynamically import Piscina
    try {
      const piscinaModule = await import('piscina');
      this.PiscinaClass = piscinaModule.default as unknown as PiscinaConstructor;
    } catch (error) {
      throw new Error(
        `Failed to load piscina: ${error instanceof Error ? error.message : 'unknown error'}. ` +
        'Install with: pnpm add piscina'
      );
    }

    if (!this.options.workerPath) {
      throw new Error('workerPath is required');
    }

    const piscinaOptions: PiscinaOptions = {
      filename: this.options.workerPath,
      minThreads: this.options.minThreads,
      maxThreads: this.options.maxThreads,
      idleTimeout: this.options.idleTimeout,
      maxQueue: this.options.maxQueue,
      concurrentTasksPerWorker: this.options.concurrentTasksPerWorker,
    };

    if (this.options.workerData !== undefined) {
      piscinaOptions.workerData = this.options.workerData;
    }

    if (this.options.env) {
      piscinaOptions.env = this.options.env;
    }

    if (this.options.resourceLimits) {
      piscinaOptions.resourceLimits = this.options.resourceLimits;
    }

    this.pool = new this.PiscinaClass(piscinaOptions);
  }

  /**
   * Run a single task in a worker thread
   *
   * @param task - Task data to process
   * @returns Promise resolving to the task result
   */
  async run(task: TInput): Promise<TOutput> {
    if (this.isDestroyed) {
      throw new Error('Pool has been destroyed');
    }

    if (!this.pool) {
      throw new Error('Pool not initialized. Call initialize() first.');
    }

    try {
      const result = await this.pool.run<TOutput>(task);
      this.emit('taskComplete', result);
      return result;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.emit('taskError', err);
      throw err;
    }
  }

  /**
   * Run multiple tasks in parallel across worker threads
   *
   * @param tasks - Array of tasks to process
   * @returns Promise resolving to batch results
   */
  async runBatch(tasks: TInput[]): Promise<BatchResult<TOutput>> {
    if (!this.pool) {
      throw new Error('Pool not initialized. Call initialize() first.');
    }

    if (this.isDestroyed) {
      throw new Error('Pool has been destroyed');
    }

    const startTime = Date.now();
    const results: TOutput[] = [];
    const errors: Array<{ index: number; error: string }> = [];

    // Run all tasks in parallel
    const promises = tasks.map(async (task, index) => {
      try {
        const result = await this.pool!.run<TOutput>(task);
        this.emit('taskComplete', result);
        return { index, result, error: null };
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        this.emit('taskError', err);
        return { index, result: null, error: err.message };
      }
    });

    const outcomes = await Promise.all(promises);

    // Sort by index to maintain order
    outcomes.sort((a, b) => a.index - b.index);

    for (const outcome of outcomes) {
      if (outcome.error) {
        errors.push({ index: outcome.index, error: outcome.error });
      } else if (outcome.result !== null) {
        results.push(outcome.result);
      }
    }

    const duration = Date.now() - startTime;

    if (this.pool.queueSize === 0) {
      this.emit('drain');
    }

    return {
      results,
      errors,
      duration,
      processed: tasks.length,
    };
  }

  /**
   * Get current pool statistics
   */
  getStats(): ThreadedWorkerPoolStats {
    if (!this.pool) {
      return {
        threads: 0,
        queueSize: 0,
        completed: 0,
        avgWaitTime: 0,
        avgRunTime: 0,
        p99WaitTime: 0,
        p99RunTime: 0,
        isRunning: false,
      };
    }

    // Piscina may not have waitTime/runTime stats immediately
    const waitTime = this.pool.waitTime || { average: 0, min: 0, max: 0, p99: 0 };
    const runTime = this.pool.runTime || { average: 0, min: 0, max: 0, p99: 0 };

    return {
      threads: this.pool.threads.length,
      queueSize: this.pool.queueSize,
      completed: this.pool.completed,
      avgWaitTime: waitTime.average || 0,
      avgRunTime: runTime.average || 0,
      p99WaitTime: waitTime.p99 || 0,
      p99RunTime: runTime.p99 || 0,
      isRunning: !this.isDestroyed,
    };
  }

  /**
   * Destroy the worker pool and clean up resources
   */
  async destroy(): Promise<void> {
    if (this.isDestroyed) {
      return;
    }

    this.isDestroyed = true;

    if (this.pool) {
      await this.pool.destroy();
      this.pool = null;
    }

    this.emit('destroy');
  }

  /**
   * Check if the pool is initialized and running
   */
  isRunning(): boolean {
    return this.pool !== null && !this.isDestroyed;
  }
}

/**
 * Get the directory of the current module (for worker path resolution)
 */
export function getModuleDir(importMetaUrl: string): string {
  return path.dirname(fileURLToPath(importMetaUrl));
}

/**
 * Create a threaded worker pool for file processing
 *
 * @param workerPath - Path to the worker script
 * @param options - Pool options
 * @returns Configured ThreadedWorkerPool instance
 */
export function createThreadedPool<TInput = unknown, TOutput = unknown>(
  workerPath: string,
  options: Omit<ThreadedWorkerPoolOptions, 'workerPath'> = {}
): ThreadedWorkerPool<TInput, TOutput> {
  return new ThreadedWorkerPool<TInput, TOutput>({
    ...options,
    workerPath,
  });
}
