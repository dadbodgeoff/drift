/**
 * Constraints Runner - Extracts architectural constraints from approved patterns
 * 
 * @module commands/setup/runners/constraints
 */

import { BaseRunner, type RunnerContext } from './base.js';
import { createSpinner } from '../../../ui/spinner.js';
import type { FeatureResult } from '../types.js';

import { 
  createInvariantDetector, 
  createConstraintStore,
  createConstraintSynthesizer,
} from 'driftdetect-core';
import { createPatternStore } from 'driftdetect-core/storage';

export class ConstraintsRunner extends BaseRunner {
  constructor(ctx: RunnerContext) {
    super(ctx);
  }

  get name(): string {
    return 'Constraint Extraction';
  }

  get icon(): string {
    return '📏';
  }

  get description(): string {
    return 'Extracts architectural constraints from approved patterns.';
  }

  get benefit(): string {
    return 'Enforce coding standards automatically in CI/CD.';
  }

  get manualCommand(): string {
    return 'drift constraints extract';
  }

  async run(): Promise<FeatureResult> {
    const spinner = createSpinner('Extracting constraints...');
    spinner.start();

    try {
      // Initialize constraint store
      const store = createConstraintStore({ rootDir: this.rootDir });
      await store.initialize();

      // Load pattern store to get approved patterns (SQLite-backed)
      const patternStore = await createPatternStore({ rootDir: this.rootDir });
      
      // Create invariant detector with pattern store
      const detector = createInvariantDetector({
        rootDir: this.rootDir,
        patternStore: patternStore as any,
      });

      // Create synthesizer to save constraints
      const synthesizer = createConstraintSynthesizer({ store, detector });

      // Extract and save constraints
      const result = await synthesizer.synthesize({
        minConfidence: 0.85,
      });

      spinner.succeed(`Extracted ${result.discovered.length} constraints`);

      // Count by category
      const byCategory: Record<string, number> = {};
      for (const c of result.discovered) {
        const category = c.category ?? 'unknown';
        byCategory[category] = (byCategory[category] ?? 0) + 1;
      }

      return {
        enabled: true,
        success: true,
        timestamp: new Date().toISOString(),
        stats: {
          constraints: result.discovered.length,
          updated: result.updated.length,
          invalidated: result.invalidated.length,
          ...byCategory,
        },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      spinner.fail(`Constraint extraction failed: ${msg}`);

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
