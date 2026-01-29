/**
 * Startup Warmer - Pre-loads all .drift data on MCP server initialization
 * 
 * This ensures all stores are populated from the source of truth (.drift folder)
 * before any tool calls are made, eliminating the need for users to manually
 * run build commands.
 * 
 * Data loaded:
 * - Patterns (approved, discovered, ignored)
 * - Call graph
 * - Boundaries (data access map)
 * - Environment variables
 * - DNA profile
 * - Contracts
 * - History snapshots
 * - Module coupling
 * - Error handling analysis
 * - Test topology
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import {
  PatternStore,
  ManifestStore,
  HistoryStore,
  DNAStore,
  BoundaryStore,
  ContractStore,
  CallGraphStore,
  EnvStore,
  UnifiedCallGraphProvider,
  createUnifiedCallGraphProvider,
  type DataLake,
} from 'driftdetect-core';

export interface WarmupResult {
  success: boolean;
  duration: number;
  loaded: {
    patterns: number;
    callGraph: boolean;
    boundaries: boolean;
    env: number;
    dna: boolean;
    contracts: number;
    history: number;
    coupling: boolean;
    errorHandling: boolean;
    testTopology: boolean;
  };
  errors: string[];
}

export interface WarmupStores {
  pattern: PatternStore;
  manifest: ManifestStore;
  history: HistoryStore;
  dna: DNAStore;
  boundary: BoundaryStore;
  contract: ContractStore;
  callGraph: CallGraphStore;
  callGraphProvider?: UnifiedCallGraphProvider;
  env: EnvStore;
}

const DRIFT_DIR = '.drift';

/**
 * Check if drift is initialized in the project
 */
