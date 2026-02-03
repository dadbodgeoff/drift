#!/usr/bin/env node
/**
 * Drift MCP HTTP Server Entry Point
 * 
 * Exposes the MCP server over HTTP using SSE (Server-Sent Events) transport.
 * This enables running Drift MCP as a containerized service accessible via HTTP.
 * 
 * Usage:
 *   drift-mcp-http                          # Run server using active project
 *   drift-mcp-http --port 8080              # Run on custom port
 *   drift-mcp-http --project /path/to/proj  # Analyze specific project
 * 
 * Environment Variables:
 *   PORT            - HTTP server port (default: 3000)
 *   PROJECT_ROOT    - Path to project to analyze (default: active project from ~/.drift)
 *   ENABLE_CACHE    - Enable response caching (default: true)
 *   ENABLE_RATE_LIMIT - Enable rate limiting (default: true)
 *   VERBOSE         - Enable verbose logging (default: false)
 * 
 * Endpoints:
 *   GET  /health     - Health check endpoint
 *   GET  /sse        - SSE endpoint for MCP communication
 *   POST /message    - Send messages to MCP server
 * 
 * Docker:
 *   docker compose up -d
 *   # Then configure your MCP client to connect to http://localhost:3000
 */

import { createServer, type IncomingMessage, type ServerResponse, type Server as HttpServer } from 'http';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { type Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';

import { createEnterpriseMCPServer } from '../enterprise-server.js';

// Server version (matches enterprise-server)
const SERVER_VERSION = '2.0.0';

// Track active transports for cleanup
const activeTransports = new Map<string, SSEServerTransport>();
let transportIdCounter = 0;

/**
 * Get the active project root from ~/.drift/projects.json
 * Falls back to /project (for Docker) or cwd
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
    // Ignore errors, fall back to defaults
  }
  
  // For Docker, /project is the default mount point
  if (fs.existsSync('/project')) {
    return '/project';
  }
  
  return process.cwd();
}

/**
 * Set CORS headers for cross-origin requests
 */
function setCorsHeaders(res: ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');
  res.setHeader('Access-Control-Expose-Headers', 'X-Transport-Id');
}

/**
 * Create health check handler
 */
function createHealthHandler(projectRoot: string) {
  return function handleHealthCheck(res: ServerResponse): void {
    setCorsHeaders(res);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'healthy',
      service: 'drift-mcp',
      version: SERVER_VERSION,
      projectRoot,
      activeConnections: activeTransports.size,
      timestamp: new Date().toISOString(),
    }));
  };
}

/**
 * Create SSE connection handler
 */
function createSSEHandler(mcpServer: Server, verbose: boolean) {
  return async function handleSSE(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const transportId = `transport-${++transportIdCounter}`;

    if (verbose) {
      console.error(`[drift-mcp-http] New SSE connection: ${transportId}`);
    }

    setCorsHeaders(res);

    // Create SSE transport
    const transport = new SSEServerTransport('/message', res);
    activeTransports.set(transportId, transport);

    // Add transport ID header so client knows which ID to use for messages
    res.setHeader('X-Transport-Id', transportId);

    // Clean up on disconnect
    req.on('close', () => {
      if (verbose) {
        console.error(`[drift-mcp-http] SSE connection closed: ${transportId}`);
      }
      activeTransports.delete(transportId);
    });

    // Connect to MCP server
    try {
      await mcpServer.connect(transport);
    } catch (error) {
      console.error(`[drift-mcp-http] Failed to connect transport ${transportId}:`, error);
      activeTransports.delete(transportId);
    }
  };
}

/**
 * Handle message POST requests
 */
async function handleMessage(req: IncomingMessage, res: ServerResponse): Promise<void> {
  setCorsHeaders(res);

  // Read body
  let body = '';
  for await (const chunk of req) {
    body += chunk;
  }

  try {
    // Find the transport to use
    // The transport ID can be passed in the URL or we use the most recent one
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
    const transportId = url.searchParams.get('transportId');

    let transport: SSEServerTransport | undefined;

    if (transportId) {
      transport = activeTransports.get(transportId);
    } else {
      // Use the most recent transport
      const entries = Array.from(activeTransports.entries());
      const lastEntry = entries[entries.length - 1];
      if (lastEntry) {
        transport = lastEntry[1];
      }
    }

    if (!transport) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: 'No active SSE connection',
        hint: 'Connect to /sse first before sending messages',
      }));
      return;
    }

    // Parse and forward the message
    const message = JSON.parse(body);
    await transport.handlePostMessage(req, res, message);
  } catch (error) {
    console.error('[drift-mcp-http] Message handling error:', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    }));
  }
}

/**
 * Create request router
 */
