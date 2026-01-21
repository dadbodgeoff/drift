/**
 * DNA Scan Command - drift dna scan
 */

import { Command } from 'commander';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import chalk from 'chalk';
import { DNAAnalyzer, DNAStore, PlaybookGenerator, GENE_IDS } from 'driftdetect-core';
import { createSpinner, status } from '../../ui/spinner.js';

interface DNAScanOptions {
  paths?: string[];
  force?: boolean;
  verbose?: boolean;
  playbook?: boolean;
  format?: 'summary' | 'json' | 'ai-context';
}

const DRIFT_DIR = '.drift';

async function isDriftInitialized(rootDir: string): Promise<boolean> {
  try { await fs.access(path.join(rootDir, DRIFT_DIR)); return true; } catch { return false; }
}

async function dnaScanAction(options: DNAScanOptions): Promise<void> {
  const rootDir = process.cwd();
  const verbose = options.verbose ?? false;

  console.log();
  console.log(chalk.bold('🧬 Drift DNA - Styling Analysis'));
  console.log();

  if (!(await isDriftInitialized(rootDir))) {
    status.error('Drift is not initialized. Run `drift init` first.');
    process.exit(1);
  }

  const spinner = createSpinner('Analyzing styling DNA...');
  spinner.start();

  try {
    const analyzer = new DNAAnalyzer({
      rootDir,
      ...(options.paths ? { componentPaths: options.paths } : {}),
      verbose,
    });

    await analyzer.initialize();
    const result = await analyzer.analyze();

    spinner.succeed(`DNA analyzed: ${result.profile.summary.healthScore}/100 health, ${result.profile.mutations.length} mutations`);

    // Save profile
    const store = new DNAStore({ rootDir });
    await store.save(result.profile);

    if (verbose) {
      console.log(chalk.gray(`  Duration: ${result.stats.duration}ms`));
      console.log(chalk.gray(`  Files analyzed: ${result.stats.filesAnalyzed}`));
      console.log(chalk.gray(`  Components: ${result.stats.componentFiles}`));
    }

    // Output based on format
    if (options.format === 'json') {
      console.log(JSON.stringify(result.profile, null, 2));
      return;
    }

    // Summary output
    console.log();
    console.log(chalk.bold('DNA Profile'));
    console.log(chalk.gray('─'.repeat(50)));
    console.log(`  Health Score:      ${colorScore(result.profile.summary.healthScore)}`);
    console.log(`  Genetic Diversity: ${result.profile.summary.geneticDiversity.toFixed(2)} ${result.profile.summary.geneticDiversity < 0.3 ? chalk.green('(Low - Consistent)') : chalk.yellow('(High - Fragmented)')}`);
    console.log(`  Framework:         ${chalk.cyan(result.profile.summary.dominantFramework)}`);
    console.log();

    console.log(chalk.bold('Genes:'));
    for (const geneId of GENE_IDS) {
      const gene = result.profile.genes[geneId];
      const dominant = gene.dominant?.name ?? chalk.gray('None');
      const conf = `${Math.round(gene.confidence * 100)}%`;
      console.log(`  ├─ ${gene.name.padEnd(20)} ${dominant.padEnd(25)} ${conf}`);
    }
    console.log();

    if (result.profile.mutations.length > 0) {
      console.log(chalk.bold.yellow(`Mutations (${result.profile.mutations.length}):`));
      for (const m of result.profile.mutations.slice(0, 5)) {
        console.log(`  ├─ ${chalk.gray(m.file)}`);
        console.log(`  │   └─ ${m.actual} ${chalk.gray(`(expected: ${m.expected})`)}`);
      }
      if (result.profile.mutations.length > 5) {
        console.log(chalk.gray(`  └─ ... and ${result.profile.mutations.length - 5} more`));
      }
      console.log();
    }

    // Generate playbook if requested
    if (options.playbook) {
      const playbookSpinner = createSpinner('Generating playbook...');
      playbookSpinner.start();
      const generator = new PlaybookGenerator();
      const playbook = generator.generate(result.profile);
      const playbookPath = path.join(rootDir, 'STYLING-PLAYBOOK.md');
      await fs.writeFile(playbookPath, playbook);
      playbookSpinner.succeed(`Playbook generated: ${playbookPath}`);
    }

    console.log(chalk.gray("Run 'drift dna playbook' to generate documentation."));
    console.log(chalk.gray("Run 'drift dna mutations' for detailed mutation info."));

  } catch (error) {
    spinner.fail('DNA analysis failed');
    console.error(chalk.red((error as Error).message));
    process.exit(1);
  }
}

function colorScore(score: number): string {
  if (score >= 90) return chalk.green(`${score}/100`);
  if (score >= 70) return chalk.yellow(`${score}/100`);
  if (score >= 50) return chalk.hex('#FFA500')(`${score}/100`);
  return chalk.red(`${score}/100`);
}

export const dnaScanCommand = new Command('scan')
  .description('Analyze codebase and generate styling DNA profile')
  .option('-p, --paths <paths...>', 'Specific component paths to scan')
  .option('--force', 'Force rescan even if cache is valid')
  .option('--verbose', 'Enable verbose output')
  .option('--playbook', 'Generate playbook after scan')
  .option('-f, --format <format>', 'Output format (summary, json, ai-context)', 'summary')
  .action(dnaScanAction);
