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
import {
  createPatternStore,
  getStorageInfo,
  UnifiedStore,
} from 'driftdetect-core/storage';

// Infrastructure
import {
  handleError,
  rateLimiter,
  metrics,
  createCache,
  warmupStores,
  buildMissingData,
  logWarmupResult,
  getFilteredTools,
} from './infrastructure/index.js';

// Tool definitions

// Discovery handlers
import { handleAudit, type AuditArgs } from './tools/analysis/audit.js';
import { handleConstants } from './tools/analysis/constants.js';
import { handleConstraints, handleConstraintsWithSqlite } from './tools/analysis/constraints.js';
import { handleCoupling } from './tools/analysis/coupling.js';
import { handleErrorHandling } from './tools/analysis/error-handling.js';
import { handleTestTopology } from './tools/analysis/test-topology.js';
import { handleCodeExamples, handleCodeExamplesWithService } from './tools/detail/code-examples.js';
import { handlePatternGet, handlePatternGetWithService } from './tools/detail/pattern-get.js';
import { handleCapabilities } from './tools/discovery/capabilities.js';
import { handleStatus, handleStatusWithService } from './tools/discovery/status.js';

// Exploration handlers
import { handleContractsList, handleContractsListWithSqlite } from './tools/exploration/contracts-list.js';
import { handlePatternsList, handlePatternsListWithService } from './tools/exploration/patterns-list.js';
import { handleSecuritySummary, handleSecuritySummaryWithSqlite } from './tools/exploration/security-summary.js';
import { handleTrends } from './tools/exploration/trends.js';
import { handleEnv, handleEnvWithSqlite } from './tools/exploration/env.js';

// Detail handlers
import { handleFilesList } from './tools/detail/files-list.js';
import { handleFilePatterns } from './tools/detail/file-patterns.js';
import { handleImpactAnalysis } from './tools/detail/impact-analysis.js';
import { handleReachability } from './tools/detail/reachability.js';
import { handleDNAProfile, handleDNAProfileWithSqlite } from './tools/detail/dna-profile.js';
import { handleWrappers } from './tools/detail/wrappers.js';

// Discovery handlers (additional)
import { handleProjects } from './tools/discovery/projects.js';

// Orchestration handlers
import { handleExplain } from './tools/generation/explain.js';
import { handleSuggestChanges } from './tools/generation/suggest-changes.js';
import { handleValidateChange } from './tools/generation/validate-change.js';
import { handleContext, handlePackageContext } from './tools/orchestration/index.js';

// Setup handlers (project initialization)
import { handleSetup } from './tools/setup/handler.js';
import { handleTelemetry } from './tools/setup/telemetry-handler.js';

// Curation handlers (pattern approval with verification)
import { handleCurate } from './tools/curation/index.js';

// Analysis handlers (L5-L7 layers)
import { handleDecisions } from './tools/analysis/decisions.js';
import { handleSimulate } from './tools/analysis/simulate.js';
import { executeWpfTool, type WpfArgs } from './tools/analysis/wpf.js';
import { executeGoTool, type GoArgs } from './tools/analysis/go.js';
import { executeRustTool, type RustArgs } from './tools/analysis/rust.js';
import { executeCppTool, type CppArgs } from './tools/analysis/cpp.js';
import { executeTypeScriptTool, type TypeScriptArgs } from './tools/analysis/typescript.js';
import { executePythonTool, type PythonArgs } from './tools/analysis/python.js';
import { executeJavaTool, type JavaArgs } from './tools/analysis/java.js';
import { executePhpTool, type PhpArgs } from './tools/analysis/php.js';
import { executeIEC61131Tool, type IEC61131Args } from './tools/analysis/iec61131.js';
import { handleQualityGate } from './tools/analysis/quality-gate.js';
import { ALL_TOOLS, TOOL_CATEGORIES } from './tools/registry.js';

// Memory tool handlers
import {
  memoryStatus,
  memoryAdd,
  memorySearch,
  memoryGet,
  memoryValidate,
  memoryForContext,
  memoryLearn,
  driftWhy,
  driftMemoryExplain,
  driftMemoryFeedback,
  driftMemoryHealth,
  driftMemoryPredict,
  driftMemoryConflicts,
  driftMemoryGraph,
  driftMemoryQuery,
  driftMemoryContradictions,
} from './tools/memory/index.js';

