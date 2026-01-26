#!/usr/bin/env node
/**
 * Drift MCP HTTP Server Entry Point
 *
 * Exposes the MCP server over HTTP using SSE (Server-Sent Events) transport.
 * This enables running Drift MCP as a containerized service accessible via HTTP.
 *
 * Usage:
 *   drift-mcp-http                          # Run server on default port 3000
 *   drift-mcp-http --port 8080              # Run on custom port
 *   drift-mcp-http --project /path/to/proj  # Analyze specific project
 *
 * Environment Variables:
 *   PORT            - HTTP server port (default: 3000)
 *   PROJECT_ROOT    - Path to project to analyze (default: /project)
 *   ENABLE_CACHE    - Enable response caching (default: true)
 *   ENABLE_RATE_LIMIT - Enable rate limiting (default: true)
 *   VERBOSE         - Enable verbose logging (default: false)
 *
 * Endpoints:
 *   GET  /health     - Health check endpoint
 *   GET  /sse        - SSE endpoint for MCP communication
 *   POST /message    - Send messages to MCP server
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { createEnterpriseMCPServer } from '../enterprise-server.js';

// Configuration from environment variables
const PORT = parseInt(process.env['PORT'] ?? '3000', 10);
const PROJECT_ROOT = process.env['PROJECT_ROOT'] ?? '/project';
const ENABLE_CACHE = process.env['ENABLE_CACHE'] !== 'false';
const ENABLE_RATE_LIMIT = process.env['ENABLE_RATE_LIMIT'] !== 'false';
const VERBOSE = process.env['VERBOSE'] === 'true';
const SKIP_WARMUP = process.env['SKIP_WARMUP'] === 'true';

// Parse command line arguments
const args = process.argv.slice(2);
let port: number = PORT;
let projectRoot: string = PROJECT_ROOT;

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  const nextArg = args[i + 1];
  if (arg === '--port' && nextArg) {
    port = parseInt(nextArg, 10);
    i++;
  } else if (arg === '--project' && nextArg) {
    projectRoot = nextArg;
    i++;
  }
}

// Track active transports for cleanup
const activeTransports = new Map<string, SSEServerTransport>();
let transportIdCounter = 0;

// Create MCP server instance
const mcpServer = createEnterpriseMCPServer({
  projectRoot,
  enableCache: ENABLE_CACHE,
  enableRateLimiting: ENABLE_RATE_LIMIT,
  enableMetrics: true,
  verbose: VERBOSE,
  skipWarmup: SKIP_WARMUP,
});

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
 * Handle health check requests
 */
function handleHealthCheck(res: ServerResponse): void {
  setCorsHeaders(res);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    status: 'healthy',
    service: 'drift-mcp',
    projectRoot,
    activeConnections: activeTransports.size,
    timestamp: new Date().toISOString(),
  }));
}

/**
 * Handle SSE connection requests
 */
async function handleSSE(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const transportId = `transport-${++transportIdCounter}`;

  if (VERBOSE) {
    console.log(`[drift-mcp-http] New SSE connection: ${transportId}`);
  }

  setCorsHeaders(res);

  // Create SSE transport
  const transport = new SSEServerTransport('/message', res);
  activeTransports.set(transportId, transport);

  // Add transport ID header so client knows which ID to use for messages
  res.setHeader('X-Transport-Id', transportId);

  // Clean up on disconnect
  req.on('close', () => {
    if (VERBOSE) {
      console.log(`[drift-mcp-http] SSE connection closed: ${transportId}`);
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
 * Handle incoming HTTP requests
 */
async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
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
          version: '2.0.0',
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
}

// Create and start HTTP server
const server = createServer(async (req, res) => {
  try {
    await handleRequest(req, res);
  } catch (error) {
    console.error('[drift-mcp-http] Request error:', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Internal server error' }));
  }
});

// Graceful shutdown
async function shutdown(): Promise<void> {
  console.log('[drift-mcp-http] Shutting down...');

  // Close all SSE connections
  for (const [transportId] of activeTransports) {
    if (VERBOSE) {
      console.log(`[drift-mcp-http] Closing transport: ${transportId}`);
    }
    // The transport will be closed when we close the server
  }
  activeTransports.clear();

  // Close MCP server
  await mcpServer.close();

  // Close HTTP server
  server.close(() => {
    console.log('[drift-mcp-http] Server stopped');
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Start server
server.listen(port, '0.0.0.0', () => {
  console.log(`[drift-mcp-http] Server running at http://0.0.0.0:${port}`);
  console.log(`[drift-mcp-http] Project root: ${projectRoot}`);
  console.log(`[drift-mcp-http] Cache: ${ENABLE_CACHE ? 'enabled' : 'disabled'}`);
  console.log(`[drift-mcp-http] Rate limiting: ${ENABLE_RATE_LIMIT ? 'enabled' : 'disabled'}`);
});
