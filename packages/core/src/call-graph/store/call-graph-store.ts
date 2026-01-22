/**
 * Call Graph Store
 *
 * Persistence layer for the call graph.
 * Stores and loads call graphs from .drift/call-graph/ directory.
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
   */
  async load(): Promise<CallGraph | null> {
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
