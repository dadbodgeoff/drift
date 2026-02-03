#!/usr/bin/env node
/**
 * Drift MCP Server Entry Point
 * 
 * Usage:
 *   drift-mcp                       # Run server using active project from ~/.drift/projects.json
 *   drift-mcp /path/to/project      # Run for specific project
 *   drift-mcp --no-cache            # Disable response caching
 *   drift-mcp --no-rate-limit       # Disable rate limiting
 * 
 * MCP Config (add to mcp.json):
 * {
 *   "mcpServers": {
 *     "drift": {
 *       "command": "drift-mcp"
 *     }
 *   }
 * }
 * 
 * Note: No path argument needed! The server automatically uses the active project
 * from ~/.drift/projects.json. Use `drift projects switch <name>` to change projects.
 * 
 * Features:
 * - DataLake as central source of truth (pre-computed views, sharded storage)
 * - Layered tool architecture (orchestration → discovery → exploration → detail)
 * - Intent-aware context synthesis via drift_context
 * - Token budget awareness and cursor-based pagination
 * - Structured error handling with recovery hints
 * - Response caching, rate limiting, and metrics
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { createEnterpriseMCPServer } from '../enterprise-server.js';

/**
 * Get the active project root from ~/.drift/projects.json
 * Falls back to cwd if no active project is found
 */
function getActiveProjectRoot(): string {
  const globalDriftDir = path.join(os.homedir(), '.drift');
  const projectsFile = path.join(globalDriftDir, 'projects.json');
  
  try {
    if (fs.existsSync(projectsFile)) {
      const content = fs.readFileSync(projectsFile, 'utf-8');
      const data = JSON.parse(content);
      
      // Find the active project
      if (data.projects && Array.isArray(data.projects)) {
        const activeProject = data.projects.find((p: { isActive?: boolean }) => p.isActive === true);
        if (activeProject?.path && fs.existsSync(activeProject.path)) {
          return activeProject.path;
        }
        
        // If no active project, use the most recently accessed one
        const sortedProjects = [...data.projects]
          .filter((p: { path?: string }) => p.path && fs.existsSync(p.path))
          .sort((a: { lastAccessedAt?: string }, b: { lastAccessedAt?: string }) => {
            const aTime = a.lastAccessedAt ? new Date(a.lastAccessedAt).getTime() : 0;
            const bTime = b.lastAccessedAt ? new Date(b.lastAccessedAt).getTime() : 0;
            return bTime - aTime;
          });
        
        if (sortedProjects.length > 0) {
          return sortedProjects[0].path;
        }
      }
    }
  } catch {
    // Ignore errors, fall back to cwd
  }
  
  return process.cwd();
}

async function main() {
  const args = process.argv.slice(2);
  
  // Parse flags
  const noCache = args.includes('--no-cache');
  const noRateLimit = args.includes('--no-rate-limit');
  const verbose = args.includes('--verbose') || args.includes('-v');
  const skipWarmup = args.includes('--skip-warmup');
  
  // Get project root:
  // 1. First non-flag argument if provided
  // 2. Otherwise, active project from ~/.drift/projects.json
  // 3. Fall back to cwd
  const explicitPath = args.find(arg => !arg.startsWith('--') && !arg.startsWith('-'));
  const projectRoot = explicitPath ?? getActiveProjectRoot();

  if (verbose) {
    console.error(`[drift-mcp] Starting server for: ${projectRoot}`);
    if (!explicitPath) {
      console.error(`[drift-mcp] Using active project from ~/.drift/projects.json`);
    }
  }

  const server = await createEnterpriseMCPServer({
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