// Cortex initialization
import { getCortex, resetCortex } from 'driftdetect-cortex';
import * as path from 'path';
import * as fs from 'fs';

// Surgical handlers (ultra-focused tools)
import { handleCallers } from './tools/surgical/callers.js';
import { handleDependencies } from './tools/surgical/dependencies.js';
import { handleErrors } from './tools/surgical/errors.js';
import { handleHooks } from './tools/surgical/hooks.js';
import { handleImports } from './tools/surgical/imports.js';
import { handleMiddleware } from './tools/surgical/middleware.js';
import { handlePrevalidate, handlePrevalidateWithService } from './tools/surgical/prevalidate.js';
import { handleRecent } from './tools/surgical/recent.js';
import { handleSignature } from './tools/surgical/signature.js';
import { handleSimilar } from './tools/surgical/similar.js';
import { handleTestTemplate } from './tools/surgical/test-template.js';
import { handleType } from './tools/surgical/type.js';

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

export async function createEnterpriseMCPServer(config: EnterpriseMCPConfig): Promise<Server> {
  const server = new Server(
    { name: 'drift-enterprise', version: '2.0.0' },
    { capabilities: { tools: {} } }
  );

  // Check storage backend info
  const storageInfo = getStorageInfo(config.projectRoot);
  
  if (config.verbose) {
    const backendLabel = storageInfo.backend === 'sqlite' ? 'SQLite' : 
                         storageInfo.backend === 'json' ? 'JSON' : 'None';
    console.error(`[drift-mcp] Storage backend: ${backendLabel}`);
  }

  // Initialize stores
  // Phase 3: Pattern store uses async factory for automatic SQLite support
  // Other stores remain synchronous for now
  const patternStore = await createPatternStore({ rootDir: config.projectRoot });
  
  // Phase 4: Initialize UnifiedStore for SQLite-backed data access
  // This provides direct SQLite access for tools that need it
  const unifiedStore = new UnifiedStore({ rootDir: config.projectRoot });
  await unifiedStore.initialize();
  
  const stores = {
    pattern: patternStore as PatternStore,
    manifest: new ManifestStore(config.projectRoot),
    history: new HistoryStore({ rootDir: config.projectRoot }),
    // Legacy JSON stores (kept for backward compatibility during migration)
    dna: new DNAStore({ rootDir: config.projectRoot }),
    boundary: new BoundaryStore({ rootDir: config.projectRoot }),
    contract: new ContractStore({ rootDir: config.projectRoot }),
    callGraph: new CallGraphStore({ rootDir: config.projectRoot }),
    env: new EnvStore({ rootDir: config.projectRoot }),
    // SQLite-backed unified store (preferred for new code)
    unified: unifiedStore,
  };

  // Initialize pattern service (wraps PatternStore with unified interface)
  // Default to using the new service for better abstraction
  const usePatternService = config.usePatternService !== false;
  const patternService: IPatternService | null = usePatternService
    ? createPatternServiceFromStore(stores.pattern as PatternStore, config.projectRoot, {
        enableCache: config.enableCache !== false,
      })
    : null;

  // Initialize data lake for optimized queries
  const dataLake = createDataLake({ rootDir: config.projectRoot });

  // Initialize cache if enabled
  const cache = config.enableCache !== false 
    ? createCache(config.projectRoot)
    : null;

  // Initialize Cortex memory system if memory directory exists
  const memoryDbPath = path.join(config.projectRoot, '.drift', 'memory', 'cortex.db');
  if (fs.existsSync(memoryDbPath)) {
    // Reset any existing instance and initialize with correct path
    resetCortex().then(() => {
      return getCortex({
        storage: { type: 'sqlite', sqlitePath: memoryDbPath },
        autoInitialize: true,
      });
    }).then(() => {
      if (config.verbose) {
        console.error('[drift-mcp] Cortex memory system initialized');
      }
    }).catch((error) => {
      if (config.verbose) {
        console.error('[drift-mcp] Cortex initialization failed:', error);
      }
    });
  }

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

  // Get filtered tools based on project languages
  const toolFilterResult = getFilteredTools(ALL_TOOLS, config.projectRoot);
  const filteredTools = toolFilterResult.tools;
  
  if (config.verbose) {
    console.error(`[drift-mcp] Detected languages: ${toolFilterResult.detectedLanguages.join(', ') || 'none'}`);
    console.error(`[drift-mcp] Exposing ${toolFilterResult.filteredCount}/${toolFilterResult.totalCount} tools`);
  }

  // List available tools (filtered by project language)
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    metrics.increment('tools.list');
    return { tools: filteredTools };
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
      
      // Check for project parameter or fall back to active project from registry
      const requestedProject = (args)['project'] as string | undefined;
      
      // Resolve the effective project root:
      // 1. For drift_setup: project parameter is a PATH, not a project name
      //    - Resolve it directly without registry lookup (project may not exist yet)
      //    - If no project specified, use config.projectRoot directly (not registry)
      // 2. For drift_projects with action="register": skip registry lookup
      //    - The project parameter is the name for the new project, not an existing one
      // 3. For other tools: use registry lookup
      // 4. Fall back to config.projectRoot
      const resolvedProjectRoot = await import('./infrastructure/project-resolver.js')
        .then(async (m) => {
          // Special handling for drift_setup: always use projectRoot or explicit path
          // Never use registry lookup - setup should work on the current directory
          if (name === 'drift_setup') {
            if (requestedProject) {
              // Resolve path: if absolute, use as-is; if relative, resolve from projectRoot
              const path = await import('node:path');
              let resolvedPath: string;
              if (path.isAbsolute(requestedProject)) {
                resolvedPath = path.normalize(requestedProject);
              } else {
                resolvedPath = path.resolve(config.projectRoot, requestedProject);
              }
              
              // Security check: ensure path is within projectRoot (prevent path traversal)
              const normalizedRoot = path.normalize(config.projectRoot);
              if (!resolvedPath.startsWith(normalizedRoot)) {
                throw new Error(`Path traversal detected: ${requestedProject} is outside project root`);
              }
              
              return resolvedPath;
            }
            // No project specified - use projectRoot directly (the MCP server's working directory)
            return config.projectRoot;
          }
          
          if (requestedProject) {
            // Special handling for drift_projects with action="register"
            // The project parameter is the NAME for the new project, not an existing one
            // The actual path comes from args.path
            if (name === 'drift_projects' && args['action'] === 'register') {
              // Use the path parameter if provided, otherwise use projectRoot
              const registerPath = args['path'] as string | undefined;
              if (registerPath) {
                const path = await import('node:path');
                let resolvedPath: string;
                if (path.isAbsolute(registerPath)) {
                  resolvedPath = path.normalize(registerPath);
                } else {
                  resolvedPath = path.resolve(config.projectRoot, registerPath);
                }
                
                // Security check: ensure path is within projectRoot (prevent path traversal)
                const normalizedRoot = path.normalize(config.projectRoot);
                if (!resolvedPath.startsWith(normalizedRoot)) {
                  throw new Error(`Path traversal detected: ${registerPath} is outside project root`);
                }
                
                return resolvedPath;
              }
              return config.projectRoot;
            }
            
            // For other tools, use registry lookup
            const resolved = await m.resolveProject(requestedProject, config.projectRoot);
            return resolved.projectRoot;
          }
          // No explicit project - check for active project in registry
          return m.getActiveProjectRoot(config.projectRoot);
        });
      
      if (resolvedProjectRoot !== config.projectRoot) {
        effectiveProjectRoot = resolvedProjectRoot;
        
        // Phase 3: Use async factory for dynamic project resolution
        // This automatically uses SQLite if available
        const dynamicPatternStore = await createPatternStore({ rootDir: effectiveProjectRoot });
        
        // Phase 4: Create UnifiedStore for SQLite-backed data access
        const dynamicUnifiedStore = new UnifiedStore({ rootDir: effectiveProjectRoot });
        await dynamicUnifiedStore.initialize();
        
        // Create temporary stores for this project
        effectiveStores = {
          pattern: dynamicPatternStore as PatternStore, // Cast for compatibility
          manifest: new ManifestStore(effectiveProjectRoot),
          history: new HistoryStore({ rootDir: effectiveProjectRoot }),
          dna: new DNAStore({ rootDir: effectiveProjectRoot }),
          boundary: new BoundaryStore({ rootDir: effectiveProjectRoot }),
          contract: new ContractStore({ rootDir: effectiveProjectRoot }),
          callGraph: new CallGraphStore({ rootDir: effectiveProjectRoot }),
          env: new EnvStore({ rootDir: effectiveProjectRoot }),
          unified: dynamicUnifiedStore,
        };
        effectiveDataLake = createDataLake({ rootDir: effectiveProjectRoot });
        effectivePatternService = config.usePatternService !== false
          ? createPatternServiceFromStore(effectiveStores.pattern, effectiveProjectRoot, {
              enableCache: config.enableCache !== false,
            })
          : null;
        
        // Initialize the other stores (pattern store already initialized by factory)
        await Promise.all([
          effectiveStores.boundary.initialize(),
          effectiveStores.contract.initialize(),
          effectiveStores.callGraph.initialize(),
        ]);
      }

      // Check cache - include project root in cache key for project isolation
      const cacheKey = cache?.generateKey(name, args, effectiveProjectRoot);
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

      // Invalidate cache on project switch to prevent stale data
      // This is critical for correct behavior when switching between projects
      if (name === 'drift_projects' && args['action'] === 'switch' && cache) {
        // Check if switch was successful
        try {
          const resultData = JSON.parse(result.content[0]?.text || '{}');
          if (resultData.success) {
            await cache.invalidateAll();
            metrics.increment('cache.invalidate_on_switch');
          }
        } catch {
          // Ignore parse errors
        }
      }

      // Cache result (but not project switch results as they change state)
      if (cache && cacheKey && result && !('isError' in result && result.isError)) {
        // Don't cache project management operations
        if (name !== 'drift_projects') {
          await cache.set(cacheKey, result);
        }
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
    unified: UnifiedStore;
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
  // Setup Tools (Project Initialization)
  // ============================================================================
  switch (name) {
    case 'drift_setup':
      return handleSetup(args, {
        projectRoot,
        cache: null, // Cache is handled at the server level
      });
    case 'drift_telemetry':
      return handleTelemetry(args as { action: 'status' | 'enable' | 'disable' }, {
        projectRoot,
      });
  }

  // ============================================================================
  // Curation Tools (Pattern Approval with Verification)
  // ============================================================================
  switch (name) {
    case 'drift_curate':
      return handleCurate(args as unknown as Parameters<typeof handleCurate>[0], {
        projectRoot,
      });
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
      // Prefer SQLite if unified store is available
      if (stores.unified) {
        return handleSecuritySummaryWithSqlite(stores.unified, args as Parameters<typeof handleSecuritySummaryWithSqlite>[1]);
      }
      return handleSecuritySummary(stores.boundary, args as Parameters<typeof handleSecuritySummary>[1]);
      
    case 'drift_contracts_list':
      // Prefer SQLite if unified store is available
      if (stores.unified) {
        return handleContractsListWithSqlite(stores.unified, args as Parameters<typeof handleContractsListWithSqlite>[1]);
      }
      return handleContractsList(stores.contract, args as Parameters<typeof handleContractsList>[1]);
      
    case 'drift_trends':
      return handleTrends(stores.history, args as Parameters<typeof handleTrends>[1]);
      
    case 'drift_env':
      // Prefer SQLite if unified store is available
      if (stores.unified) {
        return handleEnvWithSqlite(stores.unified, args as Parameters<typeof handleEnvWithSqlite>[1]);
      }
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
      // Prefer SQLite if unified store is available
      if (stores.unified) {
        return handleDNAProfileWithSqlite(stores.unified, args as Parameters<typeof handleDNAProfileWithSqlite>[1]);
      }
      return handleDNAProfile(stores.dna, args as Parameters<typeof handleDNAProfile>[1]);
      
    // Wrapper detection tools
    case 'drift_wrappers':
      return handleWrappers(args as Parameters<typeof handleWrappers>[0], projectRoot);
  }

  // ============================================================================
  // Surgical Tools (Ultra-focused, minimal-token tools)
  // ============================================================================
  switch (name) {
    case 'drift_signature':
      return handleSignature(stores.callGraph, args as unknown as Parameters<typeof handleSignature>[1]);
      
    case 'drift_callers':
      return handleCallers(stores.callGraph, args as unknown as Parameters<typeof handleCallers>[1]);
      
    case 'drift_imports':
      return handleImports(stores.callGraph, args as unknown as Parameters<typeof handleImports>[1]);
      
    case 'drift_prevalidate':
      if (patternService) {
        return handlePrevalidateWithService(patternService, args as unknown as Parameters<typeof handlePrevalidateWithService>[1]);
      }
      return handlePrevalidate(stores.pattern, args as unknown as Parameters<typeof handlePrevalidate>[1]);
      
    case 'drift_similar':
      return handleSimilar(stores.callGraph, stores.pattern, args as unknown as Parameters<typeof handleSimilar>[2]);
      
    case 'drift_type':
      return handleType(stores.callGraph, args as unknown as Parameters<typeof handleType>[1], projectRoot);
      
    case 'drift_recent':
      return handleRecent(args as unknown as Parameters<typeof handleRecent>[0], projectRoot);
      
    case 'drift_test_template':
      return handleTestTemplate(stores.callGraph, args as unknown as Parameters<typeof handleTestTemplate>[1], projectRoot);
      
    case 'drift_dependencies':
      return handleDependencies(args as unknown as Parameters<typeof handleDependencies>[0], projectRoot);
      
    case 'drift_middleware':
      return handleMiddleware(args as unknown as Parameters<typeof handleMiddleware>[0], projectRoot);
      
    case 'drift_hooks':
      return handleHooks(args as unknown as Parameters<typeof handleHooks>[0], projectRoot);
      
    case 'drift_errors':
      return handleErrors(stores.callGraph, args as unknown as Parameters<typeof handleErrors>[1], projectRoot);
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
      // Prefer SQLite for read operations (list, show)
      if (stores.unified) {
        return handleConstraintsWithSqlite(stores.unified, projectRoot, args as unknown as Parameters<typeof handleConstraintsWithSqlite>[2]);
      }
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

    case 'drift_iec61131':
      return executeIEC61131Tool(args as unknown as IEC61131Args, { projectRoot });

    case 'drift_constants':
      return handleConstants(projectRoot, args as Parameters<typeof handleConstants>[1]);

    case 'drift_quality_gate':
      return handleQualityGate(projectRoot, args as Parameters<typeof handleQualityGate>[1]);

    case 'drift_audit':
      return handleAudit(projectRoot, args as unknown as AuditArgs);
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

  // ============================================================================
  // Memory Tools (Cortex V2)
  // ============================================================================
  switch (name) {
    case 'drift_memory_status':
      return executeMemoryTool(memoryStatus, args);
      
    case 'drift_why':
      return executeMemoryTool(driftWhy, args);
      
    case 'drift_memory_for_context':
      return executeMemoryTool(memoryForContext, args);
      
    case 'drift_memory_search':
      return executeMemoryTool(memorySearch, args);
      
    case 'drift_memory_get':
      return executeMemoryTool(memoryGet, args);
      
    case 'drift_memory_add':
      return executeMemoryTool(memoryAdd, args);
      
    case 'drift_memory_learn':
      return executeMemoryTool(memoryLearn, args);
      
    case 'drift_memory_validate':
      return executeMemoryTool(memoryValidate, args);
      
    case 'drift_memory_explain':
      return executeMemoryTool(driftMemoryExplain, args);
      
    case 'drift_memory_feedback':
      return executeMemoryTool(driftMemoryFeedback, args);
      
    case 'drift_memory_health':
      return executeMemoryTool(driftMemoryHealth, args);
      
    case 'drift_memory_predict':
      return executeMemoryTool(driftMemoryPredict, args);
      
    case 'drift_memory_conflicts':
      return executeMemoryTool(driftMemoryConflicts, args);
      
    case 'drift_memory_graph':
      return executeMemoryTool(driftMemoryGraph, args);
      
    case 'drift_memory_query':
      return executeMemoryTool(driftMemoryQuery, args);
      
    case 'drift_memory_contradictions':
      return executeMemoryTool(driftMemoryContradictions, args);
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
 * Execute a memory tool and format the response
 */
async function executeMemoryTool(
  tool: { execute: (args: any) => Promise<any> },
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  try {
    const result = await tool.execute(args);
    return {
      content: [{
        type: 'text',
        text: JSON.stringify(result, null, 2),
      }],
    };
  } catch (error) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          error: error instanceof Error ? error.message : 'Unknown error',
          hint: 'Ensure Cortex is initialized. Run drift scan first.',
        }),
      }],
      isError: true,
    };
  }
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
