/**
 * Worker Pool - Parallel file processing with configurable concurrency
 *
 * Provides a task queue-based worker pool for parallel file processing,
 * with support for configurable worker count, task distribution,
 * error handling, and graceful shutdown.
 *
 * @requirements 2.6 - THE Scanner SHALL process files in parallel using worker threads
 */

import { EventEmitter } from 'node:events';

/**
 * Options for configuring the worker pool
 */
export interface WorkerPoolOptions {
  /**
   * Minimum number of workers to maintain
   * @default 1
   */
  minWorkers?: number;

  /**
   * Maximum number of workers (concurrent tasks)
   * @default Number of CPU cores
   */
  maxWorkers?: number;

  /**
   * Timeout for individual tasks in milliseconds
   * @default 30000 (30 seconds)
   */
  taskTimeout?: number;

  /**
   * Maximum number of retries for failed tasks
   * @default 2
   */
  maxRetries?: number;

  /**
   * Whether to enable task result caching
   * @default false
   */
  enableCaching?: boolean;

  /**
   * Maximum size of the task queue (0 = unlimited)
   * @default 0
   */
  maxQueueSize?: number;
}

/**
 * Status of a task in the worker pool
 */
export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'timeout';

/**
 * Represents a task to be processed by the worker pool
 */
export interface Task<TInput, TOutput> {
  /** Unique identifier for the task */
  id: string;

  /** Input data for the task */
  input: TInput;

  /** Current status of the task */
  status: TaskStatus;

  /** Number of retry attempts made */
  retries: number;

  /** Timestamp when the task was created */
  createdAt: Date;

  /** Timestamp when the task started processing */
  startedAt?: Date;

  /** Timestamp when the task completed */
  completedAt?: Date;

  /** Result of the task (if completed successfully) */
  result?: TOutput;

  /** Error message (if failed) */
  error?: string;

  /** Priority (higher = processed first) */
  priority: number;
}

/**
 * Result of a task execution
 */
export interface TaskResult<TOutput> {
  /** Task ID */
  taskId: string;

  /** Whether the task succeeded */
  success: boolean;

  /** Result data (if successful) */
  result?: TOutput;

  /** Error message (if failed) */
  error?: string;

  /** Execution duration in milliseconds */
  duration: number;

  /** Number of retries attempted */
  retries: number;
}

/**
 * Statistics about the worker pool
 */
export interface WorkerPoolStats {
  /** Number of tasks currently in the queue */
  queuedTasks: number;

  /** Number of tasks currently being processed */
  activeTasks: number;

  /** Total number of tasks completed successfully */
  completedTasks: number;

  /** Total number of tasks that failed */
  failedTasks: number;

  /** Total number of tasks cancelled */
  cancelledTasks: number;

  /** Total number of tasks that timed out */
  timedOutTasks: number;

  /** Average task duration in milliseconds */
  averageDuration: number;

  /** Current number of active workers */
  activeWorkers: number;

  /** Maximum workers configured */
  maxWorkers: number;

  /** Whether the pool is shutting down */
  isShuttingDown: boolean;

  /** Whether the pool is paused */
  isPaused: boolean;
}

/**
 * Events emitted by the worker pool
 */
export interface WorkerPoolEvents<TInput, TOutput> {
  /** Emitted when a task is added to the queue */
  taskQueued: (task: Task<TInput, TOutput>) => void;

  /** Emitted when a task starts processing */
  taskStarted: (task: Task<TInput, TOutput>) => void;

  /** Emitted when a task completes successfully */
  taskCompleted: (task: Task<TInput, TOutput>, result: TOutput) => void;

  /** Emitted when a task fails */
  taskFailed: (task: Task<TInput, TOutput>, error: Error) => void;

  /** Emitted when a task is retried */
  taskRetried: (task: Task<TInput, TOutput>, attempt: number) => void;

  /** Emitted when a task times out */
  taskTimeout: (task: Task<TInput, TOutput>) => void;

  /** Emitted when the pool is drained (all tasks complete) */
  drained: () => void;

  /** Emitted when the pool is idle (no tasks and no active workers) */
  idle: () => void;

  /** Emitted when an error occurs in the pool */
  error: (error: Error) => void;
}

/**
 * Type for the task processor function
 */
export type TaskProcessor<TInput, TOutput> = (input: TInput) => Promise<TOutput>;

