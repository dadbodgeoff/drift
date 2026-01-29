/**
 * Spinner - Progress spinners
 *
 * Provides animated spinners for long-running operations.
 *
 * @requirements 29.1
 */

import chalk from 'chalk';
import ora, { type Ora } from 'ora';

/**
 * Spinner configuration options
 */
export interface SpinnerOptions {
  /** Spinner text */
  text?: string;
  /** Spinner color */
  color?: 'black' | 'red' | 'green' | 'yellow' | 'blue' | 'magenta' | 'cyan' | 'white' | 'gray';
  /** Whether to show spinner (false in CI mode) */
  enabled?: boolean;
}

/**
 * Spinner wrapper for consistent CLI feedback
 */
export class Spinner {
  private spinner: Ora;
  private enabled: boolean;

  constructor(options: SpinnerOptions = {}) {
    this.enabled = options.enabled ?? !process.env['CI'];

    // Build options object conditionally to satisfy exactOptionalPropertyTypes
    const baseOptions = {
      color: options.color ?? 'cyan',
      isEnabled: this.enabled,
    } as const;

    this.spinner = options.text
      ? ora({ ...baseOptions, text: options.text })
      : ora(baseOptions);
  }

  /**
   * Start the spinner with optional text
   */
  start(text?: string): this {
    if (text) {
      this.spinner.text = text;
    }
    this.spinner.start();
    return this;
  }

  /**
   * Stop the spinner with a success message
   */
  succeed(text?: string): this {
    this.spinner.succeed(text);
    return this;
  }

  /**
   * Stop the spinner with a failure message
   */
  fail(text?: string): this {
    this.spinner.fail(text);
    return this;
  }

  /**
   * Stop the spinner with a warning message
   */
  warn(text?: string): this {
    this.spinner.warn(text);
    return this;
  }

  /**
   * Stop the spinner with an info message
   */
  info(text?: string): this {
    this.spinner.info(text);
    return this;
  }

  /**
   * Stop the spinner without a status symbol
   */
  stop(): this {
    this.spinner.stop();
    return this;
  }

  /**
   * Update the spinner text
   */
  text(text: string): this {
    this.spinner.text = text;
    return this;
  }

  /**
   * Update the spinner color
   */
  color(
    color: 'black' | 'red' | 'green' | 'yellow' | 'blue' | 'magenta' | 'cyan' | 'white' | 'gray'
  ): this {
    this.spinner.color = color;
    return this;
  }

  /**
   * Check if spinner is currently spinning
   */
  get isSpinning(): boolean {
    return this.spinner.isSpinning;
  }
}

/**
 * Create a new spinner instance
 */
export function createSpinner(textOrOptions?: string | SpinnerOptions): Spinner {
  if (typeof textOrOptions === 'string') {
    return new Spinner({ text: textOrOptions });
  }
  return new Spinner(textOrOptions);
}

/**
 * Run an async operation with a spinner
 */
export async function withSpinner<T>(
  text: string,
  operation: () => Promise<T>,
  options?: {
    successText?: string | ((result: T) => string);
    failText?: string | ((error: Error) => string);
  }
): Promise<T> {
  const spinner = createSpinner(text);
  spinner.start();

  try {
    const result = await operation();
    const successText =
      typeof options?.successText === 'function'
        ? options.successText(result)
        : options?.successText;
    spinner.succeed(successText);
    return result;
  } catch (error) {
    const failText =
      typeof options?.failText === 'function'
        ? options.failText(error as Error)
        : options?.failText ?? (error as Error).message;
    spinner.fail(failText);
    throw error;
  }
}

/**
 * Pre-configured spinners for common operations
 */
export const spinners = {
  /**
   * Spinner for scanning operations
   */
  scanning(text = 'Scanning codebase...'): Spinner {
    return createSpinner({ text, color: 'cyan' });
  },

  /**
   * Spinner for analysis operations
   */
  analyzing(text = 'Analyzing patterns...'): Spinner {
    return createSpinner({ text, color: 'blue' });
  },

  /**
   * Spinner for loading operations
   */
  loading(text = 'Loading...'): Spinner {
    return createSpinner({ text, color: 'yellow' });
  },

  /**
   * Spinner for saving operations
   */
  saving(text = 'Saving...'): Spinner {
    return createSpinner({ text, color: 'green' });
  },

  /**
   * Spinner for checking operations
   */
  checking(text = 'Checking for violations...'): Spinner {
    return createSpinner({ text, color: 'magenta' });
  },
};

/**
 * Status indicators for non-spinner output
 */
export const status = {
  success(message: string): void {
    console.log(chalk.green('✔'), message);
  },

  error(message: string): void {
    console.log(chalk.red('✖'), message);
  },

  warning(message: string): void {
    console.log(chalk.yellow('⚠'), message);
  },

  info(message: string): void {
    console.log(chalk.blue('ℹ'), message);
  },

  pending(message: string): void {
    console.log(chalk.gray('○'), message);
  },
};
