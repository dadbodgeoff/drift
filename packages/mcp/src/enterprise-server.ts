/**
 * Enterprise Drift MCP Server
 * 
 * Layered tool architecture following Block's pattern:
 * - Discovery: Lightweight status and capability tools
 * - Exploration: Paginated listing tools
 * - Detail: Focused single-item tools
 * 
 * Features:
 * - Token budget awareness
 * - Cursor-based pagination
 * - Structured error handling with recovery hints
 * - Response caching
 * - Rate limiting
 * - Metrics collection
 * 
 * MIGRATION: Now uses IPatternService for pattern operations.
 * The service provides a unified interface with caching and business logic.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import {
  PatternStore,
  ManifestStore,
  HistoryStore,
  DNAStore,
  BoundaryStore,
  ContractStore,
  CallGraphStore,
  createDataLake,
  createPatternServiceFromStore,
  type DataLake,
  type IPatternService,
} from 'driftdetect-core';

// Infrastructure
import {
  handleError,
  rateLimiter,
  metrics,
  createCache,
} from './infrastructure/index.js';

// Tool definitions
import { ALL_TOOLS, TOOL_CATEGORIES } from './tools/registry.js';

// Discovery handlers
import { handleStatus, handleStatusWithService } from './tools/discovery/status.js';
import { handleCapabilities } from './tools/discovery/capabilities.js';

// Exploration handlers
import { handlePatternsList, handlePatternsListWithService } from './tools/exploration/patterns-list.js';
import { handleSecuritySummary } from './tools/exploration/security-summary.js';
import { handleContractsList } from './tools/exploration/contracts-list.js';
import { handleTrends } from './tools/exploration/trends.js';

// Detail handlers
import { handlePatternGet, handlePatternGetWithService } from './tools/detail/pattern-get.js';
import { handleCodeExamples, handleCodeExamplesWithService } from './tools/detail/code-examples.js';
import { handleFilesList } from './tools/detail/files-list.js';
import { handleFilePatterns } from './tools/detail/file-patterns.js';
import { handleImpactAnalysis } from './tools/detail/impact-analysis.js';
import { handleReachability } from './tools/detail/reachability.js';
import { handleDNAProfile } from './tools/detail/dna-profile.js';

// Orchestration handlers
import { handleContext } from './tools/orchestration/index.js';

export interface EnterpriseMCPConfig {
  projectRoot: string;
  enableCache?: boolean;
  enableRateLimiting?: boolean;
  enableMetrics?: boolean;
  maxRequestsPerMinute?: number;
  /** Use the new IPatternService instead of direct PatternStore access */
  usePatternService?: boolean;
}

export function createEnterpriseMCPServer(config: EnterpriseMCPConfig): Server {
  const server = new Server(
    { name: 'drift-enterprise', version: '2.0.0' },
    { capabilities: { tools: {} } }
  );

  // Initialize stores
  const stores = {
    pattern: new PatternStore({ rootDir: config.projectRoot }),
    manifest: new ManifestStore(config.projectRoot),
    history: new HistoryStore({ rootDir: config.projectRoot }),
    dna: new DNAStore({ rootDir: config.projectRoot }),
    boundary: new BoundaryStore({ rootDir: config.projectRoot }),
    contract: new ContractStore({ rootDir: config.projectRoot }),
    callGraph: new CallGraphStore({ rootDir: config.projectRoot }),
  };

  // Initialize pattern service (wraps PatternStore with unified interface)
  // Default to using the new service for better abstraction
  const usePatternService = config.usePatternService !== false;
  const patternService: IPatternService | null = usePatternService
    ? createPatternServiceFromStore(stores.pattern, config.projectRoot, {
        enableCache: config.enableCache !== false,
      })
    : null;

  // Initialize data lake for optimized queries
  const dataLake = createDataLake({ rootDir: config.projectRoot });

  // Initialize cache if enabled
  const cache = config.enableCache !== false 
    ? createCache(config.projectRoot)
    : null;

  // List available tools
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    metrics.increment('tools.list');
    return { tools: ALL_TOOLS };
  });

  // Handle tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params;
    const startTime = Date.now();

    try {
      // Rate limiting
      if (config.enableRateLimiting !== false) {
        try {
          rateLimiter.checkLimit(name, 'default');
        } catch {
          metrics.increment('tools.rate_limited', { tool: name });
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                error: 'Rate limit exceeded',
                hint: 'Wait a moment before making more requests',
                retryAfter: 60,
              }),
            }],
            isError: true,
          };
        }
      }

      // Check cache
      const cacheKey = cache?.generateKey(name, args as Record<string, unknown>);
      if (cache && cacheKey) {
        const cached = await cache.get(cacheKey);
        if (cached) {
          metrics.increment('tools.cache_hit', { tool: name });
          return cached.data as { content: Array<{ type: string; text: string }> };
        }
      }

      // Route to handler
      const result = await routeToolCall(
        name, 
        args, 
        stores, 
        config.projectRoot, 
        dataLake,
        patternService
      );

      // Cache result
      if (cache && cacheKey && result && !('isError' in result && result.isError)) {
        await cache.set(cacheKey, result);
      }

      // Record metrics
      metrics.increment('tools.call', { tool: name });
      metrics.observe('tools.duration_ms', Date.now() - startTime, { tool: name });

      return result;

    } catch (error) {
      metrics.increment('tools.error', { tool: name });
      return handleError(error);
    }
  });

  return server;
}

