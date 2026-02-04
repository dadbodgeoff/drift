/**
 * Audit Runner - Creates audit snapshot with health score
 * 
 * @module commands/setup/runners/audit
 */

import { BaseRunner, type RunnerContext } from './base.js';
import { createSpinner } from '../../../ui/spinner.js';
import type { FeatureResult } from '../types.js';

import { AuditEngine, AuditStore } from 'driftdetect-core';
import { createPatternStore } from 'driftdetect-core/storage';

export class AuditRunner extends BaseRunner {
  constructor(ctx: RunnerContext) {
    super(ctx);
  }

  get name(): string {
    return 'Audit Snapshot';
  }

  get icon(): string {
    return '📊';
  }

  get description(): string {
    return 'Creates health snapshot and tracks pattern quality.';
  }

  get benefit(): string {
    return 'Monitor codebase health over time.';
  }

  get manualCommand(): string {
    return 'drift audit';
  }

  async run(): Promise<FeatureResult> {
    const spinner = createSpinner('Creating audit snapshot...');
    spinner.start();

    try {
      // Load pattern store
      const patternStore = await createPatternStore({ rootDir: this.rootDir });
      const patterns = patternStore.getAll();
      
      // Create audit engine and store
      const auditEngine = new AuditEngine({ rootDir: this.rootDir });
      const auditStore = new AuditStore({ rootDir: this.rootDir });

      const result = await auditEngine.runAudit(patterns);

      // Save the audit snapshot
      await auditStore.saveAudit(result);

      // healthScore is already 0-100 from AuditEngine
      const healthScore = Math.round(result.summary.healthScore);
      spinner.succeed(`Health score: ${healthScore}%`);

      return {
        enabled: true,
        success: true,
        timestamp: new Date().toISOString(),
        stats: {
          healthScore,
          totalPatterns: result.summary.totalPatterns,
          autoApproveEligible: result.summary.autoApproveEligible,
          flaggedForReview: result.summary.flaggedForReview,
          likelyFalsePositives: result.summary.likelyFalsePositives,
        },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      spinner.fail(`Audit failed: ${msg}`);

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
