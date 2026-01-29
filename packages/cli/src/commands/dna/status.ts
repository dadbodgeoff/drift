/**
 * DNA Status Command - drift dna status
 */

import chalk from 'chalk';
import { Command } from 'commander';
import { DNAStore, GENE_IDS } from 'driftdetect-core';

import { createSpinner } from '../../ui/spinner.js';

interface DNAStatusOptions {
  detailed?: boolean;
  json?: boolean;
}

async function dnaStatusAction(options: DNAStatusOptions): Promise<void> {
  const rootDir = process.cwd();

  if (!options.json) {
    console.log();
    console.log(chalk.bold('🧬 Drift DNA - Status'));
    console.log();
  }

  const spinner = options.json ? null : createSpinner('Loading DNA profile...');
  spinner?.start();

  try {
    const store = new DNAStore({ rootDir });
    const profile = await store.load();

    if (!profile) {
      spinner?.fail('No DNA profile found');
      if (!options.json) {
        console.log(chalk.gray("Run 'drift dna scan' to analyze your codebase."));
      } else {
        console.log(JSON.stringify({ error: 'No DNA profile found' }));
      }
      return;
    }

    spinner?.succeed('DNA profile loaded');

    if (options.json) {
      console.log(JSON.stringify(profile, null, 2));
      return;
    }

    console.log();
    console.log(chalk.bold('Summary'));
    console.log(chalk.gray('─'.repeat(50)));
    console.log(`  Health Score:      ${colorScore(profile.summary.healthScore)}`);
    console.log(`  Genetic Diversity: ${profile.summary.geneticDiversity.toFixed(2)}`);
    console.log(`  Framework:         ${chalk.cyan(profile.summary.dominantFramework)}`);
    console.log(`  Components:        ${profile.summary.totalComponentsAnalyzed}`);
    console.log(`  Files:             ${profile.summary.totalFilesAnalyzed}`);
    console.log(`  Last Updated:      ${new Date(profile.summary.lastUpdated).toLocaleString()}`);
    console.log();

    console.log(chalk.bold('Genes'));
    console.log(chalk.gray('─'.repeat(50)));
    for (const geneId of GENE_IDS) {
      const gene = profile.genes[geneId];
      const dominant = gene.dominant?.name ?? chalk.gray('None');
      const conf = `${Math.round(gene.confidence * 100)}%`;
      const consistency = gene.consistency >= 0.8 ? chalk.green('●') : gene.consistency >= 0.5 ? chalk.yellow('●') : chalk.red('●');
      console.log(`  ${consistency} ${gene.name.padEnd(22)} ${dominant.padEnd(25)} ${conf}`);
    }
    console.log();

    if (profile.mutations.length > 0) {
      console.log(chalk.bold(`Mutations: ${profile.mutations.length}`));
      const byImpact = { high: 0, medium: 0, low: 0 };
      for (const m of profile.mutations) {byImpact[m.impact]++;}
      console.log(`  ${chalk.red('High')}: ${byImpact.high}  ${chalk.yellow('Medium')}: ${byImpact.medium}  ${chalk.gray('Low')}: ${byImpact.low}`);
      console.log();
    }

    if (options.detailed) {
      console.log(chalk.bold('Gene Details'));
      console.log(chalk.gray('─'.repeat(50)));
      for (const geneId of GENE_IDS) {
        const gene = profile.genes[geneId];
        console.log();
        console.log(chalk.bold(`  ${gene.name}`));
        console.log(`    Dominant: ${gene.dominant?.name ?? 'None'}`);
        console.log(`    Confidence: ${Math.round(gene.confidence * 100)}%`);
        console.log(`    Consistency: ${Math.round(gene.consistency * 100)}%`);
        if (gene.alleles.length > 1) {
          console.log(`    Alleles:`);
          for (const a of gene.alleles.slice(0, 3)) {
            const marker = a.isDominant ? chalk.green('★') : ' ';
            console.log(`      ${marker} ${a.name}: ${Math.round(a.frequency * 100)}% (${a.fileCount} files)`);
          }
        }
        if (gene.exemplars.length > 0) {
          console.log(`    Exemplars: ${gene.exemplars.slice(0, 2).join(', ')}`);
        }
      }
    }

  } catch (error) {
    spinner?.fail('Failed to load DNA profile');
    console.error(chalk.red((error as Error).message));
    process.exit(1);
  }
}

function colorScore(score: number): string {
  if (score >= 90) {return chalk.green(`${score}/100`);}
  if (score >= 70) {return chalk.yellow(`${score}/100`);}
  if (score >= 50) {return chalk.hex('#FFA500')(`${score}/100`);}
  return chalk.red(`${score}/100`);
}

export const dnaStatusCommand = new Command('status')
  .description('Show DNA health summary')
  .option('-d, --detailed', 'Show detailed gene breakdown')
  .option('--json', 'Output as JSON')
  .action(dnaStatusAction);
