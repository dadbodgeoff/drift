/**
 * DNA Gene Command - drift dna gene <id>
 */

import chalk from 'chalk';
import { Command } from 'commander';
import { DNAStore, GENE_IDS, type GeneId } from 'driftdetect-core';

import { createSpinner } from '../../ui/spinner.js';

interface DNAGeneOptions {
  examples?: boolean;
  files?: boolean;
}

async function dnaGeneAction(geneId: string, options: DNAGeneOptions): Promise<void> {
  const rootDir = process.cwd();

  if (!GENE_IDS.includes(geneId as GeneId)) {
    console.error(chalk.red(`Invalid gene ID: ${geneId}`));
    console.log(chalk.gray(`Valid genes: ${GENE_IDS.join(', ')}`));
    process.exit(1);
  }

  const spinner = createSpinner('Loading gene data...');
  spinner.start();

  try {
    const store = new DNAStore({ rootDir });
    const profile = await store.load();

    if (!profile) {
      spinner.fail('No DNA profile found');
      console.log(chalk.gray("Run 'drift dna scan' first."));
      return;
    }

    const gene = profile.genes[geneId as GeneId];
    spinner.succeed(`Gene: ${gene.name}`);

    console.log();
    console.log(chalk.bold(`🧬 Gene: ${gene.name}`));
    console.log();
    console.log(chalk.gray(gene.description));
    console.log();

    console.log(chalk.bold('Summary'));
    console.log(chalk.gray('─'.repeat(40)));
    console.log(`  Dominant Allele: ${gene.dominant ? chalk.green(gene.dominant.name) : chalk.gray('None')}`);
    console.log(`  Confidence:      ${Math.round(gene.confidence * 100)}%`);
    console.log(`  Consistency:     ${Math.round(gene.consistency * 100)}%`);
    console.log();

    if (gene.alleles.length > 0) {
      console.log(chalk.bold('Alleles Detected'));
      console.log(chalk.gray('─'.repeat(40)));
      for (const allele of gene.alleles) {
        const marker = allele.isDominant ? chalk.green('★ DOMINANT') : '';
        const freq = `${Math.round(allele.frequency * 100)}%`;
        console.log(`  ├─ ${allele.name.padEnd(25)} ${freq.padEnd(6)} (${allele.fileCount} files) ${marker}`);
        
        if (options.examples && allele.examples.length > 0) {
          const ex = allele.examples[0];
          if (ex) {
            console.log(chalk.gray(`  │   Example: ${ex.file}:${ex.line}`));
            console.log(chalk.gray(`  │   ${ex.code.slice(0, 60)}${ex.code.length > 60 ? '...' : ''}`));
          }
        }
        
        if (options.files && allele.examples.length > 0) {
          console.log(chalk.gray(`  │   Files:`));
          for (const ex of allele.examples.slice(0, 3)) {
            console.log(chalk.gray(`  │     - ${ex.file}:${ex.line}`));
          }
        }
      }
      console.log();
    }

    if (gene.exemplars.length > 0) {
      console.log(chalk.bold('Exemplar Files'));
      console.log(chalk.gray('─'.repeat(40)));
      for (const f of gene.exemplars) {
        console.log(`  - ${f}`);
      }
      console.log();
    }

    // Show mutations for this gene
    const geneMutations = profile.mutations.filter(m => m.gene === geneId);
    if (geneMutations.length > 0) {
      console.log(chalk.bold.yellow(`Mutations (${geneMutations.length})`));
      console.log(chalk.gray('─'.repeat(40)));
      for (const m of geneMutations.slice(0, 5)) {
        const impact = m.impact === 'high' ? chalk.red('HIGH') : m.impact === 'medium' ? chalk.yellow('MED') : chalk.gray('LOW');
        console.log(`  [${impact}] ${m.file}:${m.line}`);
        console.log(chalk.gray(`        ${m.actual} → should be ${m.expected}`));
      }
      if (geneMutations.length > 5) {
        console.log(chalk.gray(`  ... and ${geneMutations.length - 5} more`));
      }
    }

  } catch (error) {
    spinner.fail('Failed to load gene data');
    console.error(chalk.red((error as Error).message));
    process.exit(1);
  }
}

export const dnaGeneCommand = new Command('gene')
  .description('Deep dive into a specific gene')
  .argument('<gene-id>', `Gene ID (${GENE_IDS.join(', ')})`)
  .option('-e, --examples', 'Show code examples')
  .option('-f, --files', 'List files for each allele')
  .action(dnaGeneAction);
