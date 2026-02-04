/**
 * Environment Runner - Scans for environment variable usage
 * 
 * @module commands/setup/runners/environment
 */

import { BaseRunner, type RunnerContext } from './base.js';
import { createSpinner } from '../../../ui/spinner.js';
import type { FeatureResult } from '../types.js';

import {
  isNativeAvailable,
  analyzeEnvironmentWithFallback,
  FileWalker,
  getDefaultIgnorePatterns,
  createEnvScanner,
} from 'driftdetect-core';

export class EnvironmentRunner extends BaseRunner {
  constructor(ctx: RunnerContext) {
    super(ctx);
  }

  get name(): string {
    return 'Environment Variables';
  }

  get icon(): string {
    return '🔐';
  }

  get description(): string {
    return 'Discovers environment variable usage and classifies sensitivity.';
  }

  get benefit(): string {
    return 'Track secrets, credentials, and config across your codebase.';
  }

  get manualCommand(): string {
    return 'drift env scan';
  }

  async run(): Promise<FeatureResult> {
    const spinner = createSpinner('Scanning for environment variables...');
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

      // Try native Rust first (faster)
      if (isNativeAvailable()) {
        spinner.text('Scanning environment variables (native Rust)...');
        
        const nativeResult = await analyzeEnvironmentWithFallback(this.rootDir, files);
        
        const secretCount = nativeResult.variables?.filter(v => v.sensitivity === 'secret').length ?? 0;
        const credentialCount = nativeResult.variables?.filter(v => v.sensitivity === 'credential').length ?? 0;
        
        spinner.succeed(
          `Found ${nativeResult.variables?.length ?? 0} env vars ` +
          `(${secretCount} secrets, ${credentialCount} credentials)`
        );

        return {
          enabled: true,
          success: true,
          timestamp: new Date().toISOString(),
          stats: {
            variables: nativeResult.variables?.length ?? 0,
            secrets: secretCount,
            credentials: credentialCount,
            accessPoints: nativeResult.stats?.totalAccesses ?? 0,
          },
        };
      }

      // TypeScript fallback
      spinner.text('Scanning environment variables (TypeScript)...');
      const envScanner = createEnvScanner({ rootDir: this.rootDir });
      const envResult = await envScanner.scanFiles(files);

      const secretCount = Object.values(envResult.accessMap.variables)
        .filter(v => v.sensitivity === 'secret').length;
      const credentialCount = Object.values(envResult.accessMap.variables)
        .filter(v => v.sensitivity === 'credential').length;

      spinner.succeed(
        `Found ${Object.keys(envResult.accessMap.variables).length} env vars ` +
        `(${secretCount} secrets, ${credentialCount} credentials)`
      );

      return {
        enabled: true,
        success: true,
        timestamp: new Date().toISOString(),
        stats: {
          variables: Object.keys(envResult.accessMap.variables).length,
          secrets: secretCount,
          credentials: credentialCount,
          accessPoints: Object.keys(envResult.accessMap.accessPoints).length,
        },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      spinner.fail(`Environment scan failed: ${msg}`);

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
