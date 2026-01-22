/**
 * Tests for ThreadedWorkerPool
 *
 * Tests the Piscina-based worker thread pool for parallel file processing.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { ThreadedWorkerPool, getModuleDir } from './threaded-worker-pool.js';
import { fileURLToPath } from 'node:url';

// Get the directory of this test file
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Simple worker that doubles numbers
const SIMPLE_WORKER_CODE = `
export default function(task) {
  return task.value * 2;
}
`;

// Worker that simulates CPU-bound work
const CPU_WORKER_CODE = `
export default function(task) {
  // Simulate CPU work
  let result = 0;
  for (let i = 0; i < task.iterations; i++) {
    result += Math.sqrt(i);
  }
  return { input: task.value, result, iterations: task.iterations };
}
`;

describe('ThreadedWorkerPool', () => {
  let tempDir: string;
  let workerPath: string;

  beforeEach(async () => {
    // Create temp directory for worker files
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'drift-worker-test-'));
  });

  afterEach(async () => {
    // Clean up temp directory
    try {
      await fs.rm(tempDir, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('initialization', () => {
    it('should throw if workerPath is not provided', async () => {
      const pool = new ThreadedWorkerPool();
      await expect(pool.initialize()).rejects.toThrow('workerPath is required');
    });

    it('should throw if trying to run without initialization', async () => {
      workerPath = path.join(tempDir, 'worker.mjs');
      await fs.writeFile(workerPath, SIMPLE_WORKER_CODE);

      const pool = new ThreadedWorkerPool({ workerPath });
      await expect(pool.run({ value: 5 })).rejects.toThrow('Pool not initialized');
    });

    it('should initialize successfully with valid worker', async () => {
      workerPath = path.join(tempDir, 'worker.mjs');
      await fs.writeFile(workerPath, SIMPLE_WORKER_CODE);

      const pool = new ThreadedWorkerPool({ workerPath, maxThreads: 2 });
      await pool.initialize();

      expect(pool.isRunning()).toBe(true);

      await pool.destroy();
    });
  });

  describe('task execution', () => {
    it('should run a single task', async () => {
      workerPath = path.join(tempDir, 'worker.mjs');
      await fs.writeFile(workerPath, SIMPLE_WORKER_CODE);

      const pool = new ThreadedWorkerPool<{ value: number }, number>({
        workerPath,
        maxThreads: 2,
      });
      await pool.initialize();

      const result = await pool.run({ value: 5 });
      expect(result).toBe(10);

      await pool.destroy();
    });

    it('should run batch tasks in parallel', async () => {
      workerPath = path.join(tempDir, 'worker.mjs');
      await fs.writeFile(workerPath, SIMPLE_WORKER_CODE);

      const pool = new ThreadedWorkerPool<{ value: number }, number>({
        workerPath,
        maxThreads: 4,
      });
      await pool.initialize();

      const tasks = [
        { value: 1 },
        { value: 2 },
        { value: 3 },
        { value: 4 },
        { value: 5 },
      ];

      const batchResult = await pool.runBatch(tasks);

      expect(batchResult.results).toHaveLength(5);
      expect(batchResult.errors).toHaveLength(0);
      expect(batchResult.results.sort((a, b) => a - b)).toEqual([2, 4, 6, 8, 10]);

      await pool.destroy();
    });

    it('should handle CPU-bound work across threads', async () => {
      workerPath = path.join(tempDir, 'cpu-worker.mjs');
      await fs.writeFile(workerPath, CPU_WORKER_CODE);

      const pool = new ThreadedWorkerPool<
        { value: number; iterations: number },
        { input: number; result: number; iterations: number }
      >({
        workerPath,
        maxThreads: 4,
      });
      await pool.initialize();

      const tasks = Array.from({ length: 8 }, (_, i) => ({
        value: i,
        iterations: 100000,
      }));

      const startTime = Date.now();
      const batchResult = await pool.runBatch(tasks);
      const duration = Date.now() - startTime;

      expect(batchResult.results).toHaveLength(8);
      expect(batchResult.errors).toHaveLength(0);

      // Verify results
      for (const result of batchResult.results) {
        expect(result.iterations).toBe(100000);
        expect(result.result).toBeGreaterThan(0);
      }

      await pool.destroy();
    });
  });

  describe('statistics', () => {
    it('should track pool statistics', async () => {
      workerPath = path.join(tempDir, 'worker.mjs');
      await fs.writeFile(workerPath, SIMPLE_WORKER_CODE);

      const pool = new ThreadedWorkerPool<{ value: number }, number>({
        workerPath,
        maxThreads: 2,
      });
      await pool.initialize();

      // Run some tasks
      await pool.runBatch([{ value: 1 }, { value: 2 }, { value: 3 }]);

      const stats = pool.getStats();
      expect(stats.completed).toBe(3);
      expect(stats.threads).toBeGreaterThan(0);
      expect(stats.isRunning).toBe(true);

      await pool.destroy();

      const afterStats = pool.getStats();
      expect(afterStats.isRunning).toBe(false);
    });
  });

  describe('error handling', () => {
    it('should handle worker errors gracefully', async () => {
      const errorWorkerCode = `
export default function(task) {
  if (task.shouldFail) {
    throw new Error('Intentional failure');
  }
  return task.value * 2;
}
`;
      workerPath = path.join(tempDir, 'error-worker.mjs');
      await fs.writeFile(workerPath, errorWorkerCode);

      const pool = new ThreadedWorkerPool<{ value: number; shouldFail?: boolean }, number>({
        workerPath,
        maxThreads: 2,
      });
      await pool.initialize();

      const tasks = [
        { value: 1, shouldFail: false },
        { value: 2, shouldFail: true },
        { value: 3, shouldFail: false },
      ];

      const batchResult = await pool.runBatch(tasks);

      expect(batchResult.results).toHaveLength(2);
      expect(batchResult.errors).toHaveLength(1);
      expect(batchResult.errors[0].index).toBe(1);
      expect(batchResult.errors[0].error).toContain('Intentional failure');

      await pool.destroy();
    });

    it('should throw when running on destroyed pool', async () => {
      workerPath = path.join(tempDir, 'worker.mjs');
      await fs.writeFile(workerPath, SIMPLE_WORKER_CODE);

      const pool = new ThreadedWorkerPool<{ value: number }, number>({
        workerPath,
        maxThreads: 2,
      });
      await pool.initialize();
      await pool.destroy();

      await expect(pool.run({ value: 5 })).rejects.toThrow('Pool has been destroyed');
    });
  });

  describe('events', () => {
    it('should emit taskComplete events', async () => {
      workerPath = path.join(tempDir, 'worker.mjs');
      await fs.writeFile(workerPath, SIMPLE_WORKER_CODE);

      const pool = new ThreadedWorkerPool<{ value: number }, number>({
        workerPath,
        maxThreads: 2,
      });
      await pool.initialize();

      const completedResults: number[] = [];
      pool.on('taskComplete', (result) => {
        completedResults.push(result as number);
      });

      await pool.runBatch([{ value: 1 }, { value: 2 }]);

      expect(completedResults).toHaveLength(2);
      expect(completedResults.sort((a, b) => a - b)).toEqual([2, 4]);

      await pool.destroy();
    });

    it('should emit drain event when queue is empty', async () => {
      workerPath = path.join(tempDir, 'worker.mjs');
      await fs.writeFile(workerPath, SIMPLE_WORKER_CODE);

      const pool = new ThreadedWorkerPool<{ value: number }, number>({
        workerPath,
        maxThreads: 2,
      });
      await pool.initialize();

      let drained = false;
      pool.on('drain', () => {
        drained = true;
      });

      await pool.runBatch([{ value: 1 }]);

      expect(drained).toBe(true);

      await pool.destroy();
    });
  });
});

describe('getModuleDir', () => {
  it('should return directory of module', () => {
    const dir = getModuleDir(import.meta.url);
    expect(dir).toContain('scanner');
  });
});
