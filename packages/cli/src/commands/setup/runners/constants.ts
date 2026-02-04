/**
 * Constants Runner - Extracts constants and enums from codebase
 * 
 * @module commands/setup/runners/constants
 */

import { BaseRunner, type RunnerContext } from './base.js';
import { createSpinner } from '../../../ui/spinner.js';
import type { FeatureResult } from '../types.js';

import {
  analyzeConstantsWithFallback,
  FileWalker,
  getDefaultIgnorePatterns,
} from 'driftdetect-core';

export class ConstantsRunner extends BaseRunner {
  constructor(ctx: RunnerContext) {
    super(ctx);
  }

  get name(): string {
    return 'Constants Extraction';
  }

  get icon(): string {
    return '📋';
  }

  get description(): string {
    return 'Extracts constants, enums, and detects magic values.';
  }

  get benefit(): string {
    return 'Find hardcoded secrets, magic numbers, and inconsistent values.';
  }

  get manualCommand(): string {
    return 'drift constants';
  }

  async run(): Promise<FeatureResult> {
    const spinner = createSpinner('Extracting constants...');
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
      const files = result.files.map(f => f.relativePath);

      // Use native/fallback analyzer
      spinner.text('Extracting constants...');
      
      const nativeResult = await analyzeConstantsWithFallback(this.rootDir, files);
      
      const constantCount = nativeResult.constants?.length ?? 0;
      const secretCount = nativeResult.secrets?.length ?? 0;
      const magicCount = nativeResult.magicNumbers?.length ?? 0;
      
      spinner.succeed(
        `Found ${constantCount} constants ` +
        `(${secretCount} potential secrets, ${magicCount} magic numbers)`
      );

      return {
        enabled: true,
        success: true,
        timestamp: new Date().toISOString(),
        stats: {
          constants: constantCount,
          secretCandidates: secretCount,
          magicNumbers: magicCount,
          inconsistencies: nativeResult.inconsistencies?.length ?? 0,
        },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      spinner.fail(`Constants extraction failed: ${msg}`);

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
