/**
 * SQLite Sync Runner - Syncs all data to drift.db
 * 
 * @module commands/setup/runners/sqlite-sync
 */

import { BaseRunner, type RunnerContext } from './base.js';
import { createSpinner } from '../../../ui/spinner.js';
import type { FeatureResult } from '../types.js';

import { StoreSyncService } from 'driftdetect-core/storage';

export class SqliteSyncRunner extends BaseRunner {
  constructor(ctx: RunnerContext) {
    super(ctx);
  }

  get name(): string {
    return 'SQLite Sync';
  }

  get icon(): string {
    return '💾';
  }

  get description(): string {
    return 'Syncs all data to drift.db (single source of truth).';
  }

  get benefit(): string {
    return 'Enables cloud sync and unified data access.';
  }

  get manualCommand(): string {
    return 'drift sync';
  }

  async run(): Promise<FeatureResult> {
    const spinner = createSpinner('Syncing to SQLite...');
    spinner.start();

    try {
      const syncService = new StoreSyncService({ 
        rootDir: this.rootDir, 
        verbose: this.verbose 
      });
      
      await syncService.initialize();
      const result = await syncService.syncAll();
      await syncService.close();

      if (!result.success) {
        spinner.fail(`Sync failed: ${result.errors.join(', ')}`);
        return {
          enabled: true,
          success: false,
          error: result.errors.join(', '),
        };
      }

      // Calculate total synced items
      const totalSynced = 
        result.synced.boundaries +
        result.synced.environment +
        result.synced.callGraph.functions +
        result.synced.callGraph.calls +
        result.synced.audit.snapshots +
        result.synced.dna.genes +
        result.synced.testTopology.files +
        result.synced.contracts.contracts +
        result.synced.constraints +
        result.synced.history;

      spinner.succeed(`Synced ${totalSynced} items to drift.db`);

      return {
        enabled: true,
        success: true,
        timestamp: new Date().toISOString(),
        stats: {
          boundaries: result.synced.boundaries,
          environment: result.synced.environment,
          functions: result.synced.callGraph.functions,
          calls: result.synced.callGraph.calls,
          dataAccess: result.synced.callGraph.dataAccess,
          auditSnapshots: result.synced.audit.snapshots,
          auditTrends: result.synced.audit.trends,
          dnaGenes: result.synced.dna.genes,
          dnaMutations: result.synced.dna.mutations,
          testFiles: result.synced.testTopology.files,
          testCoverage: result.synced.testTopology.coverage,
          contracts: result.synced.contracts.contracts,
          contractFrontends: result.synced.contracts.frontends,
          constraints: result.synced.constraints,
          history: result.synced.history,
          total: totalSynced,
        },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      spinner.fail(`SQLite sync failed: ${msg}`);

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
