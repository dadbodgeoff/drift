#!/usr/bin/env node
/**
 * Drift CLI Entry Point
 *
 * Main entry point for the Drift command-line interface.
 * Sets up Commander.js with all available commands.
 *
 * @requirements 29.1
 */

import { Command } from 'commander';
import { VERSION } from '../index.js';
import {
  initCommand,
  scanCommand,
  checkCommand,
  statusCommand,
  approveCommand,
  ignoreCommand,
  reportCommand,
} from '../commands/index.js';

/**
 * Create and configure the main CLI program
 */
function createProgram(): Command {
  const program = new Command();

  program
    .name('drift')
    .description('Architectural drift detection - learn and enforce codebase patterns')
    .version(VERSION, '-v, --version', 'Output the current version')
    .option('--verbose', 'Enable verbose output')
    .option('--no-color', 'Disable colored output');

  // Register all commands
  program.addCommand(initCommand);
  program.addCommand(scanCommand);
  program.addCommand(checkCommand);
  program.addCommand(statusCommand);
  program.addCommand(approveCommand);
  program.addCommand(ignoreCommand);
  program.addCommand(reportCommand);

  // Add help examples
  program.addHelpText(
    'after',
    `
Examples:
  $ drift init                    Initialize Drift in current directory
  $ drift init --from-scaffold    Initialize with Cheatcode2026 presets
  $ drift scan                    Scan codebase for patterns
  $ drift check                   Check for violations
  $ drift check --staged          Check only staged files
  $ drift check --ci              Run in CI mode
  $ drift status                  Show current drift status
  $ drift approve <pattern-id>    Approve a discovered pattern
  $ drift ignore <pattern-id>     Ignore a pattern
  $ drift report                  Generate a report
  $ drift report --format json    Generate JSON report

Documentation:
  https://github.com/drift/drift
`
  );

  return program;
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  const program = createProgram();

  try {
    await program.parseAsync(process.argv);
  } catch (error) {
    if (error instanceof Error) {
      console.error(`Error: ${error.message}`);
      if (process.env['DEBUG']) {
        console.error(error.stack);
      }
    } else {
      console.error('An unexpected error occurred');
    }
    process.exit(1);
  }
}

// Run the CLI
main();
