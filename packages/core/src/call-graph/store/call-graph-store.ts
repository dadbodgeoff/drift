/**
 * Call Graph Store
 *
 * Persistence layer for the call graph.
 * Stores and loads call graphs from:
 * - .drift/lake/callgraph/callgraph.db (SQLite - preferred, native Rust)
 * - .drift/lake/callgraph/ (sharded JSON - legacy)
 * - .drift/call-graph/graph.json (single file JSON - deprecated)
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import {
  isNativeAvailable,
  isCallGraphAvailable,
} from '../../native/index.js';

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
const LAKE_SQLITE_FILE = 'callgraph.db';

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
   * Checks storage locations in order of preference:
   * 1. SQLite (.drift/lake/callgraph/callgraph.db) - native Rust, preferred
   * 2. Lake storage (.drift/lake/callgraph/) - sharded JSON
   * 3. Legacy storage (.drift/call-graph/graph.json) - single file JSON
   */
  async load(): Promise<CallGraph | null> {
    // First, try SQLite storage (native Rust - preferred)
    const sqliteGraph = await this.loadFromSqlite();
    if (sqliteGraph) {
      this.graph = sqliteGraph;
      return this.graph;
    }

    // Second, try lake storage (sharded JSON format)
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
   * Load call graph from SQLite storage (native Rust)
   * 
   * This is the preferred format for large codebases as it provides:
   * - O(1) memory usage (queries don't load entire graph)
   * - Fast indexed lookups
   * - Concurrent access support
   */
  private async loadFromSqlite(): Promise<CallGraph | null> {
    const sqlitePath = path.join(
      this.config.rootDir, 
      DRIFT_DIR, 
      LAKE_DIR, 
      LAKE_CALLGRAPH_DIR, 
      LAKE_SQLITE_FILE
    );

    // Check if SQLite database exists
    if (!(await fileExists(sqlitePath))) {
      return null;
    }

    // Check if native module is available
    if (!isNativeAvailable() || !isCallGraphAvailable(this.config.rootDir)) {
      return null;
    }

    try {
      // Import native functions dynamically to avoid circular deps
      const { 
        getCallGraphStats, 
        getCallGraphEntryPoints, 
        getCallGraphDataAccessors 
      } = await import('../../native/index.js');
      
      // Get stats from SQLite database
      const nativeStats = getCallGraphStats(this.config.rootDir);
      
      // Get entry points and data accessors with their details
      const entryPoints = getCallGraphEntryPoints(this.config.rootDir);
      const dataAccessors = getCallGraphDataAccessors(this.config.rootDir);
      
      // Create a functions Map with entry points and data accessors
      // This allows the CLI to display their details without loading the entire graph
      const functions = new Map<string, FunctionNode>();
      
      // Add entry points to functions map
      for (const ep of entryPoints) {
        functions.set(ep.id, {
          id: ep.id,
          name: ep.name,
          qualifiedName: ep.name,
          file: ep.file,
          startLine: ep.line,
          endLine: ep.line,
          language: this.detectLanguage(ep.file),
          isExported: true,
          isConstructor: false,
          isAsync: false,
          decorators: [],
          parameters: [],
          calls: [],
          calledBy: [],
          dataAccess: [],
        });
      }
      
      // Add data accessors to functions map (may overlap with entry points)
      for (const da of dataAccessors) {
        const existing = functions.get(da.id);
        if (existing) {
          // Update existing entry with data access info
          existing.dataAccess = da.tables.map(table => ({
            id: `${da.id}:${da.line}`,
            file: da.file,
            table,
            operation: 'read' as const,
            fields: [],
            line: da.line,
            column: 0,
            context: da.name,
            confidence: 1.0,
            isRawSql: false,
          }));
        } else {
          // Add new entry
          functions.set(da.id, {
            id: da.id,
            name: da.name,
            qualifiedName: da.name,
            file: da.file,
            startLine: da.line,
            endLine: da.line,
            language: this.detectLanguage(da.file),
            isExported: false,
            isConstructor: false,
            isAsync: false,
            decorators: [],
            parameters: [],
            calls: [],
            calledBy: [],
            dataAccess: da.tables.map(table => ({
              id: `${da.id}:${da.line}`,
              file: da.file,
              table,
              operation: 'read' as const,
              fields: [],
              line: da.line,
              column: 0,
              context: da.name,
              confidence: 1.0,
              isRawSql: false,
            })),
          });
        }
      }
      
      // Create a CallGraph structure with data from SQLite
      const graph: CallGraph = {
        version: '2.0.0-sqlite',
        generatedAt: new Date().toISOString(),
        projectRoot: this.config.rootDir,
        functions,
        entryPoints: entryPoints.map(ep => ep.id),
        dataAccessors: dataAccessors.map(da => da.id),
        stats: {
          totalFunctions: nativeStats?.totalFunctions ?? 0,
          totalCallSites: nativeStats?.totalCalls ?? 0,
          resolvedCallSites: nativeStats?.resolvedCalls ?? 0,
          unresolvedCallSites: (nativeStats?.totalCalls ?? 0) - (nativeStats?.resolvedCalls ?? 0),
          totalDataAccessors: nativeStats?.dataAccessors ?? 0,
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
            'structured-text': 0,
          },
        },
        _sqliteAvailable: true, // Internal flag to indicate SQLite mode
      };

      return graph;
    } catch {
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
          if (!shardFile.endsWith('.json')) {continue;}
          
          try {
            const shardPath = path.join(filesDir, shardFile);
            const shardContent = await fs.readFile(shardPath, 'utf-8');
            const shard = JSON.parse(shardContent);
            
            // Convert shard functions to FunctionNode format
            for (const fn of shard.functions ?? []) {
              // Handle both old format (string[]) and new format (CallEntry[])
              const calls = (fn.calls ?? []).map((call: string | { target: string; resolvedId?: string; resolved?: boolean; confidence?: number; line?: number }) => {
                // Old format: just a string (function name)
                if (typeof call === 'string') {
                  return {
                    calleeName: call,
                    calleeId: null,
                    callerId: fn.id,
                    line: fn.startLine,
                    column: 0,
                    resolved: false,
                    resolvedCandidates: [],
                    confidence: 0.5,
                    argumentCount: 0,
                    file: shard.file,
                  };
                }
                // New format: CallEntry object with target, resolvedId, etc.
                return {
                  calleeName: call.target,
                  calleeId: call.resolvedId ?? null,
                  callerId: fn.id,
                  line: call.line ?? fn.startLine,
                  column: 0,
                  resolved: call.resolved ?? false,
                  resolvedCandidates: [],
                  confidence: call.confidence ?? 0.5,
                  argumentCount: 0,
                  file: shard.file,
                };
              });

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
                calls,
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

      // Build reverse references (calledBy) from forward references (calls)
      // The sharded format only stores forward calls, so we need to reconstruct calledBy
      this.buildReverseReferences(functions);

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
          resolvedCallSites: index.summary?.resolvedCalls ?? 0,
          unresolvedCallSites: index.summary?.unresolvedCalls ?? 0,
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
            'structured-text': 0,
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
   * Build reverse references (calledBy) from forward references (calls)
   * 
   * The sharded format only stores forward calls (who this function calls),
   * so we need to reconstruct the reverse references (who calls this function).
   */
  private buildReverseReferences(functions: Map<string, FunctionNode>): void {
    // Build a map of function name -> function IDs for resolution (fallback)
    const nameToIds = new Map<string, string[]>();
    for (const [id, func] of functions) {
      const existing = nameToIds.get(func.name) ?? [];
      existing.push(id);
      nameToIds.set(func.name, existing);
    }

    // For each function, look at its calls and add reverse references
    for (const [callerId, callerFunc] of functions) {
      for (const call of callerFunc.calls) {
        // First, try to use the already-resolved calleeId from sharded storage
        // This is more accurate than name-based lookup
        if (call.calleeId) {
          const calleeFunc = functions.get(call.calleeId);
          if (calleeFunc) {
            // Check if this caller is already in calledBy
            const alreadyExists = calleeFunc.calledBy.some(cb => cb.callerId === callerId);
            if (!alreadyExists) {
              calleeFunc.calledBy.push({
                callerId,
                calleeId: call.calleeId,
                calleeName: calleeFunc.name,
                line: call.line,
                column: call.column ?? 0,
                resolved: true,
                confidence: call.confidence ?? 1.0,
                file: callerFunc.file,
                resolvedCandidates: [],
                argumentCount: 0,
              });
            }
            continue; // Skip name-based lookup since we found the callee
          }
        }

        // Fallback: Try to resolve the callee by name
        const calleeName = call.calleeName;
        const candidateIds = nameToIds.get(calleeName) ?? [];
        
        // Add calledBy reference to each candidate
        for (const calleeId of candidateIds) {
          const calleeFunc = functions.get(calleeId);
          if (calleeFunc) {
            // Check if this caller is already in calledBy
            const alreadyExists = calleeFunc.calledBy.some(cb => cb.callerId === callerId);
            if (!alreadyExists) {
              calleeFunc.calledBy.push({
                callerId,
                calleeId,
                calleeName: calleeFunc.name,
                line: call.line,
                column: call.column ?? 0,
                resolved: true,
                confidence: candidateIds.length === 1 ? 1.0 : 0.5,
                file: callerFunc.file,
                resolvedCandidates: [],
                argumentCount: 0,
              });
            }
            
            // Also update the call's calleeId if we found a unique match
            if (candidateIds.length === 1) {
              call.calleeId = calleeId;
              call.resolved = true;
              call.confidence = 1.0;
            }
          }
        }
      }
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
    if (!this.graph) {return [];}

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
    if (!this.graph) {return null;}

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
