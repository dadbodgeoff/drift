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
  EnvStore,
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
  warmupStores,
  buildMissingData,
  logWarmupResult,
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
import { handleEnv } from './tools/exploration/env.js';

// Detail handlers
import { handlePatternGet, handlePatternGetWithService } from './tools/detail/pattern-get.js';
import { handleCodeExamples, handleCodeExamplesWithService } from './tools/detail/code-examples.js';
import { handleFilesList } from './tools/detail/files-list.js';
import { handleFilePatterns } from './tools/detail/file-patterns.js';
import { handleImpactAnalysis } from './tools/detail/impact-analysis.js';
import { handleReachability } from './tools/detail/reachability.js';
import { handleDNAProfile } from './tools/detail/dna-profile.js';
import { handleWrappers } from './tools/detail/wrappers.js';

// Discovery handlers (additional)
import { handleProjects } from './tools/discovery/projects.js';

// Orchestration handlers
import { handleContext, handlePackageContext } from './tools/orchestration/index.js';

// Generation handlers (new AI-powered tools)
import { handleSuggestChanges } from './tools/generation/suggest-changes.js';
import { handleValidateChange } from './tools/generation/validate-change.js';
import { handleExplain } from './tools/generation/explain.js';

// Analysis handlers (L5-L7 layers)
import { handleTestTopology } from './tools/analysis/test-topology.js';
import { handleCoupling } from './tools/analysis/coupling.js';
import { handleErrorHandling } from './tools/analysis/error-handling.js';
import { handleDecisions } from './tools/analysis/decisions.js';
import { handleSimulate } from './tools/analysis/simulate.js';
import { handleConstraints } from './tools/analysis/constraints.js';
import { executeWpfTool, type WpfArgs } from './tools/analysis/wpf.js';
import { executeGoTool, type GoArgs } from './tools/analysis/go.js';
import { executeRustTool, type RustArgs } from './tools/analysis/rust.js';
import { executeCppTool, type CppArgs } from './tools/analysis/cpp.js';
import { executeTypeScriptTool, type TypeScriptArgs } from './tools/analysis/typescript.js';
import { executePythonTool, type PythonArgs } from './tools/analysis/python.js';
import { executeJavaTool, type JavaArgs } from './tools/analysis/java.js';
import { executePhpTool, type PhpArgs } from './tools/analysis/php.js';
import { handleConstants } from './tools/analysis/constants.js';
import { handleQualityGate } from './tools/analysis/quality-gate.js';

export interface EnterpriseMCPConfig {
  projectRoot: string;
  enableCache?: boolean;
  enableRateLimiting?: boolean;
  enableMetrics?: boolean;
  maxRequestsPerMinute?: number;
  /** Use the new IPatternService instead of direct PatternStore access */
  usePatternService?: boolean;
  /** Enable verbose logging for warmup */
  verbose?: boolean;
  /** Skip warmup on startup (not recommended) */
  skipWarmup?: boolean;
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
    env: new EnvStore({ rootDir: config.projectRoot }),
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

  // Warm up stores on startup (async, non-blocking for server start)
  // This loads all .drift data into memory so tools work immediately
  if (config.skipWarmup !== true) {
    warmupStores(stores, config.projectRoot, dataLake)
      .then((result) => {
        logWarmupResult(result, config.verbose);
        
        // Build missing data in background (e.g., call graph)
        if (!result.loaded.callGraph) {
          buildMissingData(config.projectRoot, result.loaded).catch(() => {
            // Silently fail - user can build manually
          });
        }
      })
      .catch((error) => {
        if (config.verbose) {
          console.error('[drift-mcp] Warmup failed:', error);
        }
      });
  }

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

      // Dynamic project resolution: check if a different project is requested
      // or if the active project in the registry has changed
      let effectiveProjectRoot = config.projectRoot;
      let effectiveStores = stores;
      let effectiveDataLake = dataLake;
      let effectivePatternService = patternService;
      
