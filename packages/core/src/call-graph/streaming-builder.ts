/**
 * Streaming Call Graph Builder
 * 
 * Memory-optimized call graph builder that writes shards incrementally
 * instead of accumulating the entire graph in memory.
 * 
 * This solves the "Invalid string length" error on large codebases by:
 * 1. Processing one file at a time
 * 2. Writing each file's functions to a separate shard
 * 3. Running a resolution pass in batches after all shards are written
 * 4. Building the index at the end from shard metadata
 * 
 * OOM Prevention (v0.9.29+):
 * The resolution pass now uses a disk-backed function index instead of
 * keeping all function mappings in memory. This allows processing codebases
 * of any size without hitting heap limits.
 */

import { createReadStream, createWriteStream } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as readline from 'node:readline';

import { minimatch } from 'minimatch';

import { createTableNameValidator, type TableNameValidator } from '../boundaries/table-name-validator.js';
import { CallGraphShardStore } from '../lake/callgraph-shard-store.js';
import { shouldIgnoreDirectory, shouldIgnoreExtension } from '../scanner/default-ignores.js';
import { BaseCallGraphExtractor } from './extractors/base-extractor.js';
import { CSharpCallGraphExtractor } from './extractors/csharp-extractor.js';
import { GoCallGraphExtractor } from './extractors/go-extractor.js';
import { JavaCallGraphExtractor } from './extractors/java-extractor.js';
import { PhpCallGraphExtractor } from './extractors/php-extractor.js';
import { PythonCallGraphExtractor } from './extractors/python-extractor.js';
import { TypeScriptCallGraphExtractor } from './extractors/typescript-extractor.js';

import type { DataAccessPoint } from '../boundaries/types.js';
import type { CallGraphShard, FunctionEntry, DataAccessRef, CallEntry } from '../lake/types.js';

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
  /** Batch size for resolution pass (default: 50) */
  resolutionBatchSize?: number;
}

export interface StreamingBuildResult {
  /** Total files processed */
  filesProcessed: number;
  /** Total functions extracted */
  totalFunctions: number;
  /** Total call sites found */
  totalCalls: number;
  /** Resolved call sites */
  resolvedCalls: number;
  /** Resolution rate (0-1) */
  resolutionRate: number;
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

// Resolution index file format (NDJSON - one JSON object per line)
// Each line: { "name": "functionName", "id": "file:name:line", "file": "path/to/file.ts" }
const RESOLUTION_INDEX_FILE = 'resolution-index.ndjson';

export class StreamingCallGraphBuilder {
  private readonly config: StreamingBuilderConfig;
  private readonly shardStore: CallGraphShardStore;
  private readonly extractors: BaseCallGraphExtractor[];
  private readonly resolutionBatchSize: number;
  private readonly tableNameValidator: TableNameValidator;
  private readonly resolutionIndexPath: string;

  constructor(config: StreamingBuilderConfig) {
    this.config = config;
    this.shardStore = new CallGraphShardStore({ rootDir: config.rootDir });
    this.resolutionBatchSize = config.resolutionBatchSize ?? 50;
    this.tableNameValidator = createTableNameValidator();
    
    // Path for temporary resolution index (disk-backed to prevent OOM)
    this.resolutionIndexPath = path.join(
      config.rootDir,
      '.drift',
      'lake',
      'callgraph',
      RESOLUTION_INDEX_FILE
    );
    
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
    
    // Phase 1: Extract and save shards with raw calls
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
    
    // Phase 2: Resolution pass - resolve calls across all shards
    const resolvedCalls = await this.runResolutionPass();
    
    // Build index from shards (reads shard metadata, not full content)
    await this.shardStore.buildIndex();
    
    const resolutionRate = totalCalls > 0 ? Math.round((resolvedCalls / totalCalls) * 100) / 100 : 0;
    
    return {
      filesProcessed: files.length,
      totalFunctions,
      totalCalls,
      resolvedCalls,
      resolutionRate,
      entryPoints,
      dataAccessors,
      errors,
      durationMs: Date.now() - startTime,
    };
  }

