/**
 * Error Handling Runner - Analyzes error handling patterns
 * 
 * @module commands/setup/runners/error-handling
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { BaseRunner, type RunnerContext } from './base.js';
import { createSpinner } from '../../../ui/spinner.js';
import type { FeatureResult } from '../types.js';

import {
  isNativeAvailable,
  analyzeErrorHandling,
  FileWalker,
  getDefaultIgnorePatterns,
} from 'driftdetect-core';

const DRIFT_DIR = '.drift';
const ERROR_HANDLING_DIR = 'error-handling';

export class ErrorHandlingRunner extends BaseRunner {
  constructor(ctx: RunnerContext) {
    super(ctx);
  }

  get name(): string {
    return 'Error Handling Analysis';
  }

  get icon(): string {
    return '⚠️';
  }

  get description(): string {
    return 'Detects error handling gaps and boundaries.';
  }

  get benefit(): string {
    return 'Find unhandled errors and swallowed exceptions.';
  }

  get manualCommand(): string {
    return 'drift error-handling';
  }

  async run(): Promise<FeatureResult> {
    const spinner = createSpinner('Analyzing error handling...');
    spinner.start();

    try {
      // Get files to scan
      const walker = new FileWalker();
      const result = await walker.walk({
        rootDir: this.rootDir,
        ignorePatterns: getDefaultIgnorePatterns(),
        respectGitignore: true,
        respectDriftignore: true,
      });
      const files = result.files.map(f => path.join(this.rootDir, f.relativePath));

      // Native Rust analyzer
      if (isNativeAvailable()) {
        spinner.text('Analyzing error handling (native Rust)...');
        
        const nativeResult = await analyzeErrorHandling(files);
        
        const criticalGaps = nativeResult.gaps?.filter(g => g.severity === 'critical').length ?? 0;
        
        // Save the analysis results
        const errorDir = path.join(this.rootDir, DRIFT_DIR, ERROR_HANDLING_DIR);
        await fs.mkdir(errorDir, { recursive: true });
        
        await fs.writeFile(
          path.join(errorDir, 'analysis.json'),
          JSON.stringify({
            boundaries: nativeResult.boundaries ?? [],
            gaps: nativeResult.gaps ?? [],
            filesAnalyzed: nativeResult.filesAnalyzed ?? 0,
            durationMs: nativeResult.durationMs ?? 0,
            generatedAt: new Date().toISOString(),
          }, null, 2)
        );
        
        spinner.succeed(
          `Found ${nativeResult.boundaries?.length ?? 0} error boundaries, ` +
          `${nativeResult.gaps?.length ?? 0} gaps (${criticalGaps} critical)`
        );

        return {
          enabled: true,
          success: true,
          timestamp: new Date().toISOString(),
          stats: {
            boundaries: nativeResult.boundaries?.length ?? 0,
            gaps: nativeResult.gaps?.length ?? 0,
            criticalGaps,
            filesAnalyzed: nativeResult.filesAnalyzed ?? 0,
          },
        };
      }

      // No TypeScript fallback for error handling analysis
      spinner.warn('Error handling analysis requires native module');
      
      return {
        enabled: true,
        success: false,
        error: 'Native module required for error handling analysis',
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      spinner.fail(`Error handling analysis failed: ${msg}`);

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