/**
 * Default options for the worker pool
 */
const DEFAULT_CPU_COUNT = 4;

/**
 * Get default options synchronously
 */
function getDefaultOptions(): Required<WorkerPoolOptions> {
  let cpuCount = DEFAULT_CPU_COUNT;
  try {
    // Dynamic import for Node.js os module
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const os = require('node:os');
    cpuCount = os.cpus().length || DEFAULT_CPU_COUNT;
  } catch {
    // Fallback for non-Node environments
    cpuCount = DEFAULT_CPU_COUNT;
  }

  return {
    minWorkers: 1,
    maxWorkers: cpuCount,
    taskTimeout: 30000,
    maxRetries: 2,
    enableCaching: false,
    maxQueueSize: 0,
  };
}

/**
 * WorkerPool class for parallel task processing
 *
 * Implements a configurable worker pool that processes tasks in parallel
 * with support for task queuing, retries, timeouts, and graceful shutdown.
 *
 * @requirements 2.6 - Parallel file processing with configurable worker count
 *
 * @example
 * ```typescript
 * const pool = new WorkerPool<string, ParseResult>({
 *   maxWorkers: 4,
 *   taskTimeout: 10000,
 * });
 *
 * pool.setProcessor(async (filePath) => {
 *   return await parseFile(filePath);
 * });
 *
 * const results = await pool.processBatch(['file1.ts', 'file2.ts']);
 * await pool.shutdown();
 * ```
 */
export class WorkerPool<TInput, TOutput> extends EventEmitter {
  private options: Required<WorkerPoolOptions>;
  private taskQueue: Task<TInput, TOutput>[] = [];
  private activeTasks: Map<string, Task<TInput, TOutput>> = new Map();
  private completedTasks: Map<string, Task<TInput, TOutput>> = new Map();
  private processor: TaskProcessor<TInput, TOutput> | null = null;
  private taskIdCounter = 0;
  private isShuttingDown = false;
  private isPaused = false;
  private totalDuration = 0;
  private completedCount = 0;
  private failedCount = 0;
  private cancelledCount = 0;
  private timedOutCount = 0;
  private taskTimeouts: Map<string, NodeJS.Timeout> = new Map();
  private cache: Map<string, TOutput> = new Map();

  constructor(options: WorkerPoolOptions = {}) {
    super();
    const defaults = getDefaultOptions();
    this.options = { ...defaults, ...options };

    // Validate options
    if (this.options.minWorkers < 1) {
      this.options.minWorkers = 1;
    }
    if (this.options.maxWorkers < this.options.minWorkers) {
      this.options.maxWorkers = this.options.minWorkers;
    }
  }

  /**
   * Set the task processor function
   *
   * @param processor - Function that processes a single task input
   */
  setProcessor(processor: TaskProcessor<TInput, TOutput>): void {
    this.processor = processor;
  }

  /**
   * Add a single task to the queue
   *
   * @param input - Input data for the task
   * @param priority - Task priority (higher = processed first)
   * @returns The created task
   */
  addTask(input: TInput, priority: number = 0): Task<TInput, TOutput> {
    if (this.isShuttingDown) {
      throw new Error('Cannot add tasks while shutting down');
    }

    if (this.options.maxQueueSize > 0 && this.taskQueue.length >= this.options.maxQueueSize) {
      throw new Error(`Task queue is full (max: ${this.options.maxQueueSize})`);
    }

    const task: Task<TInput, TOutput> = {
      id: this.generateTaskId(),
      input,
      status: 'pending',
      retries: 0,
      createdAt: new Date(),
      priority,
    };

    // Insert task in priority order (higher priority first)
    const insertIndex = this.taskQueue.findIndex((t) => t.priority < priority);
    if (insertIndex === -1) {
      this.taskQueue.push(task);
    } else {
      this.taskQueue.splice(insertIndex, 0, task);
    }

    this.emit('taskQueued', task);
    this.processQueue();

    return task;
  }

  /**
   * Add multiple tasks to the queue
   *
   * @param inputs - Array of input data for tasks
   * @param priority - Priority for all tasks
   * @returns Array of created tasks
   */
  addTasks(inputs: TInput[], priority: number = 0): Task<TInput, TOutput>[] {
    return inputs.map((input) => this.addTask(input, priority));
  }

