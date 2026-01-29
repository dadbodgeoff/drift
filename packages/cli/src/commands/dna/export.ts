/**
 * DNA Export Command - drift dna export
 */

import chalk from 'chalk';
import { Command } from 'commander';
import { DNAStore, AIContextBuilder, PlaybookGenerator, type ContextLevel, GENE_IDS, type GeneId } from 'driftdetect-core';

import { createSpinner } from '../../ui/spinner.js';

interface DNAExportOptions {
  format?: 'ai-context' | 'json' | 'playbook' | 'summary';
  genes?: string[];
  mutations?: boolean;
  compact?: boolean;
  level?: string;
}

async function dnaExportAction(options: DNAExportOptions): Promise<void> {
  const rootDir = process.cwd();
  const format = options.format ?? 'ai-context';

  const spinner = createSpinner('Exporting DNA...');
  spinner.start();

  try {
    const store = new DNAStore({ rootDir });
    const profile = await store.load();

    if (!profile) {
      spinner.fail('No DNA profile found');
      console.log(chalk.gray("Run 'drift dna scan' first."));
      return;
    }

    spinner.succeed('DNA exported');

    // Filter genes if specified
    let filteredProfile = profile;
    if (options.genes && options.genes.length > 0) {
      const validGenes = options.genes.filter(g => GENE_IDS.includes(g as GeneId));
      if (validGenes.length === 0) {
        console.error(chalk.red('No valid genes specified'));
        return;
      }
      filteredProfile = {
        ...profile,
        genes: Object.fromEntries(
          Object.entries(profile.genes).filter(([k]) => validGenes.includes(k))
        ) as typeof profile.genes,
      };
    }

    // Remove mutations if not requested
    if (!options.mutations) {
      filteredProfile = { ...filteredProfile, mutations: [] };
    }

    switch (format) {
      case 'json':
        if (options.compact) {
          console.log(JSON.stringify(filteredProfile));
        } else {
          console.log(JSON.stringify(filteredProfile, null, 2));
        }
        break;

      case 'playbook':
        const generator = new PlaybookGenerator();
        console.log(generator.generate(filteredProfile));
        break;

      case 'summary':
        printSummary(filteredProfile);
        break;

      case 'ai-context':
      default:
        const level = parseInt(options.level ?? '3', 10) as ContextLevel;
        const validLevel = [1, 2, 3, 4].includes(level) ? level : 3;
        const builder = new AIContextBuilder();
        console.log(builder.build(filteredProfile, validLevel));
        break;
    }

  } catch (error) {
    spinner.fail('Failed to export DNA');
    console.error(chalk.red((error as Error).message));
    process.exit(1);
  }
}

function printSummary(profile: { summary: { healthScore: number; geneticDiversity: number; dominantFramework: string; totalComponentsAnalyzed: number }; genes: Record<string, { name: string; dominant: { name: string } | null; confidence: number }>; mutations: unknown[] }): void {
  console.log();
  console.log(`Health: ${profile.summary.healthScore}/100`);
  console.log(`Framework: ${profile.summary.dominantFramework}`);
  console.log(`Diversity: ${profile.summary.geneticDiversity.toFixed(2)}`);
  console.log(`Components: ${profile.summary.totalComponentsAnalyzed}`);
  console.log(`Mutations: ${profile.mutations.length}`);
  console.log();
  console.log('Genes:');
  for (const [_id, gene] of Object.entries(profile.genes)) {
    console.log(`  ${gene.name}: ${gene.dominant?.name ?? 'None'} (${Math.round(gene.confidence * 100)}%)`);
  }
}

export const dnaExportCommand = new Command('export')
  .description('Export DNA for AI context or integration')
  .option('-f, --format <format>', 'Export format (ai-context, json, playbook, summary)', 'ai-context')
  .option('-g, --genes <genes...>', 'Specific genes to export')
  .option('-m, --mutations', 'Include mutations')
  .option('-c, --compact', 'Compact output')
  .option('-l, --level <level>', 'AI context level (1-4)', '3')
  .action(dnaExportAction);
