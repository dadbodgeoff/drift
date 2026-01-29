/**
 * DNA Playbook Command - drift dna playbook
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import chalk from 'chalk';
import { Command } from 'commander';
import { DNAStore, PlaybookGenerator } from 'driftdetect-core';

import { createSpinner } from '../../ui/spinner.js';

interface DNAPlaybookOptions {
  output?: string;
  examples?: boolean;
  force?: boolean;
  stdout?: boolean;
}

async function dnaPlaybookAction(options: DNAPlaybookOptions): Promise<void> {
  const rootDir = process.cwd();
  const outputPath = options.output ?? 'STYLING-PLAYBOOK.md';

  const spinner = options.stdout ? null : createSpinner('Generating playbook...');
  spinner?.start();

  try {
    const store = new DNAStore({ rootDir });
    const profile = await store.load();

    if (!profile) {
      spinner?.fail('No DNA profile found');
      console.log(chalk.gray("Run 'drift dna scan' first."));
      return;
    }

    // Check if file exists and not forcing
    const fullPath = path.join(rootDir, outputPath);
    if (!options.force && !options.stdout) {
      try {
        await fs.access(fullPath);
        spinner?.fail(`Playbook already exists: ${outputPath}`);
        console.log(chalk.gray('Use --force to overwrite or --stdout to print.'));
        return;
      } catch {
        // File doesn't exist, continue
      }
    }

    const generator = new PlaybookGenerator();
    const playbook = generator.generate(profile);

    if (options.stdout) {
      console.log(playbook);
      return;
    }

    await fs.writeFile(fullPath, playbook);
    spinner?.succeed(`Playbook generated: ${outputPath}`);

    console.log();
    console.log(chalk.gray('The playbook contains:'));
    console.log(chalk.gray('  - Quick reference table'));
    console.log(chalk.gray('  - Detailed conventions for each gene'));
    console.log(chalk.gray('  - Code examples'));
    console.log(chalk.gray('  - Patterns to avoid'));
    if (profile.mutations.length > 0) {
      console.log(chalk.gray(`  - ${profile.mutations.length} mutations to address`));
    }

  } catch (error) {
    spinner?.fail('Failed to generate playbook');
    console.error(chalk.red((error as Error).message));
    process.exit(1);
  }
}

export const dnaPlaybookCommand = new Command('playbook')
  .description('Generate styling playbook documentation')
  .option('-o, --output <path>', 'Output path', 'STYLING-PLAYBOOK.md')
  .option('-e, --examples', 'Include code examples')
  .option('--force', 'Overwrite existing file')
  .option('--stdout', 'Output to stdout instead of file')
  .action(dnaPlaybookAction);