      // Check for project parameter or active project change
      const requestedProject = (args as Record<string, unknown>)['project'] as string | undefined;
      if (requestedProject) {
        // User explicitly requested a different project
        const resolved = await import('./infrastructure/project-resolver.js')
          .then(m => m.resolveProject(requestedProject, config.projectRoot));
        
        if (resolved.projectRoot !== config.projectRoot) {
          effectiveProjectRoot = resolved.projectRoot;
          // Create temporary stores for this project
          effectiveStores = {
            pattern: new PatternStore({ rootDir: effectiveProjectRoot }),
            manifest: new ManifestStore(effectiveProjectRoot),
            history: new HistoryStore({ rootDir: effectiveProjectRoot }),
            dna: new DNAStore({ rootDir: effectiveProjectRoot }),
            boundary: new BoundaryStore({ rootDir: effectiveProjectRoot }),
            contract: new ContractStore({ rootDir: effectiveProjectRoot }),
            callGraph: new CallGraphStore({ rootDir: effectiveProjectRoot }),
            env: new EnvStore({ rootDir: effectiveProjectRoot }),
          };
          effectiveDataLake = createDataLake({ rootDir: effectiveProjectRoot });
          effectivePatternService = config.usePatternService !== false
            ? createPatternServiceFromStore(effectiveStores.pattern, effectiveProjectRoot, {
                enableCache: config.enableCache !== false,
              })
            : null;
          
          // Initialize the temporary stores
          await Promise.all([
            effectiveStores.pattern.initialize(),
            effectiveStores.boundary.initialize(),
            effectiveStores.contract.initialize(),
            effectiveStores.callGraph.initialize(),
          ]);
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
        effectiveStores, 
        effectiveProjectRoot, 
        effectiveDataLake,
        effectivePatternService
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
    env: EnvStore;
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
    case 'drift_package_context':
      return handlePackageContext(
        projectRoot,
        args as Parameters<typeof handlePackageContext>[1]
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
      
    case 'drift_projects':
      return handleProjects(args as Parameters<typeof handleProjects>[0]);
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
      
    case 'drift_env':
      return handleEnv(stores.env, args as Parameters<typeof handleEnv>[1]);
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
      return handleFilesList(projectRoot, args as Parameters<typeof handleFilesList>[1]);
      
    case 'drift_file_patterns':
      return handleFilePatterns(projectRoot, args as Parameters<typeof handleFilePatterns>[1]);
    
    // Call graph analysis tools
    case 'drift_impact_analysis':
      return handleImpactAnalysis(projectRoot, args as Parameters<typeof handleImpactAnalysis>[1]);
      
    case 'drift_reachability':
      return handleReachability(projectRoot, args as Parameters<typeof handleReachability>[1]);
    
    // DNA tools
    case 'drift_dna_profile':
      return handleDNAProfile(stores.dna, args as Parameters<typeof handleDNAProfile>[1]);
      
    // Wrapper detection tools
    case 'drift_wrappers':
      return handleWrappers(args as Parameters<typeof handleWrappers>[0], projectRoot);
  }

  // ============================================================================
  // Analysis Tools (L5-L7 Layers)
  // ============================================================================
  switch (name) {
    case 'drift_simulate':
      return handleSimulate(projectRoot, args as unknown as Parameters<typeof handleSimulate>[1]);
      
    case 'drift_test_topology':
      return handleTestTopology(projectRoot, args as unknown as Parameters<typeof handleTestTopology>[1]);
      
    case 'drift_coupling':
      return handleCoupling(projectRoot, args as unknown as Parameters<typeof handleCoupling>[1]);
      
    case 'drift_error_handling':
      return handleErrorHandling(projectRoot, args as unknown as Parameters<typeof handleErrorHandling>[1]);
      
    case 'drift_decisions':
      return handleDecisions(projectRoot, args as unknown as Parameters<typeof handleDecisions>[1]);
      
    case 'drift_constraints':
      return handleConstraints(projectRoot, args as unknown as Parameters<typeof handleConstraints>[1]);
      
    case 'drift_wpf':
      return executeWpfTool(args as unknown as WpfArgs, { projectRoot });

    case 'drift_go':
      return executeGoTool(args as unknown as GoArgs, { projectRoot });

    case 'drift_rust':
      return executeRustTool(args as unknown as RustArgs, { projectRoot });

    case 'drift_cpp':
      return executeCppTool(args as unknown as CppArgs, { projectRoot });

    case 'drift_typescript':
      return executeTypeScriptTool(args as unknown as TypeScriptArgs, { projectRoot });

    case 'drift_python':
      return executePythonTool(args as unknown as PythonArgs, { projectRoot });

    case 'drift_java':
      return executeJavaTool(args as unknown as JavaArgs, { projectRoot });

    case 'drift_php':
      return executePhpTool(args as unknown as PhpArgs, { projectRoot });

    case 'drift_constants':
      return handleConstants(projectRoot, args as Parameters<typeof handleConstants>[1]);

    case 'drift_quality_gate':
      return handleQualityGate(projectRoot, args as Parameters<typeof handleQualityGate>[1]);
  }

  // ============================================================================
  // Generation Tools (AI-Powered Code Intelligence)
  // ============================================================================
  switch (name) {
    case 'drift_suggest_changes':
      return handleSuggestChanges(
        { pattern: stores.pattern, boundary: stores.boundary },
        projectRoot,
        args as unknown as Parameters<typeof handleSuggestChanges>[2]
      );
      
    case 'drift_validate_change':
      return handleValidateChange(
        stores.pattern,
        projectRoot,
        args as unknown as Parameters<typeof handleValidateChange>[2]
      );
      
    case 'drift_explain':
      return handleExplain(
        {
          pattern: stores.pattern,
          manifest: stores.manifest,
          boundary: stores.boundary,
          callGraph: stores.callGraph,
        },
        projectRoot,
        args as unknown as Parameters<typeof handleExplain>[2]
      );
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
