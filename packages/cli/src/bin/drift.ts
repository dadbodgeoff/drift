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
  exportCommand,
  whereCommand,
  filesCommand,
  watchCommand,
  dashboardCommand,
  trendsCommand,
  parserCommand,
  dnaCommand,
  boundariesCommand,
  callgraphCommand,
  projectsCommand,
  skillsCommand,
  migrateStorageCommand,
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
  program.addCommand(exportCommand);
  program.addCommand(whereCommand);
  program.addCommand(filesCommand);
  program.addCommand(watchCommand);
  program.addCommand(dashboardCommand);
  program.addCommand(trendsCommand);
  program.addCommand(parserCommand);
  program.addCommand(dnaCommand);
  program.addCommand(boundariesCommand);
  program.addCommand(callgraphCommand);
  program.addCommand(projectsCommand);
  program.addCommand(skillsCommand);
  program.addCommand(migrateStorageCommand);

  // Add help examples
  program.addHelpText(
    'after',
    `
Examples:
  $ drift init                    Initialize Drift in current directory
  $ drift init --from-scaffold    Initialize with Cheatcode2026 presets
  $ drift scan                    Scan codebase for patterns
  $ drift scan --manifest         Generate manifest with semantic locations
  $ drift check                   Check for violations
  $ drift check --staged          Check only staged files
  $ drift check --ci              Run in CI mode
  $ drift status                  Show current drift status
  $ drift approve <pattern-id>    Approve a discovered pattern
  $ drift ignore <pattern-id>     Ignore a pattern
  $ drift report                  Generate a report
  $ drift report --format json    Generate JSON report
  $ drift export                  Export manifest as JSON
  $ drift export --format ai-context  Export for AI consumption
  $ drift where <pattern>         Find pattern locations
  $ drift files <path>            Show patterns in a file
  $ drift watch                   Watch for changes in real-time
  $ drift watch --verbose         Watch with detailed output
  $ drift watch --context .drift-context.md  Auto-update AI context file
  $ drift dashboard               Launch the web dashboard
  $ drift dashboard --port 8080   Launch on a custom port
  $ drift trends                  View pattern regressions over time
  $ drift trends --period 30d     View trends for last 30 days
  $ drift parser                  Show parser status and capabilities
  $ drift parser --test file.py   Test parsing a specific file
  $ drift dna                     Show styling DNA status
  $ drift dna scan                Analyze codebase styling DNA
  $ drift dna playbook            Generate styling playbook
  $ drift boundaries              Show data access boundaries
  $ drift boundaries tables       List discovered tables
  $ drift boundaries check        Check for boundary violations
  $ drift callgraph               Show call graph status
  $ drift callgraph build         Build call graph from source
  $ drift callgraph reach <loc>   What data can this code reach?
  $ drift callgraph inverse <tbl> Who can reach this data?
  $ drift projects                List all registered projects
  $ drift projects switch <name>  Switch active project
  $ drift projects info           Show current project details
  $ drift skills                  List available Agent Skills
  $ drift skills install <name>   Install a skill to your project
  $ drift skills info <name>      Show skill details
  $ drift migrate-storage         Migrate to unified storage format
  $ drift migrate-storage status  Check current storage format

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