  /**
   * Run resolution pass across all shards
   * 
   * Uses a disk-backed function index to prevent OOM on large codebases.
   * The index is written as NDJSON (newline-delimited JSON) for streaming reads.
   * 
   * Phase 1: Build index - stream function metadata to disk
   * Phase 2: Resolve calls - load index in memory-efficient chunks
   */
  private async runResolutionPass(): Promise<number> {
    const fileHashes = await this.shardStore.listFiles();
    
    // Phase 1: Build disk-backed function index
    await this.buildResolutionIndex(fileHashes);
    
    // Phase 2: Load index into memory for resolution
    // For most codebases, the index fits in memory even when full shards don't
    // The index only stores: name, id, file (not full function bodies)
    const { functionIndex, functionFiles } = await this.loadResolutionIndex();
    
    // Phase 3: Resolve calls in batches
    let totalResolved = 0;
    
    for (let i = 0; i < fileHashes.length; i += this.resolutionBatchSize) {
      const batch = fileHashes.slice(i, i + this.resolutionBatchSize);
      
      for (const fileHash of batch) {
        const shard = await this.shardStore.getFileShard(fileHash);
        if (!shard) {continue;}
        
        let shardModified = false;
        
        for (const fn of shard.functions) {
          const resolvedCalls: CallEntry[] = [];
          
          for (const call of fn.calls) {
            // Handle both old format (string) and new format (CallEntry)
            const target = typeof call === 'string' ? call : call.target;
            const line = typeof call === 'object' ? call.line : 0;
            
            const resolution = this.resolveCall(target, shard.file, functionIndex, functionFiles);
            
            const callEntry: CallEntry = {
              target,
              resolved: resolution.resolved,
              confidence: resolution.confidence,
              line,
            };
            
            // Only set resolvedId if we have one (exactOptionalPropertyTypes)
            if (resolution.resolvedId) {
              callEntry.resolvedId = resolution.resolvedId;
            }
            
            resolvedCalls.push(callEntry);
            
            if (resolution.resolved) {
              totalResolved++;
            }
          }
          
          // Update function's calls with resolved info
          fn.calls = resolvedCalls;
          shardModified = true;
        }
        
        // Save updated shard
        if (shardModified) {
          await this.shardStore.saveFileShard(shard);
        }
      }
      
      // Clear shard cache between batches to keep memory bounded
      this.shardStore.invalidateCache();
    }
    
    // Cleanup: remove temporary index file
    await this.cleanupResolutionIndex();
    
    return totalResolved;
  }

  /**
   * Build the resolution index to disk (NDJSON format)
   * 
   * Streams function metadata to disk one shard at a time,
   * preventing memory accumulation for large codebases.
   */
  private async buildResolutionIndex(fileHashes: string[]): Promise<void> {
    // Ensure directory exists
    const indexDir = path.dirname(this.resolutionIndexPath);
    await fs.mkdir(indexDir, { recursive: true });
    
    // Create write stream for NDJSON output
    const writeStream = createWriteStream(this.resolutionIndexPath, { encoding: 'utf-8' });
    
    try {
      for (const fileHash of fileHashes) {
        const shard = await this.shardStore.getFileShard(fileHash);
        if (!shard) {continue;}
        
        // Write each function as a single JSON line
        for (const fn of shard.functions) {
          const indexEntry = {
            name: fn.name,
            id: fn.id,
            file: shard.file,
          };
          writeStream.write(JSON.stringify(indexEntry) + '\n');
        }
        
        // Clear shard from cache after processing to free memory
        this.shardStore.invalidateCache(fileHash);
      }
    } finally {
      // Close the write stream
      await new Promise<void>((resolve, reject) => {
        writeStream.end((err: Error | null | undefined) => {
          if (err) {reject(err);}
          else {resolve();}
        });
      });
    }
  }

  /**
   * Load the resolution index from disk into memory
   * 
   * The index is much smaller than full shards since it only contains
   * function name, id, and file path (not code, calls, data access, etc.)
   * 
   * For a codebase with 50K functions:
   * - Full shards: ~500MB+ (causes OOM)
   * - Index only: ~5-10MB (fits easily)
   */
  private async loadResolutionIndex(): Promise<{
    functionIndex: Map<string, string[]>;
    functionFiles: Map<string, string>;
  }> {
    const functionIndex = new Map<string, string[]>();
    const functionFiles = new Map<string, string>();
    
    // Check if index file exists
    try {
      await fs.access(this.resolutionIndexPath);
    } catch {
      // No index file - return empty maps
      return { functionIndex, functionFiles };
    }
    
    // Stream read the NDJSON file line by line
    const fileStream = createReadStream(this.resolutionIndexPath, { encoding: 'utf-8' });
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity,
    });
    
