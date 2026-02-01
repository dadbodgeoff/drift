/**
 * Call Graph Runner - Builds the call graph using native Rust or TypeScript fallback
 * 
 * @module commands/setup/runners/callgraph
 */

import { BaseRunner, type RunnerContext } from './base.js';
import { createSpinner } from '../../../ui/spinner.js';
import type { FeatureResult } from '../types.js';

import {
  isNativeAvailable,
  buildCallGraph,
  createStreamingCallGraphBuilder,
} from 'driftdetect-core';

export class CallGraphRunner extends BaseRunner {
  constructor(ctx: RunnerContext) {
    super(ctx);
  }

  get name(): string {
    return 'Call Graph Analysis';
  }

  get icon(): string {
    return '📊';
  }

  get description(): string {
    return 'Maps function calls to understand code flow and data access.';
  }

  get benefit(): string {
    return 'Answer: "What data can this code access?" and "Who calls this?"';
  }

  get manualCommand(): string {
    return 'drift callgraph build';
  }

  async run(): Promise<FeatureResult> {
    const spinner = createSpinner('Building call graph...');
    spinner.start();

    try {
      // Try native Rust first (faster, memory-safe)
      if (isNativeAvailable()) {
        spinner.text('Building call graph (native Rust)...');
        const result = await buildCallGraph({ root: this.rootDir, patterns: [] });

        spinner.succeed(`Call graph built: ${result.totalFunctions} functions, ${result.entryPoints} entry points`);

        return {
          enabled: true,
          success: true,
          timestamp: new Date().toISOString(),
          stats: {
            functions: result.totalFunctions,
            callSites: result.totalCalls,
            resolvedCalls: result.resolvedCalls,
            entryPoints: result.entryPoints,
            dataAccessors: result.dataAccessors,
            filesProcessed: result.filesProcessed,
          },
        };
      }

      // TypeScript fallback
      spinner.text('Building call graph (TypeScript)...');
      const builder = createStreamingCallGraphBuilder({
        rootDir: this.rootDir,
        onProgress: (current: number, total: number) => {
          spinner.text(`Building call graph... ${current}/${total} files`);
        },
      });

      const result = await builder.build([
        '**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx', '**/*.py',
      ]);

      spinner.succeed(`Call graph built: ${result.totalFunctions} functions, ${result.entryPoints} entry points`);

      return {
        enabled: true,
        success: true,
        timestamp: new Date().toISOString(),
        stats: {
          functions: result.totalFunctions,
          callSites: result.totalCalls,
          resolvedCalls: result.resolvedCalls,
          entryPoints: result.entryPoints,
          dataAccessors: result.dataAccessors,
          filesProcessed: result.filesProcessed,
        },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      spinner.fail(`Call graph failed: ${msg}`);

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
