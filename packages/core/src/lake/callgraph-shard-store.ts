/**
 * Call Graph Shard Store
 *
 * Manages sharded call graph storage - one file per source file.
 * This allows loading only the call graph data you need.
 *
 * Storage structure:
 * .drift/lake/callgraph/
 *   ├── index.json           # Call graph summary index
 *   ├── entry-points.json    # API entry points
 *   └── files/
 *       ├── {file-hash}.json # Functions in each source file
 *       └── ...
 *
 * Key features:
 * - Load call graph by file (not all at once)
 * - Pre-computed entry points
 * - Incremental updates per file
 */

import * as crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import {
  LAKE_DIRS,
  DEFAULT_DATA_LAKE_CONFIG,
} from './types.js';

import type {
  CallGraphShard,
  FunctionEntry,
  DataAccessRef,
  DataLakeConfig,
} from './types.js';


// ============================================================================
// Constants
// ============================================================================

const CALLGRAPH_DIR = 'callgraph';
const FILES_SUBDIR = 'files';
const INDEX_FILE = 'index.json';
const ENTRY_POINTS_FILE = 'entry-points.json';
const STORE_VERSION = '1.0.0';

// ============================================================================
// Types
// ============================================================================

export interface CallGraphIndex {
  version: string;
  generatedAt: string;
  summary: {
    totalFiles: number;
    totalFunctions: number;
    totalCalls: number;
    resolvedCalls: number;
    unresolvedCalls: number;
    resolutionRate: number;
    entryPoints: number;
    dataAccessors: number;
    avgDepth: number;
  };
  files: FileIndexEntry[];
  topEntryPoints: EntryPointSummary[];
  topDataAccessors: DataAccessorSummary[];
}

export interface FileIndexEntry {
  file: string;
  fileHash: string;
  functionCount: number;
  entryPointCount: number;
  dataAccessorCount: number;
  lastUpdated: string;
}

export interface EntryPointSummary {
  id: string;
  name: string;
  file: string;
  line: number;
  reachableFunctions: number;
  reachableTables: number;
}

export interface DataAccessorSummary {
  id: string;
  name: string;
  file: string;
  line: number;
  tables: string[];
  operations: string[];
}

export interface EntryPointsData {
  version: string;
  generatedAt: string;
  entryPoints: EntryPointDetail[];
}

export interface EntryPointDetail {
  id: string;
  name: string;
  file: string;
  line: number;
  endLine: number;
  type: 'api' | 'handler' | 'controller' | 'route' | 'other';
  httpMethod?: string;
  path?: string;
  reachableFunctions: string[];
  reachableTables: string[];
  reachableSensitiveFields: string[];
}

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

function generateChecksum(data: unknown): string {
  const content = JSON.stringify(data);
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
}

function hashFilePath(file: string): string {
  return crypto.createHash('sha256').update(file).digest('hex').slice(0, 12);
}

// ============================================================================
// Call Graph Shard Store Class
// ============================================================================

export class CallGraphShardStore extends EventEmitter {
  private readonly config: DataLakeConfig;
  private readonly callgraphDir: string;
  private readonly filesDir: string;

  // In-memory cache
  private indexCache: CallGraphIndex | null = null;
  private entryPointsCache: EntryPointsData | null = null;
  private fileCache: Map<string, CallGraphShard> = new Map();

  constructor(config: Partial<DataLakeConfig> = {}) {
    super();
    this.config = { ...DEFAULT_DATA_LAKE_CONFIG, ...config };
    this.callgraphDir = path.join(
      this.config.rootDir,
      LAKE_DIRS.root,
      LAKE_DIRS.lake,
      CALLGRAPH_DIR
    );
    this.filesDir = path.join(this.callgraphDir, FILES_SUBDIR);
  }

  // ==========================================================================
  // Initialization
  // ==========================================================================

  async initialize(): Promise<void> {
    await ensureDir(this.callgraphDir);
    await ensureDir(this.filesDir);
  }

  // ==========================================================================
  // Index Operations
  // ==========================================================================

