/**
 * Call Graph Store
 *
 * Persistence layer for the call graph.
 * Stores and loads call graphs from .drift/call-graph/ directory (legacy)
 * or .drift/lake/callgraph/ directory (sharded storage).
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type {
  CallGraph,
  SerializedCallGraph,
  CallGraphStoreConfig,
  FunctionNode,
} from '../types.js';

// ============================================================================
// Constants
// ============================================================================

const DRIFT_DIR = '.drift';
const CALL_GRAPH_DIR = 'call-graph';
const GRAPH_FILE = 'graph.json';
const REACHABILITY_CACHE_DIR = 'reachability-cache';

// Lake storage paths (new sharded format)
const LAKE_DIR = 'lake';
const LAKE_CALLGRAPH_DIR = 'callgraph';
const LAKE_INDEX_FILE = 'index.json';
const LAKE_FILES_DIR = 'files';

// ============================================================================
// Helper Functions
// ============================================================================

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

// ============================================================================
// Call Graph Store
// ============================================================================

/**
 * Call Graph Store - Manages call graph persistence
 */
export class CallGraphStore {
  private readonly config: CallGraphStoreConfig;
  private readonly callGraphDir: string;
  private readonly cacheDir: string;
  private graph: CallGraph | null = null;

  constructor(config: CallGraphStoreConfig) {
    this.config = config;
    this.callGraphDir = path.join(this.config.rootDir, DRIFT_DIR, CALL_GRAPH_DIR);
    this.cacheDir = path.join(this.callGraphDir, REACHABILITY_CACHE_DIR);
  }

  /**
   * Initialize the store
   */
  async initialize(): Promise<void> {
    await ensureDir(this.callGraphDir);
    await ensureDir(this.cacheDir);
    await this.load();
  }