    for await (const line of rl) {
      if (!line.trim()) {continue;}
      
      try {
        const entry = JSON.parse(line) as { name: string; id: string; file: string };
        
        // Build name -> [ids] index
        const existing = functionIndex.get(entry.name) ?? [];
        existing.push(entry.id);
        functionIndex.set(entry.name, existing);
        
        // Build id -> file index
        functionFiles.set(entry.id, entry.file);
      } catch {
        // Skip malformed lines
      }
    }
    
    return { functionIndex, functionFiles };
  }

  /**
   * Clean up the temporary resolution index file
   */
  private async cleanupResolutionIndex(): Promise<void> {
    try {
      await fs.unlink(this.resolutionIndexPath);
    } catch {
      // Ignore if file doesn't exist
    }
  }

  /**
   * Resolve a call to its target function
   */
  private resolveCall(
    target: string,
    callerFile: string,
    functionIndex: Map<string, string[]>,
    functionFiles: Map<string, string>
  ): { resolved: boolean; resolvedId: string | null; confidence: number } {
    const candidates = functionIndex.get(target);
    
    if (!candidates || candidates.length === 0) {
      return { resolved: false, resolvedId: null, confidence: 0 };
    }
    
    // Strategy 1: Same file (highest confidence)
    const sameFileCandidates = candidates.filter(id => functionFiles.get(id) === callerFile);
    if (sameFileCandidates.length === 1 && sameFileCandidates[0]) {
      return { resolved: true, resolvedId: sameFileCandidates[0], confidence: 0.95 };
    }
    
    // Strategy 2: Single candidate globally
    if (candidates.length === 1 && candidates[0]) {
      return { resolved: true, resolvedId: candidates[0], confidence: 0.8 };
    }
    
    // Strategy 3: Multiple candidates - pick same file if available, else first
    if (sameFileCandidates.length > 0 && sameFileCandidates[0]) {
      return { resolved: true, resolvedId: sameFileCandidates[0], confidence: 0.7 };
    }
    
    // Strategy 4: Multiple candidates, different files - low confidence
    if (candidates[0]) {
      return { resolved: true, resolvedId: candidates[0], confidence: 0.4 };
    }
    
    return { resolved: false, resolvedId: null, confidence: 0 };
  }

  /**
   * Process a single file and return its shard
   */
  private async processFile(
    file: string,
    dataAccessPoints?: DataAccessPoint[]
  ): Promise<CallGraphShard | null> {
    const extractor = this.getExtractor(file);
    if (!extractor) {return null;}
    
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
            // Validate table name to filter out noise
            const validation = this.tableNameValidator.validate(dap.table);
            if (!validation.isValid) {
              // Skip noisy table names like 'unknown', 'item', 'data', etc.
              continue;
            }
            
            // Map operation to allowed values
            let operation: 'read' | 'write' | 'delete' = 'read';
            const op = dap.operation as string;
            if (op === 'write' || op === 'insert' || op === 'update') {
              operation = 'write';
            } else if (op === 'delete') {
              operation = 'delete';
            }
            
            fnDataAccess.push({
              table: validation.normalizedName ?? dap.table,
              operation,
              line: dap.line,
              fields: dap.fields ?? [],
            });
          }
        }
      }
      
      // Get calls for this function - store as CallEntry with unresolved state
      const fnCalls = callsByFunction.get(fnId) ?? [];
      const callEntries: CallEntry[] = fnCalls.map(c => ({
        target: c.calleeName,
        resolved: false,
        confidence: 0,
        line: c.line,
      }));
      
      functions.push({
        id: fnId,
        name: fn.name,
        startLine: fn.startLine,
        endLine: fn.endLine,
        isEntryPoint: fn.isExported, // Exported functions are potential entry points
        isDataAccessor: fnDataAccess.length > 0,
        calls: callEntries,
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
    const files: string[] = [];

    const walk = async (dir: string, relativePath: string = ''): Promise<void> => {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const relPath = relativePath ? `${relativePath}/${entry.name}` : entry.name;

        if (entry.isDirectory()) {
          // Use enterprise-grade ignore list
          if (!shouldIgnoreDirectory(entry.name)) {
            await walk(fullPath, relPath);
          }
        } else if (entry.isFile()) {
          // Skip ignored file extensions
          if (shouldIgnoreExtension(entry.name)) {
            continue;
          }
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
