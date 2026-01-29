/**
 * Call Graph Module
 *
 * Provides call graph construction and reachability analysis.
 * Answers: "What data can this line of code ultimately access?"
 *
 * @example
 * ```typescript
 * import { CallGraphAnalyzer } from './call-graph';
 *
 * const analyzer = new CallGraphAnalyzer({ rootDir: '/path/to/project' });
 * await analyzer.initialize();
 * await analyzer.scan(['src/**\/*.ts', 'src/**\/*.py']);
 *
 * // What data can line 45 of user_service.py reach?
 * const result = analyzer.getReachableData('src/services/user_service.py', 45);
 * console.log(result.tables);           // ['users', 'sessions']
 * console.log(result.sensitiveFields);  // [{ field: 'password_hash', ... }]
 *
 * // Who can access the users.ssn field?
 * const inverse = analyzer.getCodePathsToData({ table: 'users', field: 'ssn' });
 * console.log(inverse.entryPoints);     // ['api/routes/admin.py:get_user_details:12']
 * ```
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { minimatch } from 'minimatch';

import { shouldIgnoreDirectory, shouldIgnoreExtension } from '../scanner/default-ignores.js';
import { GraphBuilder } from './analysis/graph-builder.js';
import { ReachabilityEngine } from './analysis/reachability.js';
import { BaseCallGraphExtractor } from './extractors/base-extractor.js';
import { CSharpCallGraphExtractor } from './extractors/csharp-extractor.js';
import { GoCallGraphExtractor } from './extractors/go-extractor.js';
import { JavaCallGraphExtractor } from './extractors/java-extractor.js';
import { PhpCallGraphExtractor } from './extractors/php-extractor.js';
import { PythonCallGraphExtractor } from './extractors/python-extractor.js';
import { TypeScriptCallGraphExtractor } from './extractors/typescript-extractor.js';
import { CallGraphStore, createCallGraphStore } from './store/call-graph-store.js';

import type {
  CallGraph,
  ReachabilityResult,
  ReachabilityOptions,
  InverseReachabilityOptions,
  InverseReachabilityResult,
  CallPathNode,
  CodeLocation,
  FunctionNode,
} from './types.js';
import type { DataAccessPoint } from '../boundaries/types.js';

// Re-export types
export * from './types.js';
export { BaseCallGraphExtractor } from './extractors/base-extractor.js';
export { TypeScriptCallGraphExtractor } from './extractors/typescript-extractor.js';
export { PythonCallGraphExtractor } from './extractors/python-extractor.js';
export { CSharpCallGraphExtractor } from './extractors/csharp-extractor.js';
export { JavaCallGraphExtractor } from './extractors/java-extractor.js';
export { PhpCallGraphExtractor } from './extractors/php-extractor.js';
export { GoCallGraphExtractor, createGoExtractor } from './extractors/go-extractor.js';
export { GoHybridExtractor, createGoHybridExtractor } from './extractors/go-hybrid-extractor.js';
export { GoDataAccessExtractor, createGoDataAccessExtractor } from './extractors/go-data-access-extractor.js';

// Data Access Extractors base class
export { 
  BaseDataAccessExtractor,
  type DataAccessExtractionResult,
} from './extractors/data-access-extractor.js';

// Unified Provider (main extraction pipeline)
export {
  UnifiedScanner,
  createUnifiedScanner,
  detectProjectStack,
  type UnifiedScannerConfig,
  type UnifiedScanResult,
  type DetectedStack,
} from '../unified-provider/integration/index.js';

// Backward compatibility aliases (old API names)
export { 
  TypeScriptDataAccessExtractor,
  createTypeScriptDataAccessExtractor,
  PythonDataAccessExtractor,
  createPythonDataAccessExtractor,
  CSharpDataAccessExtractor,
  createCSharpDataAccessExtractor,
  JavaDataAccessExtractor,
  createJavaDataAccessExtractor,
  PhpDataAccessExtractor,
  createPhpDataAccessExtractor,
  createDataAccessExtractors,
  SemanticDataAccessScanner,
  createSemanticDataAccessScanner,
  type SemanticScannerConfig,
  type SemanticScanResult,
} from '../unified-provider/compat/index.js';

export { GraphBuilder } from './analysis/graph-builder.js';
export { ReachabilityEngine } from './analysis/reachability.js';
export { PathFinder, createPathFinder } from './analysis/path-finder.js';
export type { PathFinderOptions, CallPath, PathFinderResult, CriticalPathResult } from './analysis/path-finder.js';
export { CallGraphStore, createCallGraphStore } from './store/call-graph-store.js';
export { ImpactAnalyzer, createImpactAnalyzer } from './analysis/impact-analyzer.js';
export type {
  ImpactRisk,
  AffectedFunction,
  AffectedDataPath,
  ImpactAnalysisResult,
  ImpactAnalysisOptions,
} from './analysis/impact-analyzer.js';

export { DeadCodeDetector, createDeadCodeDetector } from './analysis/dead-code-detector.js';
export type {
  DeadCodeConfidence,
  FalsePositiveReason,
  DeadCodeCandidate,
  DeadCodeResult,
  DeadCodeOptions,
} from './analysis/dead-code-detector.js';

export { CoverageAnalyzer, createCoverageAnalyzer } from './analysis/coverage-analyzer.js';
export type {
  CoverageStatus,
  SensitiveAccessPath,
  FieldCoverage,
  CoverageAnalysisResult,
  CoverageAnalysisOptions,
  SensitivityPatternConfig,
} from './analysis/coverage-analyzer.js';

// Re-export enrichment module
export * from './enrichment/index.js';

// Streaming builder for large codebases
export {
  StreamingCallGraphBuilder,
  createStreamingCallGraphBuilder,
  type StreamingBuilderConfig,
  type StreamingBuildResult,
} from './streaming-builder.js';

// Unified Call Graph Provider (supports both legacy and sharded storage)
export {
  UnifiedCallGraphProvider,
  createUnifiedCallGraphProvider,
  type UnifiedCallGraphProviderConfig,
  type CallGraphStorageFormat,
  type ProviderStats,
  type UnifiedFunction,
} from './unified-provider.js';

// ============================================================================
// Main Analyzer
// ============================================================================

/**
 * Configuration for CallGraphAnalyzer
 */
