/**
 * Wrapper Scanner
 *
 * High-level scanner that integrates with the call graph infrastructure
 * to perform wrapper detection across a codebase.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { minimatch } from 'minimatch';

import {
  mapLanguage,
  buildDiscoveryContext,
  buildDetectionContext,
  filterExtractions,
  calculateExtractionStats,
  type AdapterOptions,
  type ExtractionStats,
} from './adapter.js';
import { CSharpCallGraphExtractor } from '../../call-graph/extractors/csharp-extractor.js';
import { JavaCallGraphExtractor } from '../../call-graph/extractors/java-extractor.js';
import { PhpCallGraphExtractor } from '../../call-graph/extractors/php-extractor.js';
import { PythonCallGraphExtractor } from '../../call-graph/extractors/python-extractor.js';
import { TypeScriptCallGraphExtractor } from '../../call-graph/extractors/typescript-extractor.js';
import { analyzeWrappers, type AnalysisOptions } from '../index.js';

import type { BaseCallGraphExtractor } from '../../call-graph/extractors/base-extractor.js';
import type { FileExtractionResult } from '../../call-graph/types.js';
import type {
  WrapperAnalysisResult,
  SupportedLanguage,
  WrapperFunction,
  WrapperCluster,
} from '../types.js';
import type { Dirent } from 'node:fs';

// =============================================================================
// Types
// =============================================================================

export interface WrapperScannerConfig {
  /** Project root directory */
  rootDir: string;
  /** File patterns to scan (glob) */
  patterns?: string[];
  /** Include test files */
  includeTestFiles?: boolean;
  /** Verbose logging */
  verbose?: boolean;
}

export interface WrapperScanResult {
  /** Full analysis result */
  analysis: WrapperAnalysisResult;
  /** Extraction statistics */
  stats: ExtractionStats;
  /** Scan duration in ms */
  duration: number;
  /** Any errors encountered */
  errors: string[];
}

// =============================================================================
// Default Patterns
// =============================================================================

const DEFAULT_PATTERNS = [
  '**/*.ts',
  '**/*.tsx',
  '**/*.js',
  '**/*.jsx',
  '**/*.py',
  '**/*.java',
  '**/*.cs',
  '**/*.php',
];

const IGNORE_PATTERNS = [
  'node_modules',
  '.git',
  'dist',
  'build',
  '__pycache__',
  '.next',
  '.nuxt',
  'vendor',
  'target',
  'bin',
  'obj',
];

// =============================================================================
// Wrapper Scanner
// =============================================================================

/**
 * Wrapper Scanner
 *
 * Scans a codebase for framework wrapper patterns using the call graph
 * infrastructure for extraction.
 */
export class WrapperScanner {
  private readonly config: WrapperScannerConfig;
  private readonly extractors: BaseCallGraphExtractor[];

  constructor(config: WrapperScannerConfig) {
    this.config = {
      patterns: DEFAULT_PATTERNS,
      includeTestFiles: false,
      verbose: false,
      ...config,
    };

    // Initialize extractors
    this.extractors = [
      new TypeScriptCallGraphExtractor(),
      new PythonCallGraphExtractor(),
      new JavaCallGraphExtractor(),
      new CSharpCallGraphExtractor(),
      new PhpCallGraphExtractor(),
    ];
  }

