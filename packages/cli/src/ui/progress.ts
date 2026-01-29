/**
 * Progress - Progress bars for scanning
 *
 * Provides progress bars for long-running operations like scanning.
 *
 * @requirements 29.1
 */

import chalk from 'chalk';
import { SingleBar, MultiBar, Presets } from 'cli-progress';

/**
 * Progress bar configuration options
 */
export interface ProgressOptions {
  /** Total number of items */
  total: number;
  /** Format string for the progress bar */
  format?: string;
  /** Whether to show ETA */
  showEta?: boolean;
  /** Whether to show percentage */
  showPercentage?: boolean;
  /** Whether to show value/total */
  showValue?: boolean;
  /** Whether progress is enabled (false in CI mode) */
  enabled?: boolean;
  /** Clear the bar on complete */
  clearOnComplete?: boolean;
  /** Hide cursor during progress */
  hideCursor?: boolean;
}

/**
 * Default format string for progress bars
 */
const DEFAULT_FORMAT = `${chalk.cyan('{bar}')} {percentage}% | {value}/{total} | {task}`;

/**
 * Scanning format string
 */
const SCAN_FORMAT = `${chalk.cyan('{bar}')} {percentage}% | {value}/{total} files | ETA: {eta}s | {task}`;

/**
 * Progress bar wrapper for consistent CLI feedback
 */
export class Progress {
  private bar: SingleBar;
  private enabled: boolean;
  private currentValue: number = 0;

  constructor(options: ProgressOptions) {
    this.enabled = options.enabled ?? !process.env['CI'];

    const format = options.format ?? DEFAULT_FORMAT;

    this.bar = new SingleBar(
      {
        format,
        barCompleteChar: '\u2588',
        barIncompleteChar: '\u2591',
        hideCursor: options.hideCursor ?? true,
        clearOnComplete: options.clearOnComplete ?? false,
        stopOnComplete: true,
        etaBuffer: 50,
        fps: 10,
      },
      Presets.shades_classic
    );

    if (this.enabled) {
      this.bar.start(options.total, 0, { task: '' });
    }
  }

  /**
   * Update progress with current value
   */
  update(value: number, payload?: Record<string, string | number>): this {
    this.currentValue = value;
    if (this.enabled) {
      this.bar.update(value, payload);
    }
    return this;
  }

  /**
   * Increment progress by amount
   */
  increment(amount = 1, payload?: Record<string, string | number>): this {
    this.currentValue += amount;
    if (this.enabled) {
      this.bar.increment(amount, payload);
    }
    return this;
  }

  /**
   * Set the current task description
   */
  task(description: string): this {
    if (this.enabled) {
      this.bar.update(this.currentValue, { task: description });
    }
    return this;
  }

  /**
   * Set the total value
   */
  setTotal(total: number): this {
    if (this.enabled) {
      this.bar.setTotal(total);
    }
    return this;
  }

  /**
   * Stop the progress bar
   */
  stop(): this {
    if (this.enabled) {
      this.bar.stop();
    }
    return this;
  }

  /**
   * Get current value
   */
  get value(): number {
    return this.currentValue;
  }
}

/**
 * Multi-progress bar for parallel operations
 */
export class MultiProgress {
  private multiBar: MultiBar;
  private bars: Map<string, SingleBar> = new Map();
  private enabled: boolean;

  constructor(enabled?: boolean) {
    this.enabled = enabled ?? !process.env['CI'];

    this.multiBar = new MultiBar(
      {
        format: `${chalk.cyan('{bar}')} {percentage}% | {name}: {task}`,
        barCompleteChar: '\u2588',
        barIncompleteChar: '\u2591',
        hideCursor: true,
        clearOnComplete: false,
        stopOnComplete: false,
        fps: 10,
      },
      Presets.shades_classic
    );
  }

  /**
   * Create a new progress bar
   */
  create(name: string, total: number): SingleBar | null {
    if (!this.enabled) {
      return null;
    }

    const bar = this.multiBar.create(total, 0, { name, task: '' });
    this.bars.set(name, bar);
    return bar;
  }

  /**
   * Update a specific bar
   */
  update(name: string, value: number, payload?: Record<string, string | number>): this {
    if (this.enabled) {
      const bar = this.bars.get(name);
      if (bar) {
        bar.update(value, payload);
      }
    }
    return this;
  }

  /**
   * Increment a specific bar
   */
  increment(name: string, amount = 1, payload?: Record<string, string | number>): this {
    if (this.enabled) {
      const bar = this.bars.get(name);
      if (bar) {
        bar.increment(amount, payload);
      }
    }
    return this;
  }

  /**
   * Remove a specific bar
   */
  remove(name: string): this {
    if (this.enabled) {
      const bar = this.bars.get(name);
      if (bar) {
        this.multiBar.remove(bar);
        this.bars.delete(name);
      }
    }
    return this;
  }

  /**
   * Stop all progress bars
   */
  stop(): this {
    if (this.enabled) {
      this.multiBar.stop();
    }
    return this;
  }
}

/**
 * Create a progress bar for scanning operations
 */
export function createScanProgress(totalFiles: number): Progress {
  return new Progress({
    total: totalFiles,
    format: SCAN_FORMAT,
    showEta: true,
    clearOnComplete: true,
  });
}

/**
 * Create a progress bar for analysis operations
 */
export function createAnalysisProgress(totalItems: number): Progress {
  return new Progress({
    total: totalItems,
    format: `${chalk.blue('{bar}')} {percentage}% | Analyzing: {task}`,
    clearOnComplete: true,
  });
}

/**
 * Create a progress bar for pattern detection
 */
export function createDetectionProgress(totalDetectors: number): Progress {
  return new Progress({
    total: totalDetectors,
    format: `${chalk.magenta('{bar}')} {percentage}% | Running: {task}`,
    clearOnComplete: true,
  });
}

/**
 * Run an operation with progress tracking
 */
export async function withProgress<T>(
  items: T[],
  operation: (item: T, index: number) => Promise<void>,
  options?: {
    format?: string;
    getTaskName?: (item: T) => string;
  }
): Promise<void> {
  const progressOptions: ProgressOptions = {
    total: items.length,
  };
  if (options?.format) {
    progressOptions.format = options.format;
  }

  const progress = new Progress(progressOptions);

  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    const taskName = options?.getTaskName?.(item) ?? `Item ${i + 1}`;
    progress.task(taskName);

    await operation(item, i);
    progress.increment();
  }

  progress.stop();
}

/**
 * Simple percentage display for CI mode
 */
export function logProgress(current: number, total: number, message?: string): void {
  const percentage = Math.round((current / total) * 100);
  const msg = message ? ` - ${message}` : '';
  console.log(`[${percentage}%] ${current}/${total}${msg}`);
}
