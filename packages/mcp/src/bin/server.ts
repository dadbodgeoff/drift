#!/usr/bin/env node
/**
 * Drift MCP Server Entry Point
 * 
 * Usage:
 *   drift-mcp                       # Run server in current directory
 *   drift-mcp /path/to/project      # Run for specific project
 *   drift-mcp --no-cache            # Disable response caching
 *   drift-mcp --no-rate-limit       # Disable rate limiting
 * 
 * MCP Config (add to mcp.json):
 * {
 *   "mcpServers": {
 *     "drift": {
 *       "command": "npx",
 *       "args": ["driftdetect-mcp", "/path/to/your/project"]
 *     }
 *   }
 * }
 * 
 * Features:
 * - DataLake as central source of truth (pre-computed views, sharded storage)
 * - Layered tool architecture (orchestration → discovery → exploration → detail)
 * - Intent-aware context synthesis via drift_context
 * - Token budget awareness and cursor-based pagination
 * - Structured error handling with recovery hints
 * - Response caching, rate limiting, and metrics
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createEnterpriseMCPServer } from '../enterprise-server.js';

async function main() {
  const args = process.argv.slice(2);
  
  // Parse flags
  const noCache = args.includes('--no-cache');
  const noRateLimit = args.includes('--no-rate-limit');
  const verbose = args.includes('--verbose') || args.includes('-v');
  const skipWarmup = args.includes('--skip-warmup');
  
  // Get project root (first non-flag argument, or cwd)
  const projectRoot = args.find(arg => !arg.startsWith('--') && !arg.startsWith('-')) ?? process.cwd();

  if (verbose) {
    console.error(`[drift-mcp] Starting server for: ${projectRoot}`);
  }

  const server = createEnterpriseMCPServer({
    projectRoot,
    enableCache: !noCache,
    enableRateLimiting: !noRateLimit,
    enableMetrics: true,
    verbose,
    skipWarmup,
  });
  
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    await server.close();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    await server.close();
    process.exit(0);
  });
}

main().catch((error) => {
  console.error('Failed to start Drift MCP server:', error);
  process.exit(1);
});