  /**
   * Scan the codebase for wrapper patterns
   */
  async scan(options: AnalysisOptions = {}): Promise<WrapperScanResult> {
    const startTime = Date.now();
    const errors: string[] = [];

    // Find files to scan
    const files = await this.findFiles();

    if (this.config.verbose) {
      console.log(`Found ${files.length} files to scan`);
    }

    // Extract from all files
    const extractions: FileExtractionResult[] = [];

    for (const file of files) {
      const extractor = this.getExtractor(file);
      if (!extractor) {continue;}

      try {
        const filePath = path.join(this.config.rootDir, file);
        const source = await fs.readFile(filePath, 'utf-8');
        const extraction = extractor.extract(source, file);
        extractions.push(extraction);
      } catch (error) {
        const msg = `Error extracting ${file}: ${error instanceof Error ? error.message : error}`;
        errors.push(msg);
        if (this.config.verbose) {
          console.error(msg);
        }
      }
    }

    // Filter extractions
    const adapterOptions: AdapterOptions = {
      includeTestFiles: this.config.includeTestFiles,
    };
    const filtered = filterExtractions(extractions, adapterOptions);

    // Calculate stats
    const stats = calculateExtractionStats(filtered);

    if (this.config.verbose) {
      console.log(`Extracted ${stats.totalFunctions} functions from ${stats.totalFiles} files`);
    }

    // Group by language and analyze
    const byLanguage = this.groupByLanguage(filtered);
    const combinedResult = this.createEmptyResult();

    for (const [language, langExtractions] of byLanguage) {
      if (this.config.verbose) {
        console.log(`Analyzing ${langExtractions.length} ${language} files...`);
      }

      // Build contexts
      const discoveryContext = buildDiscoveryContext(langExtractions, language);
      const detectionContext = buildDetectionContext(langExtractions, [], language);

      // Run analysis
      const result = analyzeWrappers(
        discoveryContext,
        { functions: detectionContext.functions, language },
        options
      );

      // Merge results
      this.mergeResults(combinedResult, result);
    }

    // Recalculate summary
    this.recalculateSummary(combinedResult);

    return {
      analysis: combinedResult,
      stats,
      duration: Date.now() - startTime,
      errors,
    };
  }

  /**
   * Scan specific files (for incremental analysis)
   */
  async scanFiles(
    files: string[],
    options: AnalysisOptions = {}
  ): Promise<WrapperScanResult> {
    const startTime = Date.now();
    const errors: string[] = [];

    const extractions: FileExtractionResult[] = [];

    for (const file of files) {
      const extractor = this.getExtractor(file);
      if (!extractor) {continue;}

      try {
        const filePath = path.join(this.config.rootDir, file);
        const source = await fs.readFile(filePath, 'utf-8');
        const extraction = extractor.extract(source, file);
        extractions.push(extraction);
      } catch (error) {
        errors.push(`Error extracting ${file}: ${error instanceof Error ? error.message : error}`);
      }
    }

    const stats = calculateExtractionStats(extractions);
    const byLanguage = this.groupByLanguage(extractions);
    const combinedResult = this.createEmptyResult();

    for (const [language, langExtractions] of byLanguage) {
      const discoveryContext = buildDiscoveryContext(langExtractions, language);
      const detectionContext = buildDetectionContext(langExtractions, [], language);

      const result = analyzeWrappers(
        discoveryContext,
        { functions: detectionContext.functions, language },
        options
      );

      this.mergeResults(combinedResult, result);
    }

    this.recalculateSummary(combinedResult);

    return {
      analysis: combinedResult,
      stats,
      duration: Date.now() - startTime,
      errors,
    };
  }

  /**
   * Get wrappers for a specific file
   */
  async getFileWrappers(file: string): Promise<WrapperFunction[]> {
    const result = await this.scanFiles([file]);
    return result.analysis.wrappers.filter((w) => w.file === file);
  }