  /**
   * Get the call graph index
   */
  async getIndex(): Promise<CallGraphIndex | null> {
    if (this.indexCache) {
      return this.indexCache;
    }

    const indexPath = path.join(this.callgraphDir, INDEX_FILE);
    if (!(await fileExists(indexPath))) {
      return null;
    }

    try {
      const content = await fs.readFile(indexPath, 'utf-8');
      this.indexCache = JSON.parse(content);
      return this.indexCache;
    } catch {
      return null;
    }
  }

  /**
   * Save the call graph index
   */
  async saveIndex(index: CallGraphIndex): Promise<void> {
    await ensureDir(this.callgraphDir);
    
    const indexPath = path.join(this.callgraphDir, INDEX_FILE);
    await fs.writeFile(indexPath, JSON.stringify(index, null, 2));
    
    this.indexCache = index;
    this.emit('index:saved');
  }

  /**
   * Build call graph index from file shards
   */
  async buildIndex(): Promise<CallGraphIndex> {
    const fileHashes = await this.listFiles();
    const fileEntries: FileIndexEntry[] = [];
    const entryPoints: EntryPointSummary[] = [];
    const dataAccessors: DataAccessorSummary[] = [];
    
    let totalFunctions = 0;
    let totalCalls = 0;
    let resolvedCalls = 0;
    let totalEntryPoints = 0;
    let totalDataAccessors = 0;
    let totalDepth = 0;

    for (const fileHash of fileHashes) {
      const shard = await this.getFileShard(fileHash);
      if (!shard) {continue;}

      const entryPointCount = shard.functions.filter(f => f.isEntryPoint).length;
      const dataAccessorCount = shard.functions.filter(f => f.isDataAccessor).length;
      
      // Count calls and resolved calls
      let fileCallCount = 0;
      let fileResolvedCount = 0;
      for (const fn of shard.functions) {
        for (const call of fn.calls) {
          fileCallCount++;
          // Handle both old format (string[]) and new format (CallEntry[])
          if (typeof call === 'object' && call.resolved) {
            fileResolvedCount++;
          }
        }
      }

      totalFunctions += shard.functions.length;
      totalCalls += fileCallCount;
      resolvedCalls += fileResolvedCount;
      totalEntryPoints += entryPointCount;
      totalDataAccessors += dataAccessorCount;

      fileEntries.push({
        file: shard.file,
        fileHash,
        functionCount: shard.functions.length,
        entryPointCount,
        dataAccessorCount,
        lastUpdated: new Date().toISOString(),
      });

      // Collect entry points
      for (const fn of shard.functions.filter(f => f.isEntryPoint)) {
        entryPoints.push({
          id: fn.id,
          name: fn.name,
          file: shard.file,
          line: fn.startLine,
          reachableFunctions: 0, // Would need full graph traversal
          reachableTables: fn.dataAccess.length,
        });
      }

      // Collect data accessors
      for (const fn of shard.functions.filter(f => f.isDataAccessor)) {
        const tables = [...new Set(fn.dataAccess.map(da => da.table))];
        const operations = [...new Set(fn.dataAccess.map(da => da.operation))];
        
        dataAccessors.push({
          id: fn.id,
          name: fn.name,
          file: shard.file,
          line: fn.startLine,
          tables,
          operations,
        });
      }
    }

    // Calculate average depth (simplified)
    const avgDepth = totalFunctions > 0 ? totalCalls / totalFunctions : 0;
    totalDepth = avgDepth;
    
    // Calculate resolution rate
    const resolutionRate = totalCalls > 0 ? Math.round((resolvedCalls / totalCalls) * 100) / 100 : 0;

    // Sort and limit
    entryPoints.sort((a, b) => b.reachableTables - a.reachableTables);
    dataAccessors.sort((a, b) => b.tables.length - a.tables.length);

    const index: CallGraphIndex = {
      version: STORE_VERSION,
      generatedAt: new Date().toISOString(),
      summary: {
        totalFiles: fileEntries.length,
        totalFunctions,
        totalCalls,
        resolvedCalls,
        unresolvedCalls: totalCalls - resolvedCalls,
        resolutionRate,
        entryPoints: totalEntryPoints,
        dataAccessors: totalDataAccessors,
        avgDepth: Math.round(totalDepth * 100) / 100,
      },
      files: fileEntries,
      topEntryPoints: entryPoints.slice(0, 10),
      topDataAccessors: dataAccessors.slice(0, 10),
    };

    await this.saveIndex(index);
    return index;
  }

