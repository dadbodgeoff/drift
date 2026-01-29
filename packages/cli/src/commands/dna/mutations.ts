/**
 * DNA Mutations Command - drift dna mutations
 */

import chalk from 'chalk';
import { Command } from 'commander';
import { DNAStore, type GeneId, type MutationImpact, GENE_IDS } from 'driftdetect-core';

import { createSpinner } from '../../ui/spinner.js';

interface DNAMutationsOptions {
  gene?: string;
  impact?: string;
  suggest?: boolean;
  json?: boolean;
}

async function dnaMutationsAction(options: DNAMutationsOptions): Promise<void> {
  const rootDir = process.cwd();

  const spinner = options.json ? null : createSpinner('Loading mutations...');
  spinner?.start();

  try {
    const store = new DNAStore({ rootDir });
    const profile = await store.load();

    if (!profile) {
      spinner?.fail('No DNA profile found');
      if (!options.json) {console.log(chalk.gray("Run 'drift dna scan' first."));}
      else {console.log(JSON.stringify({ error: 'No DNA profile found' }));}
      return;
    }

    let mutations = profile.mutations;

    // Filter by gene
    if (options.gene) {
      if (!GENE_IDS.includes(options.gene as GeneId)) {
        spinner?.fail(`Invalid gene: ${options.gene}`);
        return;
      }
      mutations = mutations.filter(m => m.gene === options.gene);
    }

    // Filter by impact
    if (options.impact) {
      const validImpacts: MutationImpact[] = ['low', 'medium', 'high'];
      if (!validImpacts.includes(options.impact as MutationImpact)) {
        spinner?.fail(`Invalid impact: ${options.impact}. Use: low, medium, high`);
        return;
      }
      mutations = mutations.filter(m => m.impact === options.impact);
    }

    spinner?.succeed(`Found ${mutations.length} mutations`);

    if (options.json) {
      console.log(JSON.stringify(mutations, null, 2));
      return;
    }

    if (mutations.length === 0) {
      console.log();
      console.log(chalk.green('✓ No mutations found! Your codebase is consistent.'));
      return;
    }

    console.log();
    console.log(chalk.bold(`🧬 Mutations (${mutations.length})`));
    console.log();

    // Group by impact
    const byImpact = { high: [] as typeof mutations, medium: [] as typeof mutations, low: [] as typeof mutations };
    for (const m of mutations) {byImpact[m.impact].push(m);}

    if (byImpact.high.length > 0) {
      console.log(chalk.red.bold(`High Impact (${byImpact.high.length})`));
      console.log(chalk.gray('─'.repeat(50)));
      for (const m of byImpact.high.slice(0, 10)) {
        printMutation(m, options.suggest);
      }
      if (byImpact.high.length > 10) {console.log(chalk.gray(`  ... and ${byImpact.high.length - 10} more`));}
      console.log();
    }

    if (byImpact.medium.length > 0) {
      console.log(chalk.yellow.bold(`Medium Impact (${byImpact.medium.length})`));
      console.log(chalk.gray('─'.repeat(50)));
      for (const m of byImpact.medium.slice(0, 10)) {
        printMutation(m, options.suggest);
      }
      if (byImpact.medium.length > 10) {console.log(chalk.gray(`  ... and ${byImpact.medium.length - 10} more`));}
      console.log();
    }

    if (byImpact.low.length > 0) {
      console.log(chalk.gray.bold(`Low Impact (${byImpact.low.length})`));
      console.log(chalk.gray('─'.repeat(50)));
      for (const m of byImpact.low.slice(0, 5)) {
        printMutation(m, options.suggest);
      }
      if (byImpact.low.length > 5) {console.log(chalk.gray(`  ... and ${byImpact.low.length - 5} more`));}
    }

  } catch (error) {
    spinner?.fail('Failed to load mutations');
    console.error(chalk.red((error as Error).message));
    process.exit(1);
  }
}

function printMutation(m: { file: string; line: number; gene: string; expected: string; actual: string; suggestion: string; code: string }, showSuggestion?: boolean): void {
  console.log(`  ${chalk.cyan(m.file)}:${m.line}`);
  console.log(`    Gene: ${m.gene}`);
  console.log(`    Found: ${chalk.red(m.actual)} → Expected: ${chalk.green(m.expected)}`);
  if (m.code) {console.log(chalk.gray(`    Code: ${m.code.slice(0, 50)}${m.code.length > 50 ? '...' : ''}`));}
  if (showSuggestion && m.suggestion) {console.log(chalk.blue(`    💡 ${m.suggestion}`));}
  console.log();
}

export const dnaMutationsCommand = new Command('mutations')
  .description('List styling mutations (deviations from DNA)')
  .option('-g, --gene <gene>', 'Filter by gene')
  .option('-i, --impact <level>', 'Filter by impact (low, medium, high)')
  .option('-s, --suggest', 'Show resolution suggestions')
  .option('--json', 'Output as JSON')
  .action(dnaMutationsAction);
