/**
 * Dashboard Command - drift dashboard
 *
 * Launch the local web dashboard for visualizing patterns and violations.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import chalk from 'chalk';
import { Command } from 'commander';

import { createSpinner } from '../ui/spinner.js';

// Dashboard server interface for dynamic import
interface DashboardServerOptions {
  driftDir: string;
  port: number;
  openBrowser: boolean;
}

interface DashboardServerClass {
  new (options: DashboardServerOptions): {
    start(): Promise<void>;
    stop(): Promise<void>;
  };
}

export interface DashboardOptions {
  /** Port to run the server on */
  port?: number;
  /** Don't open browser automatically */
  noBrowser?: boolean;
  /** Enable verbose output */
  verbose?: boolean;
}

/** Directory name for drift configuration */
const DRIFT_DIR = '.drift';

/**
 * Check if drift is initialized
 */
async function isDriftInitialized(rootDir: string): Promise<boolean> {
  try {
    await fs.access(path.join(rootDir, DRIFT_DIR));
    return true;
  } catch {
    return false;
  }
}

/**
 * Dashboard command implementation
 */
async function dashboardAction(options: DashboardOptions): Promise<void> {
  const rootDir = process.cwd();
  const port = options.port ?? 3000;
  const openBrowser = !options.noBrowser;

  console.log();
  console.log(chalk.bold('📊 Drift Dashboard'));
  console.log();

  // Check if initialized
  if (!(await isDriftInitialized(rootDir))) {
    console.log(chalk.red('✖ Drift is not initialized. Run `drift init` first.'));
    process.exit(1);
  }

  const spinner = createSpinner('Starting dashboard server...');
  spinner.start();

  try {
    // Dynamic import to avoid loading dashboard package unless needed
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dashboardModule = await import('driftdetect-dashboard' as any) as { DashboardServer: DashboardServerClass };
    const { DashboardServer } = dashboardModule;

    const server = new DashboardServer({
      driftDir: path.join(rootDir, DRIFT_DIR),
      port,
      openBrowser,
    });

    await server.start();

    spinner.succeed(`Dashboard running at ${chalk.cyan(`http://localhost:${port}`)}`);
    console.log();
    console.log(chalk.gray('Press Ctrl+C to stop the server'));
    console.log();

    // Handle graceful shutdown
    const shutdown = async () => {
      console.log();
      console.log(chalk.gray('Shutting down...'));
      await server.stop();
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    // Keep the process running
    await new Promise(() => {});
  } catch (error) {
    spinner.fail('Failed to start dashboard');

    if (error instanceof Error) {
      if (error.message.includes('EADDRINUSE')) {
        console.log(chalk.red(`Port ${port} is already in use.`));
        console.log(chalk.gray(`Try: drift dashboard --port ${port + 1}`));
      } else if (error.message.includes('Cannot find module')) {
        console.log(chalk.red('Dashboard package not found.'));
        console.log(chalk.gray('Make sure driftdetect-dashboard is installed.'));
      } else {
        console.log(chalk.red(error.message));
        if (options.verbose) {
          console.log(chalk.gray(error.stack || ''));
        }
      }
    }

    process.exit(1);
  }
}

export const dashboardCommand = new Command('dashboard')
  .description('Launch the local web dashboard')
  .option('-p, --port <port>', 'Port to run the server on', '3847')
  .option('--no-browser', "Don't open browser automatically")
  .option('--verbose', 'Enable verbose output')
  .action(async (options) => {
    await dashboardAction({
      ...options,
      port: parseInt(options.port, 10),
    });
  });
