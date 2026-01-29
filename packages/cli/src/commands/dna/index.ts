/**
 * DNA Command - drift dna
 *
 * Styling DNA analysis and management commands.
 */

import { Command } from 'commander';

import { dnaExportCommand } from './export.js';
import { dnaGeneCommand } from './gene.js';
import { dnaMutationsCommand } from './mutations.js';
import { dnaPlaybookCommand } from './playbook.js';
import { dnaScanCommand } from './scan.js';
import { dnaStatusCommand } from './status.js';

export const dnaCommand = new Command('dna')
  .description('Styling DNA analysis and management')
  .addCommand(dnaScanCommand)
  .addCommand(dnaStatusCommand)
  .addCommand(dnaGeneCommand)
  .addCommand(dnaMutationsCommand)
  .addCommand(dnaPlaybookCommand)
  .addCommand(dnaExportCommand);

// Default action (no subcommand = status)
dnaCommand.action(async () => {
  await dnaStatusCommand.parseAsync(['status'], { from: 'user' });
});
