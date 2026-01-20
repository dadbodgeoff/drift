#!/usr/bin/env node
/**
 * Drift MCP Server Entry Point
 * 
 * Usage:
 *   drift-mcp                    # Run in current directory
 *   drift-mcp /path/to/project   # Run for specific project
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
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createDriftMCPServer } from '../server.js';

async function main() {
  const projectRoot = process.argv[2] ?? process.cwd();

  const server = createDriftMCPServer({ projectRoot });
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
