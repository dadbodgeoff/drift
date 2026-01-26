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
  wrappersCommand,
  createTestTopologyCommand,
  createCouplingCommand,
  createErrorHandlingCommand,
  createSimulateCommand,
  createConstraintsCommand,
  createWpfCommand,
  createGoCommand,
  createRustCommand,
  createCppCommand,
  createTsCommand,
  createPyCommand,
  createJavaCommand,
  createPhpCommand,
  envCommand,
  constantsCommand,
  licenseCommand,
  createGateCommand,
  contextCommand,
  telemetryCommand,
  nextStepsCommand,
  troubleshootCommand,
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
  program.addCommand(wrappersCommand);
  
  // Analysis commands (L5-L7 layers)
  program.addCommand(createTestTopologyCommand());
  program.addCommand(createCouplingCommand());
  program.addCommand(createErrorHandlingCommand());
  program.addCommand(createConstraintsCommand());
  
  // Speculative Execution Engine
  program.addCommand(createSimulateCommand());
  
  // WPF Framework Support
  program.addCommand(createWpfCommand());

  // Go Language Support
  program.addCommand(createGoCommand());

  // Rust Language Support
  program.addCommand(createRustCommand());

  // C++ Language Support
  program.addCommand(createCppCommand());

  // TypeScript/JavaScript Language Support
  program.addCommand(createTsCommand());

  // Python Language Support
  program.addCommand(createPyCommand());

  // Java Language Support
  program.addCommand(createJavaCommand());

  // PHP Language Support
  program.addCommand(createPhpCommand());

  // Environment Variable Detection
  program.addCommand(envCommand);

  // Constants & Enum Analysis
  program.addCommand(constantsCommand);

  // License Management
  program.addCommand(licenseCommand);

  // Quality Gates (Enterprise)
  program.addCommand(createGateCommand());

  // Package Context (Monorepo AI context minimization)
  program.addCommand(contextCommand);

  // Telemetry Management (Privacy-first, opt-in)
  program.addCommand(telemetryCommand);

  // User Guidance Commands
  program.addCommand(nextStepsCommand);
  program.addCommand(troubleshootCommand);

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
  $ drift wrappers                Detect framework wrapper patterns
  $ drift wrappers --json         Output wrapper analysis as JSON
  $ drift wrappers --verbose      Show detailed wrapper information
  $ drift test-topology           Show test topology status
  $ drift test-topology coverage  Analyze test coverage mapping
  $ drift test-topology uncovered Find untested code
  $ drift test-topology affected  Find tests affected by changes
  $ drift coupling                Show module coupling status
  $ drift coupling cycles         Detect dependency cycles
  $ drift coupling hotspots       Find highly coupled modules
  $ drift coupling analyze <mod>  Analyze specific module
  $ drift error-handling          Show error handling status
  $ drift error-handling gaps     Find error handling gaps
  $ drift error-handling unhandled Find unhandled error paths
  $ drift simulate "add rate limiting"  Simulate implementation approaches
  $ drift simulate "add auth" -v  Simulate with detailed analysis
  $ drift simulate "add caching" --json  Output simulation as JSON
  $ drift env                     Show environment variable access overview
  $ drift env scan                Scan for environment variable access
  $ drift env list                List all discovered env variables
  $ drift env secrets             Show secret and credential variables
  $ drift env var <name>          Show details for a specific variable
  $ drift env required            Show required variables without defaults
  $ drift env file <pattern>      Show what env vars a file accesses
  $ drift constants               Show constants overview
  $ drift constants list          List all constants
  $ drift constants list -c api   List API-related constants
  $ drift constants get <name>    Show constant details
  $ drift constants secrets       Show potential hardcoded secrets
  $ drift constants inconsistent  Show constants with inconsistent values
  $ drift constants dead          Show potentially unused constants
  $ drift constants export out.json  Export constants to file
  $ drift gate                    Run quality gates with default policy
  $ drift gate --policy strict    Run with strict policy
  $ drift gate --format sarif     Output in SARIF format
  $ drift gate --ci               Run in CI mode with JSON output
  $ drift gate --gates pattern-compliance,security-boundary  Run specific gates
  $ drift context --list          List all packages in monorepo
  $ drift context @drift/core     Generate context for a package
  $ drift context packages/core --format ai  AI-optimized context
  $ drift context @drift/core --snippets  Include code snippets
  $ drift telemetry             Show telemetry status
  $ drift telemetry enable      Enable telemetry (opt-in)
  $ drift telemetry disable     Disable telemetry
  $ drift telemetry setup       Interactive telemetry configuration
  $ drift next-steps            Get personalized recommendations
  $ drift next-steps -v         Show all recommendations with reasons
  $ drift troubleshoot          Diagnose common issues
  $ drift troubleshoot -v       Show all issues including info-level

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