export interface CallGraphAnalyzerConfig {
  /** Project root directory */
  rootDir: string;
  /** Whether to include unresolved calls in analysis */
  includeUnresolved?: boolean;
  /** Minimum confidence for call resolution */
  minConfidence?: number;
}

/**
 * Call Graph Analyzer
 *
 * Main entry point for call graph analysis.
 * Coordinates extraction, graph building, and reachability queries.
 */
export class CallGraphAnalyzer {
  private readonly config: CallGraphAnalyzerConfig;
  private readonly store: CallGraphStore;
  private readonly extractors: BaseCallGraphExtractor[];
  private reachabilityEngine: ReachabilityEngine | null = null;

  constructor(config: CallGraphAnalyzerConfig) {
    this.config = {
      includeUnresolved: true,
      minConfidence: 0.5,
      ...config,
    };

    this.store = createCallGraphStore({ rootDir: config.rootDir });

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
   * Initialize the analyzer
   */
  async initialize(): Promise<void> {
    await this.store.initialize();

    const graph = this.store.getGraph();
    if (graph) {
      this.reachabilityEngine = new ReachabilityEngine(graph);
    }
  }

  /**
   * Scan files and build the call graph
   */
  async scan(
    patterns: string[],
    dataAccessPoints?: Map<string, DataAccessPoint[]>
  ): Promise<CallGraph> {
    // Find all matching files
    const files = await this.findFiles(patterns);

    // Extract from each file
    const builder = new GraphBuilder({
      projectRoot: this.config.rootDir,
      includeUnresolved: this.config.includeUnresolved ?? true,
      minConfidence: this.config.minConfidence ?? 0.5,
    });

    for (const file of files) {
      const extractor = this.getExtractor(file);
      if (!extractor) {continue;}

      try {
        const filePath = path.join(this.config.rootDir, file);
        const source = await fs.readFile(filePath, 'utf-8');
        const extraction = extractor.extract(source, file);

        builder.addFile(extraction);

        // Add data access points if provided
        if (dataAccessPoints?.has(file)) {
          builder.addDataAccess(file, dataAccessPoints.get(file)!);
        }
      } catch (error) {
        // Log error but continue with other files
        console.error(`Error extracting ${file}:`, error);
      }
    }

    // Build the graph
    const graph = builder.build();

    // Save and initialize reachability engine
    await this.store.save(graph);
    this.reachabilityEngine = new ReachabilityEngine(graph);

    return graph;
  }

  /**
   * Get all data reachable from a specific code location
   */
  getReachableData(
    file: string,
    line: number,
    options?: ReachabilityOptions
  ): ReachabilityResult {
    if (!this.reachabilityEngine) {
      throw new Error('Call graph not initialized. Run scan() first.');
    }

    return this.reachabilityEngine.getReachableData(file, line, options);
  }

  /**
   * Get all data reachable from a function
   */
  getReachableDataFromFunction(
    functionId: string,
    options?: ReachabilityOptions
  ): ReachabilityResult {
    if (!this.reachabilityEngine) {
      throw new Error('Call graph not initialized. Run scan() first.');
    }

    return this.reachabilityEngine.getReachableDataFromFunction(functionId, options);
  }

  /**
   * Get call paths from a location to specific data
   */
  getCallPath(
    from: CodeLocation,
    toTable: string,
    toField?: string
  ): CallPathNode[][] {
    if (!this.reachabilityEngine) {
      throw new Error('Call graph not initialized. Run scan() first.');
    }

    return this.reachabilityEngine.getCallPath(from, toTable, toField);
  }

  /**
   * Inverse query: Find all code paths that can access specific data
   */
  getCodePathsToData(options: InverseReachabilityOptions): InverseReachabilityResult {
    if (!this.reachabilityEngine) {
      throw new Error('Call graph not initialized. Run scan() first.');
    }

    return this.reachabilityEngine.getCodePathsToData(options);
  }

  /**
   * Get the current call graph
   */
  getGraph(): CallGraph | null {
    return this.store.getGraph();
  }

  /**
   * Get a function by ID
   */
  getFunction(id: string): FunctionNode | undefined {
    return this.store.getFunction(id);
  }

  /**
   * Get function at a specific location
   */
  getFunctionAtLine(file: string, line: number): FunctionNode | null {
    return this.store.getFunctionAtLine(file, line);
  }

  /**
   * Get functions in a file
   */
  getFunctionsInFile(file: string): FunctionNode[] {
    return this.store.getFunctionsInFile(file);
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

/**
 * Create a new CallGraphAnalyzer instance
 */
export function createCallGraphAnalyzer(config: CallGraphAnalyzerConfig): CallGraphAnalyzer {
  return new CallGraphAnalyzer(config);
}
