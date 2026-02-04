#!/usr/bin/env node
/**
 * Drift MCP Server Entry Point
 * 
 * Usage:
 *   drift-mcp                       # Run server using detected project root
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
 * Project Detection Priority:
 * 1. Explicit path argument
 * 2. Active project from ~/.drift/projects.json
 * 3. Auto-detect: walk up from cwd looking for .git, package.json, etc.
 * 4. Fall back to cwd
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
 * Project root markers - files/directories that indicate a project root
 */
const PROJECT_MARKERS = [
  '.git',           // Git repository
  'package.json',   // Node.js/JavaScript
  'Cargo.toml',     // Rust
  'pyproject.toml', // Python (modern)
  'setup.py',       // Python (legacy)
  'go.mod',         // Go
  'pom.xml',        // Java Maven
  'build.gradle',   // Java Gradle
  'composer.json',  // PHP
  '*.sln',          // .NET Solution
  '*.csproj',       // C# Project
  'Gemfile',        // Ruby
  'mix.exs',        // Elixir
];

/**
 * Detect project root by walking up from startDir looking for project markers
 */
function detectProjectRoot(startDir: string): string | null {
  let currentDir = path.resolve(startDir);
  const root = path.parse(currentDir).root;
  
  while (currentDir !== root) {
    // Check for each marker
    for (const marker of PROJECT_MARKERS) {
      if (marker.includes('*')) {
        // Glob pattern - check if any matching files exist
        try {
          const files = fs.readdirSync(currentDir);
          const pattern = marker.replace('*', '');
          if (files.some(f => f.endsWith(pattern))) {
            return currentDir;
          }
        } catch {
          // Directory not readable, continue
        }
      } else {
        // Exact match
        const markerPath = path.join(currentDir, marker);
        if (fs.existsSync(markerPath)) {
          return currentDir;
        }
      }
    }
    
    // Move up one directory
    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) break; // Reached root
    currentDir = parentDir;
  }
  
  return null;
}

/**
 * Get the active project root with smart detection
 * 
 * Priority:
 * 1. Active project from ~/.drift/projects.json (if exists and valid)
 * 2. Auto-detect from cwd by walking up to find project markers
 * 3. Fall back to cwd
 */
function getActiveProjectRoot(): string {
  const cwd = process.cwd();
  
  // First, try to get from projects.json
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
    // Ignore errors, continue to auto-detection
  }
  
  // Auto-detect project root from cwd
  const detectedRoot = detectProjectRoot(cwd);
  if (detectedRoot) {
    return detectedRoot;
  }
  
  // Fall back to cwd
  return cwd;
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