  /**
   * Process a batch of inputs and wait for all results
   *
   * @param inputs - Array of input data to process
   * @param priority - Priority for all tasks
   * @returns Promise resolving to array of task results
   */
  async processBatch(inputs: TInput[], priority: number = 0): Promise<TaskResult<TOutput>[]> {
    if (!this.processor) {
      throw new Error('No processor set. Call setProcessor() first.');
    }

    const tasks = this.addTasks(inputs, priority);
    const taskIds = new Set(tasks.map((t) => t.id));

    return new Promise((resolve) => {
      const results: TaskResult<TOutput>[] = [];
      const checkComplete = (): void => {
        // Collect results for our tasks
        for (const taskId of taskIds) {
          const task = this.completedTasks.get(taskId);
          if (task && !results.some((r) => r.taskId === taskId)) {
            results.push(this.taskToResult(task));
          }
        }

        // Check if all tasks are complete
        if (results.length === tasks.length) {
          // Clean up listeners
          this.off('taskCompleted', onTaskComplete);
          this.off('taskFailed', onTaskFailed);
          this.off('taskTimeout', onTaskTimeout);
          resolve(results);
        }
      };

      const onTaskComplete = (task: Task<TInput, TOutput>): void => {
        if (taskIds.has(task.id)) {
          checkComplete();
        }
      };

      const onTaskFailed = (task: Task<TInput, TOutput>): void => {
        if (taskIds.has(task.id)) {
          checkComplete();
        }
      };

      const onTaskTimeout = (task: Task<TInput, TOutput>): void => {
        if (taskIds.has(task.id)) {
          checkComplete();
        }
      };

      this.on('taskCompleted', onTaskComplete);
      this.on('taskFailed', onTaskFailed);
      this.on('taskTimeout', onTaskTimeout);

      // Check if any tasks are already complete
      checkComplete();
    });
  }

  /**
   * Cancel a specific task
   *
   * @param taskId - ID of the task to cancel
   * @returns True if the task was cancelled
   */
  cancelTask(taskId: string): boolean {
    // Check if task is in queue
    const queueIndex = this.taskQueue.findIndex((t) => t.id === taskId);
    if (queueIndex !== -1) {
      const task = this.taskQueue[queueIndex];
      if (task) {
        task.status = 'cancelled';
        task.completedAt = new Date();
        this.taskQueue.splice(queueIndex, 1);
        this.completedTasks.set(taskId, task);
        this.cancelledCount++;
        return true;
      }
    }

    // Check if task is active (cannot cancel running tasks)
    if (this.activeTasks.has(taskId)) {
      return false;
    }

    return false;
  }

  /**
   * Cancel all pending tasks
   *
   * @returns Number of tasks cancelled
   */
  cancelAllPending(): number {
    let cancelled = 0;
    while (this.taskQueue.length > 0) {
      const task = this.taskQueue.shift();
      if (task) {
        task.status = 'cancelled';
        task.completedAt = new Date();
        this.completedTasks.set(task.id, task);
        this.cancelledCount++;
        cancelled++;
      }
    }
    return cancelled;
  }

  /**
   * Pause task processing
   */
  pause(): void {
    this.isPaused = true;
  }

  /**
   * Resume task processing
   */
  resume(): void {
    this.isPaused = false;
    this.processQueue();
  }

  /**
   * Get the current status of a task
   *
   * @param taskId - ID of the task
   * @returns Task or undefined if not found
   */
  getTask(taskId: string): Task<TInput, TOutput> | undefined {
    // Check active tasks
    const active = this.activeTasks.get(taskId);
    if (active) {return active;}

    // Check completed tasks
    const completed = this.completedTasks.get(taskId);
    if (completed) {return completed;}

    // Check queue
    return this.taskQueue.find((t) => t.id === taskId);
  }

  /**
   * Get current worker pool statistics
   *
   * @returns WorkerPoolStats object
   */
  getStats(): WorkerPoolStats {
    return {
      queuedTasks: this.taskQueue.length,
      activeTasks: this.activeTasks.size,
      completedTasks: this.completedCount,
      failedTasks: this.failedCount,
      cancelledTasks: this.cancelledCount,
      timedOutTasks: this.timedOutCount,
      averageDuration: this.completedCount > 0 ? this.totalDuration / this.completedCount : 0,
      activeWorkers: this.activeTasks.size,
      maxWorkers: this.options.maxWorkers,
      isShuttingDown: this.isShuttingDown,
      isPaused: this.isPaused,
    };
  }

