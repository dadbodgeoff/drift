/**
 * Base Runner - Abstract base class for feature runners
 * 
 * Each runner is responsible for a single feature:
 * - Explaining what it does
 * - Running the actual analysis
 * - Saving results to disk
 * - Returning stats
 * 
 * @module commands/setup/runners/base
 */

import type { FeatureResult } from '../types.js';

export interface RunnerContext {
  rootDir: string;
  verbose: boolean;
}

export abstract class BaseRunner {
  protected readonly rootDir: string;
  protected readonly verbose: boolean;

  constructor(ctx: RunnerContext) {
    this.rootDir = ctx.rootDir;
    this.verbose = ctx.verbose;
  }

  /** Human-readable name */
  abstract get name(): string;

  /** Icon for display */
  abstract get icon(): string;

  /** One-line description */
  abstract get description(): string;

  /** What benefit does this provide? */
  abstract get benefit(): string;

  /** CLI command to run this manually */
  abstract get manualCommand(): string;

  /** Execute the feature and return results */
  abstract run(): Promise<FeatureResult>;
}
