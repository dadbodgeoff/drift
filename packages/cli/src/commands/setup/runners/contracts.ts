/**
 * Contracts Runner - Scans for BE↔FE API contracts
 * 
 * @module commands/setup/runners/contracts
 */

import { BaseRunner, type RunnerContext } from './base.js';
import { createSpinner } from '../../../ui/spinner.js';
import type { FeatureResult } from '../types.js';

import { FileWalker, getDefaultIgnorePatterns } from 'driftdetect-core';
import { createContractScanner } from '../../../services/contract-scanner.js';

export class ContractsRunner extends BaseRunner {
  constructor(ctx: RunnerContext) {
    super(ctx);
  }

  get name(): string {
    return 'BE↔FE Contracts';
  }

  get icon(): string {
    return '🔗';
  }

  get description(): string {
    return 'Detects API contracts between backend and frontend code.';
  }

  get benefit(): string {
    return 'Find API mismatches before they cause runtime errors.';
  }

  get manualCommand(): string {
    return 'drift scan';
  }

  async run(): Promise<FeatureResult> {
    const spinner = createSpinner('Scanning for BE↔FE contracts...');
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

      const contractScanner = createContractScanner({ rootDir: this.rootDir, verbose: this.verbose });
      await contractScanner.initialize();
      const contractResult = await contractScanner.scanFiles(files);

      spinner.succeed(
        `Found ${contractResult.stats.matchedContracts} contracts ` +
        `(${contractResult.stats.mismatches} mismatches)`
      );

      return {
        enabled: true,
        success: true,
        timestamp: new Date().toISOString(),
        stats: {
          contracts: contractResult.stats.matchedContracts,
          mismatches: contractResult.stats.mismatches,
          backendEndpoints: contractResult.stats.backendEndpoints,
          frontendCalls: contractResult.stats.frontendCalls,
        },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      spinner.fail(`Contract scan failed: ${msg}`);

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
