/**
 * DNA Runner - Analyzes styling patterns and code DNA
 * 
 * @module commands/setup/runners/dna
 */

import { BaseRunner, type RunnerContext } from './base.js';
import { createSpinner } from '../../../ui/spinner.js';
import type { FeatureResult } from '../types.js';

import { DNAAnalyzer, DNAStore } from 'driftdetect-core';

export class DNARunner extends BaseRunner {
  constructor(ctx: RunnerContext) {
    super(ctx);
  }

  get name(): string {
    return 'Styling DNA';
  }

  get icon(): string {
    return '🧬';
  }

  get description(): string {
    return 'Analyzes frontend styling patterns (variants, spacing, theming).';
  }

  get benefit(): string {
    return 'AI generates components matching your exact style';
  }

  get manualCommand(): string {
    return 'drift dna scan';
  }

  async run(): Promise<FeatureResult> {
    const spinner = createSpinner('Scanning DNA...');
    spinner.start();

    try {
      spinner.text('Initializing DNA analyzer...');
      const analyzer = new DNAAnalyzer({ rootDir: this.rootDir, mode: 'all' });
      await analyzer.initialize();

      spinner.text('Analyzing styling patterns...');
      const result = await analyzer.analyze();

      // Save profile
      spinner.text('Saving DNA profile...');
      const store = new DNAStore({ rootDir: this.rootDir });
      await store.save(result.profile);

      const geneCount = Object.keys(result.profile.genes).length;
      const healthScore = result.profile.summary.healthScore;

      spinner.succeed(`DNA profile created: ${geneCount} genes, ${healthScore}/100 health`);

      return {
        enabled: true,
        success: true,
        timestamp: new Date().toISOString(),
        stats: {
          genes: geneCount,
          mutations: result.profile.mutations.length,
          healthScore,
          filesAnalyzed: result.stats.filesAnalyzed,
          componentFiles: result.stats.componentFiles,
          backendFiles: result.stats.backendFiles,
        },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      spinner.fail(`DNA scan failed: ${msg}`);

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
