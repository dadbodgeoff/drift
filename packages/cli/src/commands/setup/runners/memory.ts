/**
 * Memory Runner - Initializes Cortex memory system
 * 
 * @module commands/setup/runners/memory
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { BaseRunner, type RunnerContext } from './base.js';
import { createSpinner } from '../../../ui/spinner.js';
import { DRIFT_DIR, type FeatureResult } from '../types.js';

export class MemoryRunner extends BaseRunner {
  constructor(ctx: RunnerContext) {
    super(ctx);
  }

  get name(): string {
    return 'Cortex Memory';
  }

  get icon(): string {
    return '🧠';
  }

  get description(): string {
    return 'Living knowledge system that learns and adapts.';
  }

  get benefit(): string {
    return 'AI retrieves relevant context based on what you\'re doing';
  }

  get manualCommand(): string {
    return 'drift memory init';
  }

  async run(): Promise<FeatureResult> {
    const spinner = createSpinner('Initializing memory...');
    spinner.start();

    try {
      // Ensure memory directory exists
      const memoryDir = path.join(this.rootDir, DRIFT_DIR, 'memory');
      await fs.mkdir(memoryDir, { recursive: true });

      // Import and initialize Cortex
      spinner.text('Setting up Cortex database...');
      const { getCortex } = await import('driftdetect-cortex');

      const dbPath = path.join(memoryDir, 'cortex.db');
      const cortex = await getCortex({
        storage: { type: 'sqlite', sqlitePath: dbPath },
        autoInitialize: true,
      });

      // Close connection (will reopen when needed)
      await cortex.storage.close();

      spinner.succeed('Cortex memory system initialized');

      return {
        enabled: true,
        success: true,
        timestamp: new Date().toISOString(),
        stats: {
          initialized: 1,
        },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      spinner.fail(`Memory init failed: ${msg}`);

      if (this.verbose && error instanceof Error) {
        console.error(error.stack);
      }

      return {
        enabled: true,
        success: false,
        error: msg,
      };
    }
  }
}