  /**
   * Wait for all current tasks to complete
   *
   * @returns Promise that resolves when all tasks are done
   */
  async drain(): Promise<void> {
    if (this.taskQueue.length === 0 && this.activeTasks.size === 0) {
      return;
    }

    return new Promise((resolve) => {
      const checkDrained = (): void => {
        if (this.taskQueue.length === 0 && this.activeTasks.size === 0) {
          this.off('taskCompleted', checkDrained);
          this.off('taskFailed', checkDrained);
          this.off('taskTimeout', checkDrained);
          this.emit('drained');
          resolve();
        }
      };

      this.on('taskCompleted', checkDrained);
      this.on('taskFailed', checkDrained);
      this.on('taskTimeout', checkDrained);
      checkDrained();
    });
  }

  /**
   * Gracefully shutdown the worker pool
   *
   * Waits for active tasks to complete, cancels pending tasks,
   * and cleans up resources.
   *
   * @param timeout - Maximum time to wait for active tasks (ms)
   * @returns Promise that resolves when shutdown is complete
   */
  async shutdown(timeout: number = 30000): Promise<void> {
    if (this.isShuttingDown) {
      return;
    }

    this.isShuttingDown = true;

    // Cancel all pending tasks
    this.cancelAllPending();

    // Wait for active tasks to complete (with timeout)
    if (this.activeTasks.size > 0) {
      const shutdownPromise = new Promise<void>((resolve) => {
        const checkComplete = (): void => {
          if (this.activeTasks.size === 0) {
            this.off('taskCompleted', checkComplete);
            this.off('taskFailed', checkComplete);
            this.off('taskTimeout', checkComplete);
            resolve();
          }
        };

        this.on('taskCompleted', checkComplete);
        this.on('taskFailed', checkComplete);
        this.on('taskTimeout', checkComplete);
      });

      const timeoutPromise = new Promise<void>((resolve) => {
        setTimeout(() => {
          // Force cancel remaining active tasks
          for (const [taskId, task] of this.activeTasks) {
            task.status = 'cancelled';
            task.completedAt = new Date();
            this.completedTasks.set(taskId, task);
            this.cancelledCount++;
            
            // Clear timeout
            const timeoutId = this.taskTimeouts.get(taskId);
            if (timeoutId) {
              clearTimeout(timeoutId);
              this.taskTimeouts.delete(taskId);
            }
          }
          this.activeTasks.clear();
          resolve();
        }, timeout);
      });

      await Promise.race([shutdownPromise, timeoutPromise]);
    }

    // Clear all timeouts
    for (const timeoutId of this.taskTimeouts.values()) {
      clearTimeout(timeoutId);
    }
    this.taskTimeouts.clear();

    // Clear cache
    this.cache.clear();

    // Emit idle event
    this.emit('idle');
  }

  /**
   * Clear the result cache
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Get the number of items in the cache
   */
  getCacheSize(): number {
    return this.cache.size;
  }

  /**
   * Process tasks from the queue
   */
  private processQueue(): void {
    if (this.isPaused || this.isShuttingDown || !this.processor) {
      return;
    }

    // Process tasks up to maxWorkers limit
    while (
      this.taskQueue.length > 0 &&
      this.activeTasks.size < this.options.maxWorkers
    ) {
      const task = this.taskQueue.shift();
      if (task) {
        this.processTask(task);
      }
    }

    // Check if idle
    if (this.taskQueue.length === 0 && this.activeTasks.size === 0) {
      this.emit('idle');
    }
  }

