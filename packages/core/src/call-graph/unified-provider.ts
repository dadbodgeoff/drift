/**
 * Unified Call Graph Provider
 * 
 * Provides a unified interface for call graph queries regardless of storage format.
 * Supports:
 * - SQLite storage (recommended for large codebases) - uses native Rust queries
 * - Sharded JSON storage
 * - Legacy single-file JSON (graph.json)
 * 
 * Implements lazy loading for memory efficiency on large codebases.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';




import { CallGraphShardStore, type CallGraphIndex } from '../lake/callgraph-shard-store.js';
import { CallGraphStore } from './store/call-graph-store.js';
import {
  isNativeAvailable,
  isCallGraphAvailable,
  analyzeReachabilitySqlite,
  analyzeInverseReachabilitySqlite,
} from '../native/index.js';

import type {
  CallGraph,
  FunctionNode,
  CallGraphStats,
  ReachabilityResult,
  ReachabilityOptions,
  InverseReachabilityResult,
  InverseReachabilityOptions,
  ReachableDataAccess,
  CallPathNode,
  InverseAccessPath,
  CallGraphLanguage,
} from './types.js';
import type { DataAccessPoint } from '../boundaries/types.js';
import type {
  CallGraphShard,
  FunctionEntry,
  DataAccessRef,
} from '../lake/types.js';

// Types
export interface UnifiedCallGraphProviderConfig {
  rootDir: string;
  maxCachedShards?: number;
}

export type CallGraphStorageFormat = 'sqlite' | 'legacy' | 'sharded' | 'none';

export interface ProviderStats {
  format: CallGraphStorageFormat;
  totalFunctions: number;
  totalFiles: number;
  entryPoints: number;
  dataAccessors: number;
  shardsLoaded: number;
  cacheHits: number;
  cacheMisses: number;
}


export interface UnifiedFunction {
  id: string;
  name: string;
  file: string;
  startLine: number;
  endLine: number;
  isEntryPoint: boolean;
  isDataAccessor: boolean;
  calleeIds: string[];
  callerIds: string[];
  dataAccess: DataAccessRef[];
}

// Constants
const DRIFT_DIR = '.drift';
const LEGACY_GRAPH_FILE = 'call-graph/graph.json';
const SHARDED_INDEX_FILE = 'lake/callgraph/index.json';
const DEFAULT_MAX_CACHED_SHARDS = 100;

// LRU Cache
class LRUCache<K, V> {
  private cache = new Map<K, V>();
  private readonly maxSize: number;

  constructor(maxSize: number) {
    this.maxSize = maxSize;
  }

  get(key: K): V | undefined {
    const value = this.cache.get(key);
    if (value !== undefined) {
      this.cache.delete(key);
      this.cache.set(key, value);
    }
    return value;
  }

  set(key: K, value: V): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }
    this.cache.set(key, value);
  }

  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }
}


// Unified Provider
export class UnifiedCallGraphProvider {
  private readonly config: UnifiedCallGraphProviderConfig;
  private readonly shardStore: CallGraphShardStore;
  private readonly legacyStore: CallGraphStore;
  
  private format: CallGraphStorageFormat = 'none';
  private index: CallGraphIndex | null = null;
  private legacyGraph: CallGraph | null = null;
  private shardCache: LRUCache<string, CallGraphShard>;
  private cacheHits = 0;
  private cacheMisses = 0;

  constructor(config: UnifiedCallGraphProviderConfig) {
    this.config = config;
    this.shardStore = new CallGraphShardStore({ rootDir: config.rootDir });
    this.legacyStore = new CallGraphStore({ rootDir: config.rootDir });
    this.shardCache = new LRUCache(config.maxCachedShards ?? DEFAULT_MAX_CACHED_SHARDS);
  }

  async initialize(): Promise<void> {
    this.format = await this.detectFormat();
    
    if (this.format === 'sqlite') {
      // SQLite format uses native queries - no initialization needed
      // The native module handles database access
    } else if (this.format === 'sharded') {
      await this.shardStore.initialize();
      this.index = await this.shardStore.getIndex();
    } else if (this.format === 'legacy') {
      await this.legacyStore.initialize();
      this.legacyGraph = this.legacyStore.getGraph();
    }
  }

  private async detectFormat(): Promise<CallGraphStorageFormat> {
    // Check SQLite first (preferred for large codebases)
    if (isNativeAvailable() && isCallGraphAvailable(this.config.rootDir)) {
      return 'sqlite';
    }
    
    const shardedPath = path.join(this.config.rootDir, DRIFT_DIR, SHARDED_INDEX_FILE);
    const legacyPath = path.join(this.config.rootDir, DRIFT_DIR, LEGACY_GRAPH_FILE);
    
    try {
      await fs.access(shardedPath);
      return 'sharded';
    } catch {
      // Not sharded
    }
    
    try {
      await fs.access(legacyPath);
      return 'legacy';
    } catch {
      // No call graph
    }
    
    return 'none';
  }

  getFormat(): CallGraphStorageFormat {
    return this.format;
  }

  isAvailable(): boolean {
    return this.format !== 'none';
  }

  async getFunction(id: string): Promise<UnifiedFunction | null> {
    if (this.format === 'legacy' && this.legacyGraph) {
      const node = this.legacyGraph.functions.get(id);
      if (!node) {return null;}
      return this.nodeToUnified(node);
    }
    
    if (this.format === 'sharded') {
      const file = this.parseFileFromId(id);
      if (!file) {return null;}
      
      const shard = await this.loadShard(file);
      if (!shard) {return null;}
      
      const entry = shard.functions.find(f => f.id === id);
      return entry ? this.entryToUnified(entry, shard.file) : null;
    }
    
    return null;
  }

  async getFunctionsInFile(file: string): Promise<UnifiedFunction[]> {
    if (this.format === 'legacy' && this.legacyGraph) {
      const functions: UnifiedFunction[] = [];
      for (const [, func] of this.legacyGraph.functions) {
        if (func.file === file) {
          functions.push(this.nodeToUnified(func));
        }
      }
      return functions;
    }
    
    if (this.format === 'sharded') {
      const shard = await this.loadShard(file);
      if (!shard) {return [];}
      return shard.functions.map(f => this.entryToUnified(f, shard.file));
    }
    
    return [];
  }

  async getFunctionAtLine(file: string, line: number): Promise<UnifiedFunction | null> {
    const functions = await this.getFunctionsInFile(file);
    
    let best: UnifiedFunction | null = null;
    let bestSize = Infinity;
    
    for (const func of functions) {
      if (line >= func.startLine && line <= func.endLine) {
        const size = func.endLine - func.startLine;
        if (size < bestSize) {
          best = func;
          bestSize = size;
        }
      }
    }
    
    return best;
  }

  async getEntryPoints(): Promise<string[]> {
    if (this.format === 'legacy' && this.legacyGraph) {
      return this.legacyGraph.entryPoints;
    }
    
    if (this.format === 'sharded' && this.index) {
      return this.index.topEntryPoints.map((ep: { id: string }) => ep.id);
    }
    
    return [];
  }

  async getDataAccessors(): Promise<string[]> {
    if (this.format === 'legacy' && this.legacyGraph) {
      return this.legacyGraph.dataAccessors;
    }
    
    if (this.format === 'sharded' && this.index) {
      return this.index.topDataAccessors.map((da: { id: string }) => da.id);
    }
    
    return [];
  }


  async getStats(): Promise<CallGraphStats | null> {
    if (this.format === 'legacy' && this.legacyGraph) {
      return this.legacyGraph.stats;
    }
    
    if (this.format === 'sharded' && this.index) {
      const byLanguage: Record<CallGraphLanguage, number> = {
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
      };
      
      return {
        totalFunctions: this.index.summary.totalFunctions,
        totalCallSites: this.index.summary.totalCalls,
        resolvedCallSites: this.index.summary.resolvedCalls ?? 0,
        unresolvedCallSites: this.index.summary.unresolvedCalls ?? 0,
        totalDataAccessors: this.index.summary.dataAccessors,
        byLanguage,
      };
    }
    
    return null;
  }

  getProviderStats(): ProviderStats {
    return {
      format: this.format,
      totalFunctions: this.index?.summary.totalFunctions ?? this.legacyGraph?.stats.totalFunctions ?? 0,
      totalFiles: this.index?.summary.totalFiles ?? 0,
      entryPoints: this.index?.summary.entryPoints ?? this.legacyGraph?.entryPoints.length ?? 0,
      dataAccessors: this.index?.summary.dataAccessors ?? this.legacyGraph?.dataAccessors.length ?? 0,
      shardsLoaded: this.shardCache.size,
      cacheHits: this.cacheHits,
      cacheMisses: this.cacheMisses,
    };
  }

  async getReachableData(
    file: string,
    line: number,
    options?: ReachabilityOptions
  ): Promise<ReachabilityResult> {
    const maxDepth = options?.maxDepth ?? 10;
    const sensitiveOnly = options?.sensitiveOnly ?? false;
    
    // Use SQLite-backed native queries when available (O(1) memory)
    if (this.format === 'sqlite') {
      try {
        // Find the function at this location first
        const startFunc = await this.getFunctionAtLine(file, line);
        if (!startFunc) {
          return this.emptyReachabilityResult(file, line);
        }
        
        const nativeOptions: ReachabilityOptions = { maxDepth, sensitiveOnly };
        if (options?.tables) {
          nativeOptions.tables = options.tables;
        }
        
        const nativeResult = await analyzeReachabilitySqlite(
          this.config.rootDir,
          startFunc.id,
          nativeOptions
        );
        
        // Convert native result to our format
        const result: ReachabilityResult = {
          origin: {
            file: nativeResult.origin.file,
            line: nativeResult.origin.line,
          },
          reachableAccess: nativeResult.reachableAccess.map(ra => ({
            access: {
              id: `${ra.file}:${ra.line}`,
              file: ra.file,
              line: ra.line,
              column: 0,
              table: ra.table,
              operation: ra.operation,
              fields: ra.fields,
              context: '',
              confidence: ra.confidence,
              isRawSql: false,
            },
            path: ra.path,
            depth: ra.depth,
          })),
          tables: nativeResult.tables,
          sensitiveFields: nativeResult.sensitiveFields.map(sf => ({
            field: {
              field: sf.field,
              table: sf.table ?? null,
              sensitivityType: sf.sensitivityType,
              file: sf.file,
              line: sf.line,
              confidence: sf.confidence,
            },
            paths: sf.paths,
            accessCount: sf.accessCount,
          })),
          maxDepth: nativeResult.maxDepth,
          functionsTraversed: nativeResult.functionsTraversed,
        };
        
        if (nativeResult.origin.functionId) {
          result.origin.functionId = nativeResult.origin.functionId;
        }
        
        return result;
      } catch (err) {
        // Fall through to TypeScript implementation on error
        console.warn('[UnifiedCallGraphProvider] SQLite query failed, falling back to TypeScript:', err);
      }
    }
    
    const startFunc = await this.getFunctionAtLine(file, line);
    if (!startFunc) {
      return this.emptyReachabilityResult(file, line);
    }
    
    const visited = new Set<string>();
    const queue: Array<{ id: string; depth: number; path: CallPathNode[] }> = [
      { id: startFunc.id, depth: 0, path: [this.toPathNode(startFunc)] }
    ];
    
    const reachableAccess: ReachableDataAccess[] = [];
    const tablesSet = new Set<string>();
    const sensitiveFieldsMap = new Map<string, { paths: CallPathNode[][]; count: number }>();
    let maxDepthReached = 0;
    
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current.id) || current.depth > maxDepth) {continue;}
      visited.add(current.id);
      maxDepthReached = Math.max(maxDepthReached, current.depth);
      
      const func = await this.getFunction(current.id);
      if (!func) {continue;}
      
      for (const access of func.dataAccess) {
        tablesSet.add(access.table);
        
        const accessPoint: DataAccessPoint = {
          id: `${func.id}:${access.line}`,
          file: func.file,
          line: access.line,
          column: 0,
          table: access.table,
          operation: access.operation,
          fields: access.fields,
          context: func.name,
          confidence: 1.0,
          isRawSql: false,
        };
        
        reachableAccess.push({
          access: accessPoint,
          path: current.path,
          depth: current.depth,
        });
        
        if (access.fields) {
          for (const field of access.fields) {
            if (this.isSensitiveField(field)) {
              const key = `${access.table}.${field}`;
              const existing = sensitiveFieldsMap.get(key);
              if (existing) {
                existing.paths.push(current.path);
                existing.count++;
              } else {
                sensitiveFieldsMap.set(key, { paths: [current.path], count: 1 });
              }
            }
          }
        }
      }
      
      for (const calleeId of func.calleeIds) {
        if (!visited.has(calleeId)) {
          const callee = await this.getFunction(calleeId);
          const newPath = callee 
            ? [...current.path, this.toPathNode(callee)]
            : current.path;
          queue.push({ id: calleeId, depth: current.depth + 1, path: newPath });
        }
      }
    }
    
    const filteredAccess = sensitiveOnly
      ? reachableAccess.filter(ra => this.isSensitiveTable(ra.access.table))
      : reachableAccess;
    
    const sensitiveFields = Array.from(sensitiveFieldsMap.entries()).map(([key, data]) => {
      const [table, fieldName] = key.split('.');
      return {
        field: {
          field: fieldName ?? '',
          table: table ?? null,
          sensitivityType: 'pii' as const,
          file,
          line,
          confidence: 0.8,
        },
        paths: data.paths,
        accessCount: data.count,
      };
    });
    
    return {
      origin: { file, line, functionId: startFunc.id },
      reachableAccess: filteredAccess,
      tables: [...tablesSet],
      sensitiveFields,
      maxDepth: maxDepthReached,
      functionsTraversed: visited.size,
    };
  }


  async getCodePathsToData(
    options: InverseReachabilityOptions
  ): Promise<InverseReachabilityResult> {
    const { table, field, maxDepth = 10 } = options;
    
    // Use SQLite-backed native queries when available (O(1) memory)
    if (this.format === 'sqlite') {
      try {
        const nativeResult = await analyzeInverseReachabilitySqlite(
          this.config.rootDir,
          table,
          field,
          maxDepth
        );
        
        // Convert native result to our format
        return {
          target: {
            table: nativeResult.targetTable,
            field: nativeResult.targetField,
          },
          accessPaths: nativeResult.accessPaths.map(ap => ({
            entryPoint: ap.entryPoint,
            path: ap.path,
            accessPoint: {
              id: `${ap.accessFile}:${ap.accessLine}`,
              file: ap.accessFile,
              line: ap.accessLine,
              column: 0,
              table: ap.accessTable,
              operation: ap.accessOperation,
              fields: ap.accessFields,
              context: '',
              confidence: 1.0,
              isRawSql: false,
            },
          })),
          entryPoints: nativeResult.entryPoints,
          totalAccessors: nativeResult.totalAccessors,
        };
      } catch (err) {
        // Fall through to TypeScript implementation on error
        console.warn('[UnifiedCallGraphProvider] SQLite inverse query failed, falling back to TypeScript:', err);
      }
    }
    
    const accessorIds = await this.findDataAccessors(table, field);
    const accessPaths: InverseAccessPath[] = [];
    const entryPointSet = new Set<string>();
    
    const entryPoints = await this.getEntryPoints();
    const entryPointIdSet = new Set(entryPoints);
    
    for (const accessorId of accessorIds) {
      const accessor = await this.getFunction(accessorId);
      if (!accessor) {continue;}
      
      const visited = new Set<string>();
      const queue: Array<{ id: string; path: CallPathNode[]; depth: number }> = [
        { id: accessorId, path: [this.toPathNode(accessor)], depth: 0 }
      ];
      
      while (queue.length > 0) {
        const current = queue.shift()!;
        if (visited.has(current.id) || current.depth > maxDepth) {continue;}
        visited.add(current.id);
        
        if (entryPointIdSet.has(current.id)) {
          entryPointSet.add(current.id);
          
          const dataAccess = accessor.dataAccess.find(da => da.table === table);
          if (dataAccess) {
            accessPaths.push({
              entryPoint: current.id,
              path: current.path.reverse(),
              accessPoint: {
                id: `${accessor.id}:${dataAccess.line}`,
                file: accessor.file,
                line: dataAccess.line,
                column: 0,
                table: dataAccess.table,
                operation: dataAccess.operation,
                fields: dataAccess.fields,
                context: accessor.name,
                confidence: 1.0,
                isRawSql: false,
              },
            });
          }
          continue;
        }
        
        const func = await this.getFunction(current.id);
        if (!func) {continue;}
        
        for (const callerId of func.callerIds) {
          if (!visited.has(callerId)) {
            const caller = await this.getFunction(callerId);
            const newPath = caller
              ? [this.toPathNode(caller), ...current.path]
              : current.path;
            queue.push({
              id: callerId,
              path: newPath,
              depth: current.depth + 1,
            });
          }
        }
      }
    }
    
    return {
      target: { table, field },
      accessPaths,
      entryPoints: [...entryPointSet],
      totalAccessors: accessorIds.length,
    };
  }

  // Private helpers
  private async loadShard(file: string): Promise<CallGraphShard | null> {
    const cached = this.shardCache.get(file);
    if (cached) {
      this.cacheHits++;
      return cached;
    }
    
    this.cacheMisses++;
    
    const shard = await this.shardStore.getFileShardByPath(file);
    if (shard) {
      this.shardCache.set(file, shard);
    }
    
    return shard;
  }

  private parseFileFromId(id: string): string | null {
    const parts = id.split(':');
    if (parts.length >= 3) {
      return parts.slice(0, -2).join(':') || null;
    }
    return null;
  }

  private entryToUnified(entry: FunctionEntry, file: string): UnifiedFunction {
    // Handle both old format (string[]) and new format (CallEntry[])
    const calleeIds = entry.calls.map(call => {
      if (typeof call === 'string') {
        return call;
      }
      // New format: use resolvedId if available, otherwise target
      return call.resolvedId ?? call.target;
    });
    
    return {
      id: entry.id,
      name: entry.name,
      file,
      startLine: entry.startLine,
      endLine: entry.endLine,
      isEntryPoint: entry.isEntryPoint,
      isDataAccessor: entry.isDataAccessor,
      calleeIds,
      callerIds: entry.calledBy,
      dataAccess: entry.dataAccess,
    };
  }

  private nodeToUnified(node: FunctionNode): UnifiedFunction {
    return {
      id: node.id,
      name: node.name,
      file: node.file,
      startLine: node.startLine,
      endLine: node.endLine,
      isEntryPoint: node.isExported,
      isDataAccessor: node.dataAccess.length > 0,
      calleeIds: node.calls.map(c => c.calleeId).filter((id): id is string => id !== null),
      callerIds: node.calledBy.map(c => c.callerId),
      dataAccess: node.dataAccess.map(da => {
        let operation: 'read' | 'write' | 'delete' = 'read';
        if (da.operation === 'write') {
          operation = 'write';
        } else if (da.operation === 'delete') {
          operation = 'delete';
        }
        return {
          table: da.table,
          operation,
          fields: da.fields ?? [],
          line: da.line,
        };
      }),
    };
  }

  private toPathNode(func: UnifiedFunction): CallPathNode {
    return {
      functionId: func.id,
      functionName: func.name,
      file: func.file,
      line: func.startLine,
    };
  }

  private async findDataAccessors(table: string, field?: string): Promise<string[]> {
    const accessors: string[] = [];
    
    if (this.format === 'legacy' && this.legacyGraph) {
      for (const [id, func] of this.legacyGraph.functions) {
        for (const access of func.dataAccess) {
          if (access.table === table) {
            if (!field || access.fields?.includes(field)) {
              accessors.push(id);
              break;
            }
          }
        }
      }
    } else if (this.format === 'sharded' && this.index) {
      for (const da of this.index.topDataAccessors) {
        if (da.tables.includes(table)) {
          accessors.push(da.id);
        }
      }
    }
    
    return accessors;
  }

  private isSensitiveField(field: string): boolean {
    const sensitivePatterns = [
      'password', 'secret', 'token', 'key', 'ssn', 'credit_card',
      'api_key', 'auth', 'credential', 'private', 'salt', 'hash',
    ];
    const lower = field.toLowerCase();
    return sensitivePatterns.some(p => lower.includes(p));
  }

  private isSensitiveTable(table: string): boolean {
    const sensitivePatterns = [
      'user', 'account', 'credential', 'auth', 'session', 'token',
      'payment', 'billing', 'secret', 'key', 'password',
    ];
    const lower = table.toLowerCase();
    return sensitivePatterns.some(p => lower.includes(p));
  }

  private emptyReachabilityResult(file: string, line: number): ReachabilityResult {
    return {
      origin: { file, line },
      reachableAccess: [],
      tables: [],
      sensitiveFields: [],
      maxDepth: 0,
      functionsTraversed: 0,
    };
  }
}

// Factory function
export function createUnifiedCallGraphProvider(
  config: UnifiedCallGraphProviderConfig
): UnifiedCallGraphProvider {
  return new UnifiedCallGraphProvider(config);
}
