/**
 * Streaming Call Graph Builder
 * 
 * Memory-optimized call graph builder that writes shards incrementally
 * instead of accumulating the entire graph in memory.
 * 
 * This solves the "Invalid string length" error on large codebases by:
 * 1. Processing one file at a time
 * 2. Writing each file's functions to a separate shard
 * 3. Building the index at the end from shard metadata
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { minimatch } from 'minimatch';

import type { DataAccessPoint } from '../boundaries/types.js';
import type { CallGraphShard, FunctionEntry, DataAccessRef } from '../lake/types.js';
import { CallGraphShardStore } from '../lake/callgraph-shard-store.js';
import { BaseCallGraphExtractor } from './extractors/base-extractor.js';
import { TypeScriptCallGraphExtractor } from './extractors/typescript-extractor.js';
import { PythonCallGraphExtractor } from './extractors/python-extractor.js';
import { CSharpCallGraphExtractor } from './extractors/csharp-extractor.js';
import { JavaCallGraphExtractor } from './extractors/java-extractor.js';
import { PhpCallGraphExtractor } from './extractors/php-extractor.js';
import { GoCallGraphExtractor } from './extractors/go-extractor.js';

// ============================================================================
// Types
// ============================================================================

export interface StreamingBuilderConfig {
  /** Project root directory */
  rootDir: string;
  /** Callback for progress updates */
  onProgress?: (current: number, total: number, file: string) => void;
  /** Callback for errors (non-fatal) */
  onError?: (file: string, error: Error) => void;
}

export interface StreamingBuildResult {
  /** Total files processed */
  filesProcessed: number;
  /** Total functions extracted */
  totalFunctions: number;
  /** Total call sites found */
  totalCalls: number;
  /** Entry points found */
  entryPoints: number;
  /** Data accessors found */
  dataAccessors: number;
  /** Files that had errors */
  errors: string[];
  /** Duration in milliseconds */
  durationMs: number;
}

// ============================================================================
// Streaming Builder
// ============================================================================

export class StreamingCallGraphBuilder {
  private readonly config: StreamingBuilderConfig;
  private readonly shardStore: CallGraphShardStore;
  private readonly extractors: BaseCallGraphExtractor[];

  constructor(config: StreamingBuilderConfig) {
    this.config = config;
    this.shardStore = new CallGraphShardStore({ rootDir: config.rootDir });
    
    // Register extractors
    this.extractors = [
      new TypeScriptCallGraphExtractor(),
      new PythonCallGraphExtractor(),
      new CSharpCallGraphExtractor(),
      new JavaCallGraphExtractor(),
      new PhpCallGraphExtractor(),
      new GoCallGraphExtractor(),
    ];
  }

  /**
   * Build call graph with streaming/sharded storage
   */
  async build(
    patterns: string[],
    dataAccessPoints?: Map<string, DataAccessPoint[]>
  ): Promise<StreamingBuildResult> {
    const startTime = Date.now();
    const errors: string[] = [];
    
    // Initialize shard store
    await this.shardStore.initialize();
    
    // Find all matching files
    const files = await this.findFiles(patterns);
    
    // Stats
    let totalFunctions = 0;
    let totalCalls = 0;
    let entryPoints = 0;
    let dataAccessors = 0;
    
    // Process each file and save shard immediately
    for (let i = 0; i < files.length; i++) {
      const file = files[i]!;
      
      // Progress callback
      this.config.onProgress?.(i + 1, files.length, file);
      
      try {
        const shard = await this.processFile(file, dataAccessPoints?.get(file));
        
        if (shard && shard.functions.length > 0) {
          // Save shard immediately (streaming)
          await this.shardStore.saveFileShard(shard);
          
          // Update stats
          totalFunctions += shard.functions.length;
          totalCalls += shard.functions.reduce((sum, f) => sum + f.calls.length, 0);
          entryPoints += shard.functions.filter(f => f.isEntryPoint).length;
          dataAccessors += shard.functions.filter(f => f.isDataAccessor).length;
        }
      } catch (error) {
        errors.push(file);
        this.config.onError?.(file, error instanceof Error ? error : new Error(String(error)));
      }
    }
    
    // Build index from shards (reads shard metadata, not full content)
    await this.shardStore.buildIndex();
    
    return {
      filesProcessed: files.length,
      totalFunctions,
      totalCalls,
      entryPoints,
      dataAccessors,
      errors,
      durationMs: Date.now() - startTime,
    };
  }