async function routeToolCall(
  name: string,
  args: Record<string, unknown>,
  stores: {
    pattern: PatternStore;
    manifest: ManifestStore;
    history: HistoryStore;
    dna: DNAStore;
    boundary: BoundaryStore;
    contract: ContractStore;
    callGraph: CallGraphStore;
  },
  projectRoot: string,
  dataLake: DataLake,
  patternService: IPatternService | null
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  
  // ============================================================================
  // Orchestration Tools (Meta Layer - Start Here)
  // ============================================================================
  switch (name) {
    case 'drift_context':
      return handleContext(
        {
          pattern: stores.pattern,
          manifest: stores.manifest,
          boundary: stores.boundary,
          callGraph: stores.callGraph,
          dna: stores.dna,
        },
        projectRoot,
        args as Parameters<typeof handleContext>[2]
      );
  }

  // ============================================================================
  // Discovery Tools (Layer 1)
  // ============================================================================
  switch (name) {
    case 'drift_status':
      // Use new service if available, otherwise fall back to legacy store
      if (patternService) {
        return handleStatusWithService(patternService, args, dataLake);
      }
      return handleStatus(stores.pattern, args, dataLake);
      
    case 'drift_capabilities':
      return handleCapabilities(args);
  }

  // ============================================================================
  // Exploration Tools (Layer 2)
  // ============================================================================
  switch (name) {
    case 'drift_patterns_list':
      // Use new service if available, otherwise fall back to legacy store
      if (patternService) {
        return handlePatternsListWithService(
          patternService, 
          args as Parameters<typeof handlePatternsListWithService>[1], 
          dataLake
        );
      }
      return handlePatternsList(
        stores.pattern, 
        args as Parameters<typeof handlePatternsList>[1], 
        dataLake
      );
      
    case 'drift_security_summary':
      return handleSecuritySummary(stores.boundary, args as Parameters<typeof handleSecuritySummary>[1]);
      
    case 'drift_contracts_list':
      return handleContractsList(stores.contract, args as Parameters<typeof handleContractsList>[1]);
      
    case 'drift_trends':
      return handleTrends(stores.history, args as Parameters<typeof handleTrends>[1]);
  }

  // ============================================================================
  // Detail Tools (Layer 3)
  // ============================================================================
  switch (name) {
    // Pattern detail tools
    case 'drift_pattern_get':
      // Use new service if available, otherwise fall back to legacy store
      if (patternService) {
        return handlePatternGetWithService(
          patternService, 
          args as unknown as Parameters<typeof handlePatternGetWithService>[1]
        );
      }
      return handlePatternGet(stores.pattern, args as unknown as Parameters<typeof handlePatternGet>[1]);
      
    case 'drift_code_examples':
      // Use new service if available, otherwise fall back to legacy store
      if (patternService) {
        return handleCodeExamplesWithService(
          patternService,
          projectRoot,
          args as Parameters<typeof handleCodeExamplesWithService>[2]
        );
      }
      return handleCodeExamples(
        stores.pattern, 
        projectRoot, 
        args as Parameters<typeof handleCodeExamples>[2]
      );
    
    // File detail tools
    case 'drift_files_list':
      return handleFilesList(stores.manifest, args as Parameters<typeof handleFilesList>[1]);
      
    case 'drift_file_patterns':
      return handleFilePatterns(stores.manifest, args as Parameters<typeof handleFilePatterns>[1]);
    
    // Call graph analysis tools
    case 'drift_impact_analysis':
      return handleImpactAnalysis(projectRoot, args as Parameters<typeof handleImpactAnalysis>[1]);
      
    case 'drift_reachability':
      return handleReachability(projectRoot, args as Parameters<typeof handleReachability>[1]);
    
    // DNA tools
    case 'drift_dna_profile':
      return handleDNAProfile(stores.dna, args as Parameters<typeof handleDNAProfile>[1]);
  }

  // Unknown tool
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        error: `Unknown tool: ${name}`,
        hint: 'Use drift_capabilities to see available tools',
        availableTools: TOOL_CATEGORIES,
      }),
    }],
    isError: true,
  };
}

/**
 * Get tool categories for documentation
 */
export function getToolCategories() {
  return TOOL_CATEGORIES;
}

/**
 * Get all tools
 */
export function getAllTools() {
  return ALL_TOOLS;
}
