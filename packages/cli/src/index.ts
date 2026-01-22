/**
 * @drift/cli - Command-line interface for Drift
 *
 * This package provides CLI commands:
 * - drift init: Initialize Drift in a project
 * - drift scan: Scan codebase for patterns
 * - drift check: Check for violations
 * - drift status: Show current drift status
 * - drift approve: Approve a pattern
 * - drift ignore: Ignore a pattern
 * - drift report: Generate reports
 */

import { createRequire } from 'node:module';

// Read version from package.json to avoid hardcoding
const require = createRequire(import.meta.url);
const pkg = require('../package.json') as { version: string };
export const VERSION = pkg.version;

// Type exports
export * from './types/index.js';

// UI exports
export * from './ui/index.js';

// Command exports (for programmatic use)
export {
  initCommand,
  scanCommand,
  checkCommand,
  statusCommand,
  approveCommand,
  ignoreCommand,
  reportCommand,
} from './commands/index.js';