  /**
   * Process a single file and return its shard
   */
  private async processFile(
    file: string,
    dataAccessPoints?: DataAccessPoint[]
  ): Promise<CallGraphShard | null> {
    const extractor = this.getExtractor(file);
    if (!extractor) return null;
    
    const filePath = path.join(this.config.rootDir, file);
    const source = await fs.readFile(filePath, 'utf-8');
    const extraction = extractor.extract(source, file);
    
    // Convert extraction to shard format
    const functions: FunctionEntry[] = [];
    
    // Build a map of calls by line range for each function
    const callsByFunction = new Map<string, typeof extraction.calls>();
    
    for (const fn of extraction.functions) {
      const fnId = `${file}:${fn.name}:${fn.startLine}`;
      const fnCalls = extraction.calls.filter(
        c => c.line >= fn.startLine && c.line <= fn.endLine
      );
      callsByFunction.set(fnId, fnCalls);
    }
    
    for (const fn of extraction.functions) {
      const fnId = `${file}:${fn.name}:${fn.startLine}`;
      
      // Find data access for this function
      const fnDataAccess: DataAccessRef[] = [];
      
      if (dataAccessPoints) {
        for (const dap of dataAccessPoints) {
          if (dap.line >= fn.startLine && dap.line <= fn.endLine) {
            // Map operation to allowed values
            let operation: 'read' | 'write' | 'delete' = 'read';
            const op = dap.operation as string;
            if (op === 'write' || op === 'insert' || op === 'update') {
              operation = 'write';
            } else if (op === 'delete') {
              operation = 'delete';
            }
            
            fnDataAccess.push({
              table: dap.table,
              operation,
              line: dap.line,
              fields: dap.fields ?? [],
            });
          }
        }
      }
      
      // Get calls for this function - just store target IDs
      const fnCalls = callsByFunction.get(fnId) ?? [];
      const callTargets = fnCalls.map(c => c.calleeName);
      
      functions.push({
        id: fnId,
        name: fn.name,
        startLine: fn.startLine,
        endLine: fn.endLine,
        isEntryPoint: fn.isExported, // Exported functions are potential entry points
        isDataAccessor: fnDataAccess.length > 0,
        calls: callTargets,
        calledBy: [], // Will be populated during index building
        dataAccess: fnDataAccess,
      });
    }
    
    return {
      file,
      functions,
    };
  }

  /**
   * Get the appropriate extractor for a file
   */
  private getExtractor(file: string): BaseCallGraphExtractor | null {
    for (const extractor of this.extractors) {
      if (extractor.canHandle(file)) {
        return extractor;
      }
    }
    return null;
  }

  /**
   * Find files matching patterns
   */
  private async findFiles(patterns: string[]): Promise<string[]> {
    const ignorePatterns = ['node_modules', '.git', 'dist', 'build', '__pycache__', 'vendor', '.drift'];
    const files: string[] = [];

    const walk = async (dir: string, relativePath: string = ''): Promise<void> => {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const relPath = relativePath ? `${relativePath}/${entry.name}` : entry.name;

        if (entry.isDirectory()) {
          if (!ignorePatterns.includes(entry.name) && !entry.name.startsWith('.')) {
            await walk(fullPath, relPath);
          }
        } else if (entry.isFile()) {
          // Check if file matches any pattern
          for (const pattern of patterns) {
            if (minimatch(relPath, pattern)) {
              files.push(relPath);
              break;
            }
          }
        }
      }
    };

    await walk(this.config.rootDir);
    return files;
  }
}

// ============================================================================
// Factory Function
// ============================================================================

export function createStreamingCallGraphBuilder(
  config: StreamingBuilderConfig
): StreamingCallGraphBuilder {
  return new StreamingCallGraphBuilder(config);
}
