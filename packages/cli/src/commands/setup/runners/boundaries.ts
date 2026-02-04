/**
 * Boundaries Runner - Scans for data access boundaries
 * 
 * @module commands/setup/runners/boundaries
 */

import { BaseRunner, type RunnerContext } from './base.js';
import { createSpinner } from '../../../ui/spinner.js';
import type { FeatureResult } from '../types.js';

import {
  isNativeAvailable,
  scanBoundariesWithFallback,
  FileWalker,
  getDefaultIgnorePatterns,
} from 'driftdetect-core';

import { createBoundaryScanner } from '../../../services/boundary-scanner.js';

export class BoundariesRunner extends BaseRunner {
  constructor(ctx: RunnerContext) {
    super(ctx);
  }

  get name(): string {
    return 'Data Boundaries';
  }

  get icon(): string {
    return '🗄️';
  }

  get description(): string {
    return 'Tracks which code accesses which database tables and fields.';
  }

  get benefit(): string {
    return 'Detect sensitive data access and enforce data boundaries.';
  }

  get manualCommand(): string {
    return 'drift scan';
  }

  async run(): Promise<FeatureResult> {
    const spinner = createSpinner('Scanning for data boundaries...');
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
        spinner.text('Scanning data boundaries (native Rust)...');
        
        const nativeResult = await scanBoundariesWithFallback(this.rootDir, files);
        
        spinner.succeed(
          `Found ${nativeResult.models?.length ?? 0} models, ` +
          `${nativeResult.accessPoints?.length ?? 0} access points`
        );

        return {
          enabled: true,
          success: true,
          timestamp: new Date().toISOString(),
          stats: {
            models: nativeResult.models?.length ?? 0,
            accessPoints: nativeResult.accessPoints?.length ?? 0,
            sensitiveFields: nativeResult.sensitiveFields?.length ?? 0,
            filesScanned: nativeResult.filesScanned ?? 0,
          },
        };
      }

      // TypeScript fallback
      spinner.text('Scanning data boundaries (TypeScript)...');
      const boundaryScanner = createBoundaryScanner({ rootDir: this.rootDir, verbose: this.verbose });
      await boundaryScanner.initialize();
      
      const boundaryResult = await boundaryScanner.scanFiles(files);

      spinner.succeed(
        `Found ${boundaryResult.stats.tablesFound} tables, ` +
        `${boundaryResult.stats.accessPointsFound} access points`
      );

      return {
        enabled: true,
        success: true,
        timestamp: new Date().toISOString(),
        stats: {
          tables: boundaryResult.stats.tablesFound,
          accessPoints: boundaryResult.stats.accessPointsFound,
          sensitiveFields: boundaryResult.stats.sensitiveFieldsFound,
        },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      spinner.fail(`Boundary scan failed: ${msg}`);

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