function createRequestHandler(
  handleHealthCheck: (res: ServerResponse) => void,
  handleSSE: (req: IncomingMessage, res: ServerResponse) => Promise<void>,
  projectRoot: string
) {
  return async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
    const pathname = url.pathname;
    const method = req.method?.toUpperCase();

    // Handle CORS preflight
    if (method === 'OPTIONS') {
      setCorsHeaders(res);
      res.writeHead(204);
      res.end();
      return;
    }

    // Route requests
    switch (pathname) {
      case '/health':
        handleHealthCheck(res);
        break;

      case '/sse':
        if (method === 'GET') {
          await handleSSE(req, res);
        } else {
          res.writeHead(405, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Method not allowed' }));
        }
        break;

      case '/message':
        if (method === 'POST') {
          await handleMessage(req, res);
        } else {
          res.writeHead(405, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Method not allowed' }));
        }
        break;

      default:
        // Root endpoint - provide API info
        if (pathname === '/' && method === 'GET') {
          setCorsHeaders(res);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            name: 'Drift MCP Server',
            version: SERVER_VERSION,
            description: 'MCP server for codebase intelligence',
            endpoints: {
              '/health': 'Health check endpoint (GET)',
              '/sse': 'SSE endpoint for MCP communication (GET)',
              '/message': 'Send messages to MCP server (POST)',
            },
            projectRoot,
            documentation: 'https://github.com/dadbodgeoff/drift',
          }));
        } else {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Not found' }));
        }
    }
  };
}

/**
 * Create graceful shutdown handler
 */
function createShutdownHandler(mcpServer: Server, httpServer: HttpServer, verbose: boolean) {
  return async function shutdown(): Promise<void> {
    console.error('[drift-mcp-http] Shutting down...');

    // Close all SSE connections
    for (const [transportId] of activeTransports) {
      if (verbose) {
        console.error(`[drift-mcp-http] Closing transport: ${transportId}`);
      }
    }
    activeTransports.clear();

    // Close MCP server
    await mcpServer.close();

    // Close HTTP server
    httpServer.close(() => {
      console.error('[drift-mcp-http] Server stopped');
      process.exit(0);
    });
  };
}

async function main() {
  // Configuration from environment variables
  const envPort = parseInt(process.env['PORT'] ?? '3000', 10);
  const envProjectRoot = process.env['PROJECT_ROOT'];
  const enableCache = process.env['ENABLE_CACHE'] !== 'false';
  const enableRateLimit = process.env['ENABLE_RATE_LIMIT'] !== 'false';
  const verbose = process.env['VERBOSE'] === 'true';
  const skipWarmup = process.env['SKIP_WARMUP'] === 'true';

  // Parse command line arguments (override env vars)
  const args = process.argv.slice(2);
  let port = envPort;
  let projectRoot = envProjectRoot;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const nextArg = args[i + 1];
    if (arg === '--port' && nextArg) {
      port = parseInt(nextArg, 10);
      i++;
    } else if (arg === '--project' && nextArg) {
      projectRoot = nextArg;
      i++;
    } else if (arg === '--verbose' || arg === '-v') {
      // Allow --verbose flag like the stdio server
    }
  }

  // If no project root specified, use active project from ~/.drift/projects.json
  if (!projectRoot) {
    projectRoot = getActiveProjectRoot();
  }

  if (verbose) {
    console.error(`[drift-mcp-http] Starting server for: ${projectRoot}`);
  }

  // Create MCP server instance
  const mcpServer = await createEnterpriseMCPServer({
    projectRoot,
    enableCache,
    enableRateLimiting: enableRateLimit,
    enableMetrics: true,
    verbose,
    skipWarmup,
  });

  // Create handlers
  const handleHealthCheck = createHealthHandler(projectRoot);
  const handleSSE = createSSEHandler(mcpServer, verbose);
  const handleRequest = createRequestHandler(handleHealthCheck, handleSSE, projectRoot);

  // Create HTTP server
  const httpServer = createServer(async (req, res) => {
    try {
      await handleRequest(req, res);
    } catch (error) {
      console.error('[drift-mcp-http] Request error:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal server error' }));
    }
  });

  // Setup graceful shutdown
  const shutdown = createShutdownHandler(mcpServer, httpServer, verbose);
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Start server
  httpServer.listen(port, '0.0.0.0', () => {
    console.error(`[drift-mcp-http] Server running at http://0.0.0.0:${port}`);
    console.error(`[drift-mcp-http] Project root: ${projectRoot}`);
    console.error(`[drift-mcp-http] Cache: ${enableCache ? 'enabled' : 'disabled'}`);
    console.error(`[drift-mcp-http] Rate limiting: ${enableRateLimit ? 'enabled' : 'disabled'}`);
  });
}

main().catch((error) => {
  console.error('Failed to start Drift MCP HTTP server:', error);
  process.exit(1);
});