  /**
   * Process a single task
   */
  private async processTask(task: Task<TInput, TOutput>): Promise<void> {
    if (!this.processor) {
      return;
    }

    task.status = 'running';
    task.startedAt = new Date();
    this.activeTasks.set(task.id, task);
    this.emit('taskStarted', task);

    // Check cache
    if (this.options.enableCaching) {
      const cacheKey = this.getCacheKey(task.input);
      const cached = this.cache.get(cacheKey);
      if (cached !== undefined) {
        this.completeTask(task, cached);
        return;
      }
    }

    // Set up timeout
    const timeoutId = setTimeout(() => {
      this.handleTaskTimeout(task);
    }, this.options.taskTimeout);
    this.taskTimeouts.set(task.id, timeoutId);

    try {
      const result = await this.processor(task.input);
      
      // Clear timeout
      clearTimeout(timeoutId);
      this.taskTimeouts.delete(task.id);

      // Check if task was cancelled or timed out while processing
      if (task.status !== 'running') {
        return;
      }

      this.completeTask(task, result);
    } catch (error) {
      // Clear timeout
      clearTimeout(timeoutId);
      this.taskTimeouts.delete(task.id);

      // Check if task was cancelled or timed out while processing
      if (task.status !== 'running') {
        return;
      }

      this.handleTaskError(task, error as Error);
    }
  }

  /**
   * Complete a task successfully
   */
  private completeTask(task: Task<TInput, TOutput>, result: TOutput): void {
    task.status = 'completed';
    task.completedAt = new Date();
    task.result = result;

    const duration = task.completedAt.getTime() - (task.startedAt?.getTime() || task.createdAt.getTime());
    this.totalDuration += duration;
    this.completedCount++;

    // Cache result
    if (this.options.enableCaching) {
      const cacheKey = this.getCacheKey(task.input);
      this.cache.set(cacheKey, result);
    }

    this.activeTasks.delete(task.id);
    this.completedTasks.set(task.id, task);

    this.emit('taskCompleted', task, result);
    this.processQueue();
  }

  /**
   * Handle a task error
   */
  private handleTaskError(task: Task<TInput, TOutput>, error: Error): void {
    task.retries++;

    // Check if we should retry
    if (task.retries <= this.options.maxRetries) {
      task.status = 'pending';
      this.activeTasks.delete(task.id);
      
      // Re-add to front of queue for retry
      this.taskQueue.unshift(task);
      this.emit('taskRetried', task, task.retries);
      
      // Use setImmediate to avoid stack overflow on rapid retries
      setImmediate(() => this.processQueue());
      return;
    }

    // Task failed after all retries
    task.status = 'failed';
    task.completedAt = new Date();
    task.error = error.message;
    this.failedCount++;

    this.activeTasks.delete(task.id);
    this.completedTasks.set(task.id, task);

    this.emit('taskFailed', task, error);
    
    // Use setImmediate to process queue after error handling
    setImmediate(() => this.processQueue());
  }

  /**
   * Handle a task timeout
   */
  private handleTaskTimeout(task: Task<TInput, TOutput>): void {
    // Only handle if task is still running
    if (task.status !== 'running') {
      return;
    }

    task.status = 'timeout';
    task.completedAt = new Date();
    task.error = `Task timed out after ${this.options.taskTimeout}ms`;
    this.timedOutCount++;

    this.taskTimeouts.delete(task.id);
    this.activeTasks.delete(task.id);
    this.completedTasks.set(task.id, task);

    this.emit('taskTimeout', task);
    this.processQueue();
  }

  /**
   * Generate a unique task ID
   */
  private generateTaskId(): string {
    return `task-${++this.taskIdCounter}-${Date.now()}`;
  }

  /**
   * Generate a cache key for an input
   */
  private getCacheKey(input: TInput): string {
    return JSON.stringify(input);
  }

  /**
   * Convert a task to a TaskResult
   */
  private taskToResult(task: Task<TInput, TOutput>): TaskResult<TOutput> {
    const duration = task.completedAt && task.startedAt
      ? task.completedAt.getTime() - task.startedAt.getTime()
      : 0;

    const result: TaskResult<TOutput> = {
      taskId: task.id,
      success: task.status === 'completed',
      duration,
      retries: task.retries,
    };

    if (task.result !== undefined) {
      result.result = task.result;
    }

    if (task.error !== undefined) {
      result.error = task.error;
    }

    return result;
  }
}

/**
 * Create a worker pool for file processing
 *
 * Convenience function to create a worker pool configured for file processing.
 *
 * @param processor - Function to process each file
 * @param options - Worker pool options
 * @returns Configured WorkerPool instance
 */
export function createFileProcessorPool<TOutput>(
  processor: TaskProcessor<string, TOutput>,
  options: WorkerPoolOptions = {}
): WorkerPool<string, TOutput> {
  const pool = new WorkerPool<string, TOutput>(options);
  pool.setProcessor(processor);
  return pool;
}