  /**
   * Load the call graph from disk
   * 
   * Checks both legacy (.drift/call-graph/graph.json) and 
   * lake storage (.drift/lake/callgraph/) locations.
   */
  async load(): Promise<CallGraph | null> {
    // First, try lake storage (new sharded format)
    const lakeGraph = await this.loadFromLake();
    if (lakeGraph) {
      this.graph = lakeGraph;
      return this.graph;
    }

    // Fall back to legacy storage
    const filePath = path.join(this.callGraphDir, GRAPH_FILE);

    if (!(await fileExists(filePath))) {
      this.graph = null;
      return null;
    }

    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const serialized = JSON.parse(content) as SerializedCallGraph;
      this.graph = this.deserialize(serialized);
      return this.graph;
    } catch {
      this.graph = null;
      return null;
    }
  }

  /**
   * Load call graph from lake storage (sharded format)
   */
  private async loadFromLake(): Promise<CallGraph | null> {
    const lakeDir = path.join(this.config.rootDir, DRIFT_DIR, LAKE_DIR, LAKE_CALLGRAPH_DIR);
    const indexPath = path.join(lakeDir, LAKE_INDEX_FILE);
    const filesDir = path.join(lakeDir, LAKE_FILES_DIR);

    // Check if lake index exists
    if (!(await fileExists(indexPath))) {
      return null;
    }

    try {
      // Load the index
      const indexContent = await fs.readFile(indexPath, 'utf-8');
      const index = JSON.parse(indexContent);

      // Load all file shards and reconstruct the graph
      const functions = new Map<string, FunctionNode>();
      const entryPoints: string[] = [];
      const dataAccessors: string[] = [];

      // Check if files directory exists
      if (await fileExists(filesDir)) {
        const shardFiles = await fs.readdir(filesDir);
        
        for (const shardFile of shardFiles) {
          if (!shardFile.endsWith('.json')) continue;
          
          try {
            const shardPath = path.join(filesDir, shardFile);
            const shardContent = await fs.readFile(shardPath, 'utf-8');
            const shard = JSON.parse(shardContent);
            
            // Convert shard functions to FunctionNode format
            for (const fn of shard.functions ?? []) {
              const funcNode: FunctionNode = {
                id: fn.id,
                name: fn.name,
                qualifiedName: fn.name,
                file: shard.file,
                startLine: fn.startLine,
                endLine: fn.endLine,
                language: this.detectLanguage(shard.file),
                isExported: fn.isEntryPoint,
                isConstructor: false,
                isAsync: false,
                decorators: [],
                parameters: [],
                calls: fn.calls?.map((calleeName: string) => ({
                  calleeName,
                  calleeId: null,
                  callerId: fn.id,
                  line: fn.startLine,
                  column: 0,
                  resolved: false,
                  resolvedCandidates: [],
                  confidence: 0.5,
                  argumentCount: 0,
                  file: shard.file,
                })) ?? [],
                calledBy: fn.calledBy?.map((callerId: string) => ({
                  callerId,
                  calleeId: fn.id,
                  calleeName: fn.name,
                  line: 0,
                  column: 0,
                  resolved: true,
                  confidence: 1.0,
                })) ?? [],
                dataAccess: fn.dataAccess?.map((da: { table: string; operation: string; fields?: string[]; line: number }) => ({
                  id: `${fn.id}:${da.line}`,
                  file: shard.file,
                  table: da.table,
                  operation: da.operation as 'read' | 'write' | 'delete',
                  fields: da.fields ?? [],
                  line: da.line,
                  column: 0,
                  context: fn.name,
                  confidence: 1.0,
                  isRawSql: false,
                })) ?? [],
              };
              
              functions.set(fn.id, funcNode);
              
              if (fn.isEntryPoint) {
                entryPoints.push(fn.id);
              }
              if (fn.isDataAccessor) {
                dataAccessors.push(fn.id);
              }
            }
          } catch {
            // Skip invalid shard files
          }
        }
      }

      // Construct the CallGraph
      const graph: CallGraph = {
        version: index.version ?? '1.0.0',
        generatedAt: index.generatedAt ?? new Date().toISOString(),
        projectRoot: this.config.rootDir,
        functions,
        entryPoints,
        dataAccessors,
        stats: {
          totalFunctions: index.summary?.totalFunctions ?? functions.size,
          totalCallSites: index.summary?.totalCalls ?? 0,
          resolvedCallSites: 0,
          unresolvedCallSites: 0,
          totalDataAccessors: index.summary?.dataAccessors ?? dataAccessors.length,
          byLanguage: {
            python: 0,
            typescript: 0,
            javascript: 0,
            java: 0,
            csharp: 0,
            php: 0,
            go: 0,
            rust: 0,
            cpp: 0,
          },
        },
      };

      return graph;
    } catch {
      return null;
    }
  }

  /**
   * Detect language from file extension
   */
  private detectLanguage(file: string): 'python' | 'typescript' | 'javascript' | 'java' | 'csharp' | 'php' | 'go' | 'rust' | 'cpp' {
    const ext = path.extname(file).toLowerCase();
    switch (ext) {
      case '.py': return 'python';
      case '.ts':
      case '.tsx': return 'typescript';
      case '.js':
      case '.jsx': return 'javascript';
      case '.java': return 'java';
      case '.cs': return 'csharp';
      case '.php': return 'php';
      case '.go': return 'go';
      case '.rs': return 'rust';
      case '.cpp':
      case '.cc':
      case '.cxx':
      case '.c':
      case '.h':
      case '.hpp': return 'cpp';
      default: return 'typescript';
    }
  }

  /**
   * Save the call graph to disk
   */
  async save(graph: CallGraph): Promise<void> {
    await ensureDir(this.callGraphDir);

    const filePath = path.join(this.callGraphDir, GRAPH_FILE);
    const serialized = this.serialize(graph);

    await fs.writeFile(filePath, JSON.stringify(serialized, null, 2));
    this.graph = graph;

    // Clear reachability cache when graph changes
    await this.clearCache();
  }

  /**
   * Get the current call graph
   */
  getGraph(): CallGraph | null {
    return this.graph;
  }

  /**
   * Get a function by ID
   */
  getFunction(id: string): FunctionNode | undefined {
    return this.graph?.functions.get(id);
  }

  /**
   * Get functions in a file
   */
  getFunctionsInFile(file: string): FunctionNode[] {
    if (!this.graph) return [];

    const functions: FunctionNode[] = [];
    for (const [, func] of this.graph.functions) {
      if (func.file === file) {
        functions.push(func);
      }
    }
    return functions;
  }

  /**
   * Get function at a specific line
   */
  getFunctionAtLine(file: string, line: number): FunctionNode | null {
    if (!this.graph) return null;

    let best: FunctionNode | null = null;
    let bestSize = Infinity;

    for (const [, func] of this.graph.functions) {
      if (func.file === file && line >= func.startLine && line <= func.endLine) {
        const size = func.endLine - func.startLine;
        if (size < bestSize) {
          best = func;
          bestSize = size;
        }
      }
    }

    return best;
  }

  /**
   * Cache a reachability result
   */
  async cacheReachability(key: string, data: unknown): Promise<void> {
    const filePath = path.join(this.cacheDir, `${key}.json`);
    await fs.writeFile(filePath, JSON.stringify(data));
  }

  /**
   * Get a cached reachability result
   */
  async getCachedReachability<T>(key: string): Promise<T | null> {
    const filePath = path.join(this.cacheDir, `${key}.json`);

    if (!(await fileExists(filePath))) {
      return null;
    }

    try {
      const content = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(content) as T;
    } catch {
      return null;
    }
  }

  /**
   * Clear the reachability cache
   */
  async clearCache(): Promise<void> {
    try {
      const files = await fs.readdir(this.cacheDir);
      await Promise.all(
        files.map((file) => fs.unlink(path.join(this.cacheDir, file)))
      );
    } catch {
      // Ignore errors
    }
  }

  /**
   * Serialize a call graph for storage
   */
  private serialize(graph: CallGraph): SerializedCallGraph {
    const functions: Record<string, FunctionNode> = {};
    for (const [id, func] of graph.functions) {
      functions[id] = func;
    }

    return {
      version: graph.version,
      generatedAt: graph.generatedAt,
      projectRoot: graph.projectRoot,
      functions,
      entryPoints: graph.entryPoints,
      dataAccessors: graph.dataAccessors,
      stats: graph.stats,
    };
  }

  /**
   * Deserialize a call graph from storage
   */
  private deserialize(serialized: SerializedCallGraph): CallGraph {
    const functions = new Map<string, FunctionNode>();
    for (const [id, func] of Object.entries(serialized.functions)) {
      functions.set(id, func);
    }

    return {
      version: serialized.version,
      generatedAt: serialized.generatedAt,
      projectRoot: serialized.projectRoot,
      functions,
      entryPoints: serialized.entryPoints,
      dataAccessors: serialized.dataAccessors,
      stats: serialized.stats,
    };
  }
}

/**
 * Create a new CallGraphStore instance
 */
export function createCallGraphStore(config: CallGraphStoreConfig): CallGraphStore {
  return new CallGraphStore(config);
}