  /**
   * Get clusters containing wrappers from a specific file
   */
  async getFileClusters(file: string): Promise<WrapperCluster[]> {
    const result = await this.scanFiles([file]);
    return result.analysis.clusters.filter((c) =>
      c.wrappers.some((w) => w.file === file)
    );
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  /**
   * Find files matching patterns
   */
  private async findFiles(): Promise<string[]> {
    const files: string[] = [];
    const patterns = this.config.patterns || DEFAULT_PATTERNS;

    const walk = async (dir: string, relativePath: string = ''): Promise<void> => {
      let entries: Dirent[];
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return; // Skip inaccessible directories
      }

      for (const entry of entries) {
        const entryName = entry.name;
        const fullPath = path.join(dir, entryName);
        const relPath = relativePath ? `${relativePath}/${entryName}` : entryName;

        if (entry.isDirectory()) {
          if (!IGNORE_PATTERNS.includes(entryName) && !entryName.startsWith('.')) {
            await walk(fullPath, relPath);
          }
        } else if (entry.isFile()) {
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

  /**
   * Get extractor for a file
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
   * Group extractions by language
   */
  private groupByLanguage(
    extractions: FileExtractionResult[]
  ): Map<SupportedLanguage, FileExtractionResult[]> {
    const byLanguage = new Map<SupportedLanguage, FileExtractionResult[]>();

    for (const extraction of extractions) {
      const lang = mapLanguage(extraction.language);
      if (!lang) {continue;}

      const existing = byLanguage.get(lang) || [];
      byLanguage.set(lang, [...existing, extraction]);
    }

    return byLanguage;
  }

  /**
   * Create empty analysis result
   */
  private createEmptyResult(): WrapperAnalysisResult {
    return {
      frameworks: [],
      primitives: [],
      wrappers: [],
      clusters: [],
      factories: [],
      decoratorWrappers: [],
      asyncWrappers: [],
      summary: {
        totalWrappers: 0,
        totalClusters: 0,
        avgDepth: 0,
        maxDepth: 0,
        mostWrappedPrimitive: 'N/A',
        mostUsedWrapper: 'N/A',
        wrappersByLanguage: {
          typescript: 0,
          python: 0,
          java: 0,
          csharp: 0,
          php: 0,
          rust: 0,
          cpp: 0,
        },
        wrappersByCategory: {
          'state-management': 0,
          'data-fetching': 0,
          'side-effects': 0,
          'authentication': 0,
          'authorization': 0,
          'validation': 0,
          'dependency-injection': 0,
          'middleware': 0,
          'testing': 0,
          'logging': 0,
          'caching': 0,
          'error-handling': 0,
          'async-utilities': 0,
          'form-handling': 0,
          'routing': 0,
          'factory': 0,
          'decorator': 0,
          'utility': 0,
          'other': 0,
        },
      },
    };
  }

  /**
   * Merge analysis results
   */
  private mergeResults(
    target: WrapperAnalysisResult,
    source: WrapperAnalysisResult
  ): void {
    // Merge arrays (dedupe by name/id where applicable)
    target.frameworks.push(...source.frameworks);
    target.primitives.push(...source.primitives);
    target.wrappers.push(...source.wrappers);
    target.clusters.push(...source.clusters);
    target.factories.push(...source.factories);
    target.decoratorWrappers.push(...source.decoratorWrappers);
    target.asyncWrappers.push(...source.asyncWrappers);
  }

  /**
   * Recalculate summary after merging
   */
  private recalculateSummary(result: WrapperAnalysisResult): void {
    const { wrappers, clusters } = result;

    // Calculate depths
    const depths = wrappers.map((w) => w.depth);
    const avgDepth = depths.length > 0
      ? depths.reduce((a, b) => a + b, 0) / depths.length
      : 0;
    const maxDepth = depths.length > 0 ? Math.max(...depths) : 0;

    // Count by language
    const byLanguage = result.summary.wrappersByLanguage;
    for (const wrapper of wrappers) {
      byLanguage[wrapper.language]++;
    }

    // Count by category
    const byCategory = result.summary.wrappersByCategory;
    for (const cluster of clusters) {
      byCategory[cluster.category] += cluster.wrappers.length;
    }

    // Find most wrapped primitive
    const primitiveCounts = new Map<string, number>();
    for (const wrapper of wrappers) {
      for (const prim of wrapper.primitiveSignature) {
        primitiveCounts.set(prim, (primitiveCounts.get(prim) || 0) + 1);
      }
    }
    const mostWrapped = [...primitiveCounts.entries()].sort((a, b) => b[1] - a[1])[0];

    // Find most used wrapper
    const mostUsed = wrappers.reduce(
      (max, w) => (w.calledBy.length > (max?.calledBy.length || 0) ? w : max),
      wrappers[0]
    );

    result.summary = {
      totalWrappers: wrappers.length,
      totalClusters: clusters.length,
      avgDepth,
      maxDepth,
      mostWrappedPrimitive: mostWrapped?.[0] || 'N/A',
      mostUsedWrapper: mostUsed?.name || 'N/A',
      wrappersByLanguage: byLanguage,
      wrappersByCategory: byCategory,
    };
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a new WrapperScanner instance
 */
export function createWrapperScanner(config: WrapperScannerConfig): WrapperScanner {
  return new WrapperScanner(config);
}