  // ==========================================================================
  // File Shard Operations
  // ==========================================================================

  /**
   * Get call graph data for a specific file
   */
  async getFileShard(fileHash: string): Promise<CallGraphShard | null> {
    // Check cache first
    const cached = this.fileCache.get(fileHash);
    if (cached) {
      return cached;
    }

    const filePath = path.join(this.filesDir, `${fileHash}.json`);
    if (!(await fileExists(filePath))) {
      return null;
    }

    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const data = JSON.parse(content);
      const shard: CallGraphShard = {
        file: data.file,
        functions: data.functions,
      };
      
      this.fileCache.set(fileHash, shard);
      return shard;
    } catch {
      return null;
    }
  }

  /**
   * Get call graph data for a file by path
   */
  async getFileShardByPath(file: string): Promise<CallGraphShard | null> {
    const fileHash = hashFilePath(file);
    return this.getFileShard(fileHash);
  }

  /**
   * Save call graph data for a file
   */
  async saveFileShard(shard: CallGraphShard): Promise<void> {
    await ensureDir(this.filesDir);
    
    const fileHash = hashFilePath(shard.file);
    const filePath = path.join(this.filesDir, `${fileHash}.json`);
    const shardFile = {
      version: STORE_VERSION,
      generatedAt: new Date().toISOString(),
      checksum: generateChecksum(shard.functions),
      ...shard,
    };
    
    await fs.writeFile(filePath, JSON.stringify(shardFile, null, 2));
    this.fileCache.set(fileHash, shard);
    
    this.emit('file:saved', shard.file);
  }

  /**
   * Get call graph data for multiple files
   */
  async getFileShards(fileHashes: string[]): Promise<CallGraphShard[]> {
    const results: CallGraphShard[] = [];
    
    const shards = await Promise.all(
      fileHashes.map(h => this.getFileShard(h))
    );
    
    for (const shard of shards) {
      if (shard) {
        results.push(shard);
      }
    }
    
    return results;
  }

  /**
   * List all file hashes with call graph data
   */
  async listFiles(): Promise<string[]> {
    if (!(await fileExists(this.filesDir))) {
      return [];
    }

    const files = await fs.readdir(this.filesDir);
    return files
      .filter(f => f.endsWith('.json'))
      .map(f => f.replace('.json', ''));
  }

  /**
   * Delete call graph data for a file
   */
  async deleteFileShard(fileHash: string): Promise<void> {
    const filePath = path.join(this.filesDir, `${fileHash}.json`);
    
    try {
      await fs.unlink(filePath);
      this.fileCache.delete(fileHash);
      this.emit('file:deleted', fileHash);
    } catch {
      // Ignore if doesn't exist
    }
  }

  // ==========================================================================
  // Entry Points Operations
  // ==========================================================================

  /**
   * Get entry points data
   */
  async getEntryPoints(): Promise<EntryPointsData | null> {
    if (this.entryPointsCache) {
      return this.entryPointsCache;
    }

    const filePath = path.join(this.callgraphDir, ENTRY_POINTS_FILE);
    if (!(await fileExists(filePath))) {
      return null;
    }

    try {
      const content = await fs.readFile(filePath, 'utf-8');
      this.entryPointsCache = JSON.parse(content);
      return this.entryPointsCache;
    } catch {
      return null;
    }
  }

  /**
   * Save entry points data
   */
  async saveEntryPoints(data: EntryPointsData): Promise<void> {
    await ensureDir(this.callgraphDir);
    
    const filePath = path.join(this.callgraphDir, ENTRY_POINTS_FILE);
    await fs.writeFile(filePath, JSON.stringify(data, null, 2));
    
    this.entryPointsCache = data;
    this.emit('entrypoints:saved');
  }

  /**
   * Build entry points from file shards
   */
  async buildEntryPoints(): Promise<EntryPointsData> {
    const fileHashes = await this.listFiles();
    const entryPoints: EntryPointDetail[] = [];

    for (const fileHash of fileHashes) {
      const shard = await this.getFileShard(fileHash);
      if (!shard) {continue;}

      for (const fn of shard.functions.filter(f => f.isEntryPoint)) {
        const tables = [...new Set(fn.dataAccess.map(da => da.table))];
        const sensitiveFields: string[] = []; // Would need security data
        
        // Extract call targets - handle both old format (string[]) and new format (CallEntry[])
        const reachableFunctions = fn.calls.map(call => 
          typeof call === 'string' ? call : (call.resolvedId ?? call.target)
        );

        entryPoints.push({
          id: fn.id,
          name: fn.name,
          file: shard.file,
          line: fn.startLine,
          endLine: fn.endLine,
          type: this.inferEntryPointType(fn.name, shard.file),
          reachableFunctions,
          reachableTables: tables,
          reachableSensitiveFields: sensitiveFields,
        });
      }
    }

    const data: EntryPointsData = {
      version: STORE_VERSION,
      generatedAt: new Date().toISOString(),
      entryPoints,
    };

    await this.saveEntryPoints(data);
    return data;
  }

  // ==========================================================================
  // Query Helpers
  // ==========================================================================

  /**
   * Get function by ID
   */
  async getFunction(functionId: string): Promise<FunctionEntry | null> {
    const fileHashes = await this.listFiles();
    
    for (const fileHash of fileHashes) {
      const shard = await this.getFileShard(fileHash);
      if (!shard) {continue;}

      const fn = shard.functions.find(f => f.id === functionId);
      if (fn) {return fn;}
    }
    
    return null;
  }

  /**
   * Get all functions that access a specific table
   */
  async getFunctionsByTable(table: string): Promise<Array<FunctionEntry & { file: string }>> {
    const fileHashes = await this.listFiles();
    const results: Array<FunctionEntry & { file: string }> = [];

    for (const fileHash of fileHashes) {
      const shard = await this.getFileShard(fileHash);
      if (!shard) {continue;}

      for (const fn of shard.functions) {
        if (fn.dataAccess.some(da => da.table === table)) {
          results.push({ ...fn, file: shard.file });
        }
      }
    }

    return results;
  }

  /**
   * Get all data access for a specific table
   */
  async getDataAccessByTable(table: string): Promise<Array<DataAccessRef & { functionId: string; file: string }>> {
    const fileHashes = await this.listFiles();
    const results: Array<DataAccessRef & { functionId: string; file: string }> = [];

    for (const fileHash of fileHashes) {
      const shard = await this.getFileShard(fileHash);
      if (!shard) {continue;}

      for (const fn of shard.functions) {
        for (const da of fn.dataAccess) {
          if (da.table === table) {
            results.push({ ...da, functionId: fn.id, file: shard.file });
          }
        }
      }
    }

    return results;
  }

  // ==========================================================================
  // Cache Management
  // ==========================================================================

  /**
   * Invalidate caches
   */
  invalidateCache(fileHash?: string): void {
    if (fileHash) {
      this.fileCache.delete(fileHash);
    } else {
      this.indexCache = null;
      this.entryPointsCache = null;
      this.fileCache.clear();
    }
  }

  /**
   * Get cache stats
   */
  getCacheStats(): { cachedFiles: number; hasIndex: boolean; hasEntryPoints: boolean } {
    return {
      cachedFiles: this.fileCache.size,
      hasIndex: this.indexCache !== null,
      hasEntryPoints: this.entryPointsCache !== null,
    };
  }

  // ==========================================================================
  // Private Helpers
  // ==========================================================================

  private inferEntryPointType(name: string, file: string): 'api' | 'handler' | 'controller' | 'route' | 'other' {
    const nameLower = name.toLowerCase();
    const fileLower = file.toLowerCase();

    if (fileLower.includes('controller')) {return 'controller';}
    if (fileLower.includes('route')) {return 'route';}
    if (fileLower.includes('handler')) {return 'handler';}
    if (fileLower.includes('api')) {return 'api';}
    
    if (nameLower.includes('handler')) {return 'handler';}
    if (nameLower.includes('controller')) {return 'controller';}
    if (nameLower.startsWith('get') || nameLower.startsWith('post') || 
        nameLower.startsWith('put') || nameLower.startsWith('delete')) {
      return 'api';
    }

    return 'other';
  }
}

// ============================================================================
// Factory Function
// ============================================================================

export function createCallGraphShardStore(config: Partial<DataLakeConfig> = {}): CallGraphShardStore {
  return new CallGraphShardStore(config);
}
