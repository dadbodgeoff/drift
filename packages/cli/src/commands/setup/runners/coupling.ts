/**
 * Coupling Runner - Analyzes module dependencies and cycles
 * 
 * Uses the same analysis flow as `drift coupling build` to ensure
 * the saved format is compatible with `drift coupling status`.
 * 
 * @module commands/setup/runners/coupling
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import chalk from 'chalk';

import { BaseRunner, type RunnerContext } from './base.js';
import { createSpinner } from '../../../ui/spinner.js';
import { DRIFT_DIR, type FeatureResult } from '../types.js';
import { findSourceFiles } from '../utils.js';

import { analyzeCouplingWithFallback } from 'driftdetect-core';

export class CouplingRunner extends BaseRunner {
  constructor(ctx: RunnerContext) {
    super(ctx);
  }

  get name(): string {
    return 'Module Coupling';
  }

  get icon(): string {
    return '🔗';
  }

  get description(): string {
    return 'Analyzes dependencies, detects circular imports.';
  }

  get benefit(): string {
    return 'Find tightly coupled modules and dependency cycles';
  }

  get manualCommand(): string {
    return 'drift coupling build';
  }

  async run(): Promise<FeatureResult> {
    const spinner = createSpinner('Analyzing module coupling...');
    spinner.start();

    try {
      spinner.text('Finding source files...');
      const files = await findSourceFiles(this.rootDir);

      spinner.text(`Analyzing coupling for ${files.length} files...`);
      const result = await analyzeCouplingWithFallback(this.rootDir, files);

      // Save results in the SAME FORMAT as `drift coupling build`
      // This ensures `drift coupling status` works correctly
      const couplingDir = path.join(this.rootDir, DRIFT_DIR, 'module-coupling');
      await fs.mkdir(couplingDir, { recursive: true });

      // Convert native result to graph format (same as drift coupling build)
      const serializedGraph = {
        modules: Object.fromEntries(result.modules.map(m => [m.path, {
          path: m.path,
          imports: [],
          importedBy: [],
          exports: [],
          metrics: {
            Ca: m.ca,
            Ce: m.ce,
            instability: m.instability,
            abstractness: m.abstractness,
            distance: m.distance,
          },
          role: 'balanced',
          isEntryPoint: false,
          isLeaf: m.ce === 0,
        }])),
        edges: [],
        cycles: result.cycles.map((c, i) => ({
          id: `cycle-${i}`,
          path: c.modules,
          length: c.modules.length,
          severity: c.severity,
          totalWeight: c.filesAffected,
          breakPoints: [],
        })),
        metrics: {
          totalModules: result.modules.length,
          totalEdges: 0,
          cycleCount: result.cycles.length,
          avgInstability: result.modules.reduce((sum, m) => sum + m.instability, 0) / Math.max(1, result.modules.length),
          avgDistance: result.modules.reduce((sum, m) => sum + m.distance, 0) / Math.max(1, result.modules.length),
          zoneOfPain: [] as string[],
          zoneOfUselessness: [] as string[],
          hotspots: result.hotspots.map(h => ({ path: h.module, coupling: h.totalCoupling })),
          isolatedModules: [] as string[],
        },
        generatedAt: new Date().toISOString(),
        projectRoot: this.rootDir,
      };

      await fs.writeFile(
        path.join(couplingDir, 'graph.json'),
        JSON.stringify(serializedGraph, null, 2)
      );

      const cycleStatus = result.cycles.length > 0
        ? chalk.yellow(`${result.cycles.length} cycles`)
        : chalk.green('no cycles');

      spinner.succeed(`Coupling analyzed: ${result.modules.length} modules, ${cycleStatus}`);

      return {
        enabled: true,
        success: true,
        timestamp: new Date().toISOString(),
        stats: {
          modules: result.modules.length,
          cycles: result.cycles.length,
          hotspots: result.hotspots.length,
          healthScore: result.healthScore,
          filesAnalyzed: result.filesAnalyzed,
        },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      spinner.fail(`Coupling analysis failed: ${msg}`);

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
