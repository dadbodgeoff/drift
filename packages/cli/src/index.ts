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

// Export version
export const VERSION = '0.0.1';

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