async function isDriftInitialized(projectRoot: string): Promise<boolean> {
  try {
    const driftPath = path.join(projectRoot, DRIFT_DIR);
    const stat = await fs.stat(driftPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Warm up all stores by loading data from .drift folder
 */
export async function warmupStores(
  stores: WarmupStores,
  projectRoot: string,
  dataLake?: DataLake
): Promise<WarmupResult> {
  const startTime = Date.now();
  const errors: string[] = [];
  const loaded = {
    patterns: 0,
    callGraph: false,
    boundaries: false,
    env: 0,
    dna: false,
    contracts: 0,
    history: 0,
    coupling: false,
    errorHandling: false,
    testTopology: false,
  };

  // Check if drift is initialized
  if (!(await isDriftInitialized(projectRoot))) {
    return {
      success: false,
      duration: Date.now() - startTime,
      loaded,
      errors: ['Drift not initialized. Run `drift init` first.'],
    };
  }

  // Initialize all stores in parallel where possible
  const initPromises: Promise<void>[] = [];

  // 1. Pattern Store
  initPromises.push(
    (async () => {
      try {
        await stores.pattern.initialize();
        const patterns = stores.pattern.getAll();
        loaded.patterns = patterns.length;
      } catch (e) {
        errors.push(`Pattern store: ${e instanceof Error ? e.message : String(e)}`);
      }
    })()
  );

  // 2. Manifest Store
  initPromises.push(
    (async () => {
      try {
        await stores.manifest.load();
      } catch (e) {
        errors.push(`Manifest store: ${e instanceof Error ? e.message : String(e)}`);
      }
    })()
  );

  // 3. History Store
  initPromises.push(
    (async () => {
      try {
        await stores.history.initialize();
        const snapshots = await stores.history.getSnapshots();
        loaded.history = snapshots.length;
      } catch (e) {
        errors.push(`History store: ${e instanceof Error ? e.message : String(e)}`);
      }
    })()
  );

  // 4. DNA Store
  initPromises.push(
    (async () => {
      try {
        await stores.dna.initialize();
        const profile = stores.dna.getProfile();
        loaded.dna = profile !== null;
      } catch (e) {
        errors.push(`DNA store: ${e instanceof Error ? e.message : String(e)}`);
      }
    })()
  );

  // 5. Boundary Store
  initPromises.push(
    (async () => {
      try {
        await stores.boundary.initialize();
        const accessMap = stores.boundary.getAccessMap();
        loaded.boundaries = Object.keys(accessMap).length > 0;
      } catch (e) {
        errors.push(`Boundary store: ${e instanceof Error ? e.message : String(e)}`);
      }
    })()
  );

  // 6. Contract Store
  initPromises.push(
    (async () => {
      try {
        await stores.contract.initialize();
        const contracts = stores.contract.getAll();
        loaded.contracts = contracts.length;
      } catch (e) {
        errors.push(`Contract store: ${e instanceof Error ? e.message : String(e)}`);
      }
    })()
  );

  // 7. Call Graph Store (supports both legacy and sharded formats)
  initPromises.push(
    (async () => {
      try {
        // Always initialize the CallGraphStore - it's used by surgical tools
        await stores.callGraph.initialize();
        const graph = stores.callGraph.getGraph();
        loaded.callGraph = graph !== null && graph.functions.size > 0;
        
        // Also try the unified provider for additional capabilities
        try {
          const provider = createUnifiedCallGraphProvider({ rootDir: projectRoot });
          await provider.initialize();
          
          if (provider.isAvailable()) {
            // Store the provider for tools that can use it
            stores.callGraphProvider = provider;
          }
        } catch {
          // Provider initialization failed, but we have the store
        }
      } catch (e) {
        errors.push(`Call graph store: ${e instanceof Error ? e.message : String(e)}`);
      }
    })()
  );

  // 8. Environment Store
  initPromises.push(
    (async () => {
      try {
        await stores.env.initialize();
        const accessMap = stores.env.getAccessMap();
        loaded.env = Object.keys(accessMap.variables || {}).length;
      } catch (e) {
        errors.push(`Env store: ${e instanceof Error ? e.message : String(e)}`);
      }
    })()
  );

  // 9. DataLake (if provided)
  if (dataLake) {
    initPromises.push(
      (async () => {
        try {
          await dataLake.initialize();
        } catch (e) {
          errors.push(`DataLake: ${e instanceof Error ? e.message : String(e)}`);
        }
      })()
    );
  }

  // Wait for all initializations
  await Promise.all(initPromises);

  // Check for additional analysis data
  const analysisChecks: Promise<void>[] = [];

  // Check coupling data
  analysisChecks.push(
    (async () => {
      try {
        const couplingPath = path.join(projectRoot, DRIFT_DIR, 'module-coupling', 'graph.json');
        await fs.access(couplingPath);
        loaded.coupling = true;
      } catch {
        // Not an error, just not built yet
      }
    })()
  );

  // Check error handling data
  analysisChecks.push(
    (async () => {
      try {
        const errorPath = path.join(projectRoot, DRIFT_DIR, 'error-handling', 'analysis.json');
        await fs.access(errorPath);
        loaded.errorHandling = true;
      } catch {
        // Not an error, just not built yet
      }
    })()
  );

  // Check test topology data
  analysisChecks.push(
    (async () => {
      try {
        const testPath = path.join(projectRoot, DRIFT_DIR, 'test-topology', 'mappings.json');
        await fs.access(testPath);
        loaded.testTopology = true;
      } catch {
        // Not an error, just not built yet
      }
    })()
  );

  await Promise.all(analysisChecks);

  return {
    success: errors.length === 0,
    duration: Date.now() - startTime,
    loaded,
    errors,
  };
}

/**
 * Build missing data if not present
 * This is a background operation that doesn't block startup
 * 
 * Note: Call graph building is complex and requires scanning the codebase.
 * For now, we just log a hint that the user should run `drift callgraph build`.
 */
export async function buildMissingData(
  _projectRoot: string,
  loaded: WarmupResult['loaded']
): Promise<void> {
  // Log hints for missing data
  const missing: string[] = [];
  
  if (!loaded.callGraph) {
    missing.push('call graph (run: drift callgraph build)');
  }
  if (!loaded.coupling) {
    missing.push('coupling analysis (run: drift coupling build)');
  }
  if (!loaded.errorHandling) {
    missing.push('error handling analysis (run: drift error-handling build)');
  }
  if (!loaded.testTopology) {
    missing.push('test topology (run: drift test-topology build)');
  }
  
  // We don't auto-build because it can be slow for large codebases
  // The user should run these commands manually or via CI
}

/**
 * Log warmup results for debugging
 */
export function logWarmupResult(result: WarmupResult, verbose = false): void {
  if (verbose) {
    console.error(`[drift-mcp] Warmup completed in ${result.duration}ms`);
    console.error(`[drift-mcp] Loaded: ${JSON.stringify(result.loaded)}`);
    if (result.errors.length > 0) {
      console.error(`[drift-mcp] Errors: ${result.errors.join(', ')}`);
    }
  }
}
