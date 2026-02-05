/**
 * Scanner Service - Enterprise-grade pattern detection with Worker Threads
 *
 * Uses the real detectors from driftdetect-detectors to find
 * high-value architectural patterns and violations.
 *
 * Now uses Piscina worker threads for parallel CPU-bound processing.
 * 
 * MOVED FROM: drift/packages/cli/src/services/scanner-service.ts
 * This service is now shared between CLI and MCP packages.
 */

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  type Language,
  type PatternMatch,
  ManifestStore,
  hashContent,
  type SemanticLocation,
  type SemanticType,
  type ManifestPattern,
  type Manifest,
  type PatternMatchResult,
  OutlierDetector,
} from '../index.js';

import type {
  DetectorWorkerTask,
  DetectorWorkerResult,
  WorkerPatternMatch,
} from './detector-worker.js';

// ============================================================================
// Dynamic Detector Import (breaks cyclic dependency with detectors package)
// ============================================================================

/**
 * Detector types - imported dynamically to avoid cyclic dependency
 */
interface BaseDetector {
  id: string;
  getInfo(): {
    name: string;
    description: string;
    category: string;
    subcategory: string;
    supportedLanguages: Language[];
  };
  detect(context: DetectionContext): Promise<{
    patterns: PatternMatch[];
    violations: Array<{
      id: string;
      patternId: string;
      severity: 'error' | 'warning' | 'info' | 'hint';
      file: string;
      range: { start: { line: number; character: number }; end: { line: number; character: number } };
      message: string;
      expected: string;
      actual: string;
      explanation?: string;
      aiExplainAvailable: boolean;
      aiFixAvailable: boolean;
      firstSeen: Date;
      occurrences: number;
    }>;
    metadata?: { custom?: Record<string, unknown> };
  }>;
}

interface DetectionContext {
  file: string;
  content: string;
  language: Language;
  ast: unknown;
  imports: string[];
  exports: string[];
  extension: string;
  isTestFile: boolean;
  isTypeDefinition: boolean;
  projectContext: {
    rootDir: string;
    files: string[];
    config: Record<string, unknown>;
  };
}

interface DetectorsModule {
  createAllDetectorsArray: () => Promise<BaseDetector[]>;
  getDetectorCounts: () => Record<string, number>;
}

let detectorsModule: DetectorsModule | null = null;
let detectorsLoadPromise: Promise<DetectorsModule> | null = null;

/**
 * Dynamically load the detectors module
 * This breaks the cyclic dependency between core and detectors packages
 */
async function loadDetectorsModule(): Promise<DetectorsModule> {
  if (detectorsModule) {
    return detectorsModule;
  }
  
  if (detectorsLoadPromise) {
    return detectorsLoadPromise;
  }
  
  detectorsLoadPromise = import('driftdetect-detectors').then((mod) => {
    detectorsModule = mod as unknown as DetectorsModule;
    return detectorsModule;
  });
  
  return detectorsLoadPromise;
}

/**
 * Create all detectors array (dynamic wrapper)
 */
async function createAllDetectorsArray(): Promise<BaseDetector[]> {
  const mod = await loadDetectorsModule();
  return mod.createAllDetectorsArray();
}

/**
 * Get detector counts by category (dynamic wrapper)
 */
async function getDetectorCounts(): Promise<Record<string, number>> {
  const mod = await loadDetectorsModule();
  return mod.getDetectorCounts();
}


// Get the directory of this module for worker path resolution
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Piscina types (dynamic import)
interface Piscina {
  run<T>(task: unknown): Promise<T>;
  destroy(): Promise<void>;
  readonly threads: unknown[];
  readonly queueSize: number;
  readonly completed: number;
}

type PiscinaConstructor = new (options: {
  filename: string;
  minThreads?: number;
  maxThreads?: number;
  idleTimeout?: number;
}) => Piscina;

// ============================================================================
// Types
// ============================================================================

/**
 * Project-wide context for detection
 */
export interface ProjectContext {
  rootDir: string;
  files: string[];
  config: Record<string, unknown>;
}

/**
 * Scanner service configuration
 */
export interface ScannerServiceConfig {
  rootDir: string;
  verbose?: boolean;
  categories?: string[];
  /** Only run critical/high-value detectors */
  criticalOnly?: boolean;
  /** Enable manifest generation */
  generateManifest?: boolean;
  /** Only scan changed files (incremental) */
  incremental?: boolean;
  /** Use worker threads for parallel processing */
  useWorkerThreads?: boolean;
  /** Number of worker threads (default: CPU cores - 1) */
  workerThreads?: number;
}


/**
 * Aggregated pattern match across files
 * 
 * Enhanced to preserve all metadata from detectors including:
 * - Full location range (endLine/endColumn)
 * - Outlier information per location
 * - Matched text for context
 */
export interface AggregatedPattern {
  patternId: string;
  detectorId: string;
  category: string;
  subcategory: string;
  name: string;
  description: string;
  locations: Array<{
    file: string;
    line: number;
    column: number;
    /** End line for full range highlighting */
    endLine?: number;
    /** End column for full range highlighting */
    endColumn?: number;
    /** Whether this specific location is an outlier */
    isOutlier?: boolean;
    /** Reason for outlier classification */
    outlierReason?: string;
    /** The actual text that was matched */
    matchedText?: string;
    /** Per-location confidence score */
    confidence?: number;
  }>;
  confidence: number;
  occurrences: number;
  /** Total number of outliers across all locations */
  outlierCount: number;
  /** Custom metadata from detectors */
  metadata?: Record<string, unknown>;
}

/**
 * Aggregated violation across files
 */
export interface AggregatedViolation {
  patternId: string;
  detectorId: string;
  category: string;
  severity: 'error' | 'warning' | 'info' | 'hint';
  file: string;
  line: number;
  column: number;
  message: string;
  explanation?: string | undefined;
  suggestedFix?: string | undefined;
}

/**
 * Scan result for a single file
 */
export interface FileScanResult {
  file: string;
  patterns: Array<{
    patternId: string;
    detectorId: string;
    confidence: number;
    location: {
      file: string;
      line: number;
      column: number;
      endLine?: number;
      endColumn?: number;
    };
    isOutlier?: boolean;
    outlierReason?: string;
    matchedText?: string;
    metadata?: Record<string, unknown>;
  }>;
  violations: AggregatedViolation[];
  duration: number;
  error?: string | undefined;
}


/**
 * Overall scan results
 */
export interface ScanResults {
  files: FileScanResult[];
  patterns: AggregatedPattern[];
  violations: AggregatedViolation[];
  totalPatterns: number;
  totalViolations: number;
  totalFiles: number;
  duration: number;
  errors: string[];
  detectorStats: {
    total: number;
    ran: number;
    skipped: number;
  };
  /** Manifest with semantic locations (if generateManifest is true) */
  manifest?: Manifest | undefined;
  /** Worker thread stats (if useWorkerThreads is true) */
  workerStats?: {
    threadsUsed: number;
    tasksCompleted: number;
  } | undefined;
}

// ============================================================================
// Location Deduplication
// ============================================================================

function locationKey(loc: { file: string; line: number; column: number }): string {
  return `${loc.file}:${loc.line}:${loc.column}`;
}

function semanticLocationKey(loc: SemanticLocation): string {
  return `${loc.file}:${loc.range.start}:${loc.range.end}:${loc.name}`;
}

function addUniqueLocation<T extends { file: string; line: number; column: number }>(
  locations: T[],
  location: T,
  seenKeys?: Set<string>
): boolean {
  const key = locationKey(location);
  const seen = seenKeys || new Set(locations.map(locationKey));
  if (seen.has(key)) {
    return false;
  }
  seen.add(key);
  locations.push(location);
  return true;
}

function addUniqueSemanticLocation(
  locations: SemanticLocation[],
  location: SemanticLocation,
  seenKeys?: Set<string>
): boolean {
  const key = semanticLocationKey(location);
  const seen = seenKeys || new Set(locations.map(semanticLocationKey));
  if (seen.has(key)) {
    return false;
  }
  seen.add(key);
  locations.push(location);
  return true;
}


// ============================================================================
// Language Detection
// ============================================================================

const EXTENSION_TO_LANGUAGE: Record<string, Language> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  py: 'python',
  pyw: 'python',
  cs: 'csharp',
  java: 'java',
  php: 'php',
  css: 'css',
  scss: 'css',
  sass: 'css',
  less: 'css',
  json: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  md: 'markdown',
  mdx: 'markdown',
};

function getLanguage(filePath: string): Language | null {
  const ext = path.extname(filePath).slice(1).toLowerCase();
  return EXTENSION_TO_LANGUAGE[ext] || null;
}

function isDetectorApplicable(detector: BaseDetector, language: Language | null): boolean {
  if (!language) {return false;}
  const info = detector.getInfo();
  return info.supportedLanguages.includes(language);
}

// ============================================================================
// Critical Detectors
// ============================================================================

const CRITICAL_DETECTOR_IDS = new Set([
  'security/sql-injection',
  'security/xss-prevention',
  'security/secret-management',
  'security/input-sanitization',
  'security/csrf-protection',
  'auth/middleware-usage',
  'auth/token-handling',
  'api/route-structure',
  'api/error-format',
  'api/response-envelope',
  'data-access/n-plus-one',
  'data-access/query-patterns',
  'structural/circular-deps',
  'structural/module-boundaries',
  'errors/exception-hierarchy',
  'errors/try-catch-placement',
  'logging/pii-redaction',
]);


// ============================================================================
// Scanner Service
// ============================================================================

/**
 * Scanner Service
 *
 * Orchestrates pattern detection across files using real detectors.
 * Supports both single-threaded and multi-threaded (Piscina) modes.
 */
export class ScannerService {
  private config: ScannerServiceConfig;
  private detectors: BaseDetector[] = [];
  private initialized = false;
  private manifestStore: ManifestStore | null = null;
  private pool: Piscina | null = null;
  private PiscinaClass: PiscinaConstructor | null = null;

  constructor(config: ScannerServiceConfig) {
    this.config = {
      ...config,
      // Default to using worker threads
      useWorkerThreads: config.useWorkerThreads ?? true,
      workerThreads: config.workerThreads ?? Math.max(1, os.cpus().length - 1),
    };
    if (config.generateManifest) {
      this.manifestStore = new ManifestStore(config.rootDir);
    }
  }

  /**
   * Initialize the scanner service
   */
  async initialize(): Promise<void> {
    if (this.initialized) {return;}

    // Create all detectors (needed for counts even in worker mode)
    this.detectors = await createAllDetectorsArray();

    // Filter by category if specified
    if (this.config.categories && this.config.categories.length > 0) {
      const categories = new Set(this.config.categories);
      this.detectors = this.detectors.filter(d => {
        const info = d.getInfo();
        return categories.has(info.category);
      });
    }

    // Filter to critical only if specified
    if (this.config.criticalOnly) {
      this.detectors = this.detectors.filter(d => CRITICAL_DETECTOR_IDS.has(d.id));
    }

    // Initialize worker pool if using threads
    if (this.config.useWorkerThreads) {
      try {
        const piscinaModule = await import('piscina');
        // Piscina exports as named export, not default
        this.PiscinaClass = (piscinaModule.Piscina || piscinaModule.default) as unknown as PiscinaConstructor;
        
        if (!this.PiscinaClass || typeof this.PiscinaClass !== 'function') {
          throw new Error(`Piscina class not found. Module exports: ${Object.keys(piscinaModule).join(', ')}`);
        }
        
        // Worker path - compiled JS in dist
        const workerPath = path.join(__dirname, 'detector-worker.js');
        
        if (this.config.verbose) {
          console.log(`  Worker path: ${workerPath}`);
        }
        
        this.pool = new this.PiscinaClass({
          filename: workerPath,
          minThreads: this.config.workerThreads!, // Keep all workers alive
          maxThreads: this.config.workerThreads!,
          idleTimeout: 60000, // 60s idle timeout
        });
        
        if (this.config.verbose) {
          console.log(`  Worker pool initialized with ${this.config.workerThreads} threads`);
        }
        
        // Warm up all workers in parallel - this loads detectors once per worker
        await this.warmupWorkers();
        
      } catch (error) {
        // Fall back to single-threaded mode
        console.log(`  Worker threads unavailable, using single-threaded mode: ${(error as Error).message}`);
        if (this.config.verbose) {
          console.log(`  Full error: ${(error as Error).stack}`);
        }
        this.config.useWorkerThreads = false;
      }
    }

    // Load existing manifest for incremental scanning
    if (this.manifestStore) {
      await this.manifestStore.load();
    }

    this.initialized = true;
  }

  /**
   * Warm up all worker threads by preloading detectors
   * This runs warmup tasks in parallel so all workers load detectors simultaneously
   */
  private async warmupWorkers(): Promise<void> {
    if (!this.pool) {return;}
    
    const numWorkers = this.config.workerThreads!;
    const warmupTasks = Array(numWorkers).fill(null).map(() => ({
      type: 'warmup' as const,
      categories: this.config.categories,
      criticalOnly: this.config.criticalOnly,
    }));
    
    if (this.config.verbose) {
      console.log(`  Warming up ${numWorkers} workers...`);
    }
    
    const startTime = Date.now();
    
    // Run warmup tasks in parallel - each worker gets one task
    await Promise.all(
      warmupTasks.map(task => this.pool!.run(task))
    );
    
    const duration = Date.now() - startTime;
    
    if (this.config.verbose) {
      console.log(`  Workers warmed up in ${duration}ms`);
    }
  }

  /**
   * Get detector count
   */
  getDetectorCount(): number {
    return this.detectors.length;
  }

  /**
   * Get detector counts by category
   */
  async getDetectorCounts() {
    return await getDetectorCounts();
  }

  /**
   * Check if worker threads are enabled and initialized
   */
  isUsingWorkerThreads(): boolean {
    return this.config.useWorkerThreads === true && this.pool !== null;
  }

  /**
   * Get worker thread count
   */
  getWorkerThreadCount(): number {
    return this.config.workerThreads ?? 0;
  }

  /**
   * Scan files for patterns
   */
  async scanFiles(files: string[], projectContext: ProjectContext): Promise<ScanResults> {
    if (this.config.useWorkerThreads && this.pool) {
      return this.scanFilesWithWorkers(files, projectContext);
    }
    return this.scanFilesSingleThreaded(files, projectContext);
  }

  /**
   * Scan files using worker threads (parallel)
   */
  private async scanFilesWithWorkers(
    files: string[],
    projectContext: ProjectContext
  ): Promise<ScanResults> {
    const startTime = Date.now();
    const errors: string[] = [];

    // Filter to changed files if incremental
    let filesToScan = files;
    if (this.config.incremental && this.manifestStore) {
      const fullPaths = files.map(f => path.join(this.config.rootDir, f));
      const changedPaths = await this.manifestStore.getChangedFiles(fullPaths);
      filesToScan = changedPaths.map(f => path.relative(this.config.rootDir, f));
      
      for (const file of filesToScan) {
        this.manifestStore.clearFilePatterns(path.join(this.config.rootDir, file));
      }
    }

    // Create tasks for worker pool
    const tasks: DetectorWorkerTask[] = filesToScan.map(file => ({
      file,
      rootDir: this.config.rootDir,
      projectFiles: projectContext.files,
      projectConfig: projectContext.config,
      categories: this.config.categories,
      criticalOnly: this.config.criticalOnly,
    }));

    // Run all tasks in parallel
    const results = await Promise.all(
      tasks.map(async (task): Promise<DetectorWorkerResult> => {
        try {
          return await this.pool!.run<DetectorWorkerResult>(task);
        } catch (error) {
          return {
            file: task.file,
            language: null,
            patterns: [],
            violations: [],
            detectorsRan: 0,
            detectorsSkipped: 0,
            duration: 0,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      })
    );

    // Aggregate results
    return this.aggregateWorkerResults(results, files, startTime, errors);
  }


  /**
   * Aggregate results from worker threads
   */
  private async aggregateWorkerResults(
    results: DetectorWorkerResult[],
    allFiles: string[],
    startTime: number,
    errors: string[]
  ): Promise<ScanResults> {
    const fileResults: FileScanResult[] = [];
    const patternMap = new Map<string, AggregatedPattern>();
    const allViolations: AggregatedViolation[] = [];
    const manifestPatternMap = new Map<string, ManifestPattern>();
    
    let totalDetectorsRan = 0;
    let totalDetectorsSkipped = 0;

    for (const result of results) {
      if (result.error) {
        errors.push(`Failed to scan ${result.file}: ${result.error}`);
      }

      totalDetectorsRan += result.detectorsRan;
      totalDetectorsSkipped += result.detectorsSkipped;

      // Convert to FileScanResult - PRESERVE ALL METADATA
      const filePatterns: FileScanResult['patterns'] = result.patterns.map(p => {
        const loc: FileScanResult['patterns'][0]['location'] = {
          file: p.location.file,
          line: p.location.line,
          column: p.location.column,
        };
        if (p.location.endLine !== undefined) {loc.endLine = p.location.endLine;}
        if (p.location.endColumn !== undefined) {loc.endColumn = p.location.endColumn;}
        
        const pattern: FileScanResult['patterns'][0] = {
          patternId: p.patternId,
          detectorId: p.detectorId,
          confidence: p.confidence,
          location: loc,
        };
        if (p.isOutlier !== undefined) {pattern.isOutlier = p.isOutlier;}
        if (p.outlierReason !== undefined) {pattern.outlierReason = p.outlierReason;}
        if (p.matchedText !== undefined) {pattern.matchedText = p.matchedText;}
        if (p.metadata !== undefined) {pattern.metadata = p.metadata;}
        return pattern;
      });

      fileResults.push({
        file: result.file,
        patterns: filePatterns,
        violations: result.violations,
        duration: result.duration,
        error: result.error,
      });

      // Aggregate patterns - PRESERVE ALL METADATA
      for (const match of result.patterns) {
        const key = match.patternId;
        const existing = patternMap.get(key);
        
        // Create enhanced location with all metadata
        const enhancedLocation: AggregatedPattern['locations'][0] = {
          file: match.location.file,
          line: match.location.line,
          column: match.location.column,
        };
        if (match.location.endLine !== undefined) {enhancedLocation.endLine = match.location.endLine;}
        if (match.location.endColumn !== undefined) {enhancedLocation.endColumn = match.location.endColumn;}
        if (match.isOutlier !== undefined) {enhancedLocation.isOutlier = match.isOutlier;}
        if (match.outlierReason !== undefined) {enhancedLocation.outlierReason = match.outlierReason;}
        if (match.matchedText !== undefined) {enhancedLocation.matchedText = match.matchedText;}
        enhancedLocation.confidence = match.confidence;
        
        if (existing) {
          addUniqueLocation(existing.locations, enhancedLocation);
          existing.occurrences++;
          existing.confidence = Math.max(existing.confidence, match.confidence);
          // Track outlier count
          if (match.isOutlier) {
            existing.outlierCount = (existing.outlierCount || 0) + 1;
          }
          // Merge metadata
          if (match.metadata) {
            existing.metadata = { ...existing.metadata, ...match.metadata };
          }
        } else {
          const newPattern: AggregatedPattern = {
            patternId: match.patternId,
            detectorId: match.detectorId,
            category: match.category,
            subcategory: match.subcategory,
            name: match.detectorName,
            description: match.detectorDescription,
            locations: [enhancedLocation],
            confidence: match.confidence,
            occurrences: 1,
            outlierCount: match.isOutlier ? 1 : 0,
          };
          if (match.metadata !== undefined) {newPattern.metadata = match.metadata;}
          patternMap.set(key, newPattern);
        }

        // Build manifest pattern
        if (this.config.generateManifest && result.language) {
          await this.addToManifest(manifestPatternMap, match, result);
        }
      }

      // Aggregate violations
      for (const violation of result.violations) {
        allViolations.push(violation);
      }
    }

    // Convert pattern map to array
    const patterns = Array.from(patternMap.values());

    // Run statistical outlier detection
    const outlierDetector = new OutlierDetector({ 
      sensitivity: 0.5,
      minSampleSize: 5,
    });

    for (const pattern of patterns) {
      if (pattern.locations.length < 5) {continue;}

      const matchResults: PatternMatchResult[] = pattern.locations.map((loc) => {
        const result: PatternMatchResult = {
          patternId: pattern.patternId,
          location: {
            file: loc.file,
            line: loc.line,
            column: loc.column,
          },
          confidence: loc.confidence ?? pattern.confidence,
          isOutlier: loc.isOutlier ?? false,
          matchType: 'ast' as const,
          timestamp: new Date(),
        };
        if (loc.endLine !== undefined) {result.location.endLine = loc.endLine;}
        if (loc.endColumn !== undefined) {result.location.endColumn = loc.endColumn;}
        if (loc.matchedText !== undefined) {result.matchedText = loc.matchedText;}
        if (loc.outlierReason !== undefined) {result.outlierReason = loc.outlierReason;}
        return result;
      });

      const outlierResult = outlierDetector.detect(matchResults, pattern.patternId);

      for (const outlier of outlierResult.outliers) {
        const locIndex = pattern.locations.findIndex(
          loc => loc.file === outlier.location.file && 
                 loc.line === outlier.location.line &&
                 loc.column === outlier.location.column
        );

        if (locIndex !== -1) {
          const loc = pattern.locations[locIndex];
          if (!loc?.isOutlier) {
            if (loc) {
              loc.isOutlier = true;
              loc.outlierReason = outlier.reason;
            }
            pattern.outlierCount++;
          }
        }
      }
    }

    // Build and save manifest
    let manifest: Manifest | undefined;
    if (this.config.generateManifest && this.manifestStore) {
      const manifestPatterns = Array.from(manifestPatternMap.values());
      this.manifestStore.updatePatterns(manifestPatterns);
      await this.manifestStore.save();
      manifest = await this.manifestStore.get();
    }

    return {
      files: fileResults,
      patterns,
      violations: allViolations,
      totalPatterns: patterns.reduce((sum, p) => sum + p.occurrences, 0),
      totalViolations: allViolations.length,
      totalFiles: allFiles.length,
      duration: Date.now() - startTime,
      errors,
      detectorStats: {
        total: this.detectors.length,
        ran: totalDetectorsRan,
        skipped: totalDetectorsSkipped,
      },
      workerStats: this.pool ? {
        threadsUsed: (this.pool.threads).length,
        tasksCompleted: this.pool.completed,
      } : undefined,
      manifest,
    };
  }


  /**
   * Add pattern match to manifest
   */
  private async addToManifest(
    manifestPatternMap: Map<string, ManifestPattern>,
    match: WorkerPatternMatch,
    result: DetectorWorkerResult
  ): Promise<void> {
    try {
      const filePath = path.join(this.config.rootDir, result.file);
      const content = await fs.readFile(filePath, 'utf-8');
      const contentHash = hashContent(content);
      const language = result.language as Language;

      const semanticLoc = this.createSemanticLocation(
        match.location,
        content,
        contentHash,
        language
      );

      const manifestKey = `${match.category}/${match.subcategory}/${match.patternId}`;
      const existingManifest = manifestPatternMap.get(manifestKey);

      if (existingManifest) {
        addUniqueSemanticLocation(existingManifest.locations, semanticLoc);
        existingManifest.confidence = Math.max(existingManifest.confidence, match.confidence);
        existingManifest.lastSeen = new Date().toISOString();
      } else {
        manifestPatternMap.set(manifestKey, {
          id: manifestKey,
          name: match.detectorName,
          category: match.category as any,
          subcategory: match.subcategory,
          status: 'discovered',
          confidence: match.confidence,
          locations: [semanticLoc],
          outliers: [],
          description: match.detectorDescription,
          firstSeen: new Date().toISOString(),
          lastSeen: new Date().toISOString(),
        });
      }
    } catch {
      // Ignore manifest errors
    }
  }

  /**
   * Scan files single-threaded (fallback)
   */
  private async scanFilesSingleThreaded(
    files: string[],
    projectContext: ProjectContext
  ): Promise<ScanResults> {
    const startTime = Date.now();
    const fileResults: FileScanResult[] = [];
    const errors: string[] = [];
    const patternMap = new Map<string, AggregatedPattern>();
    const allViolations: AggregatedViolation[] = [];
    const manifestPatternMap = new Map<string, ManifestPattern>();
    
    let detectorsRan = 0;
    let detectorsSkipped = 0;

    // Filter to changed files if incremental
    let filesToScan = files;
    if (this.config.incremental && this.manifestStore) {
      const fullPaths = files.map(f => path.join(this.config.rootDir, f));
      const changedPaths = await this.manifestStore.getChangedFiles(fullPaths);
      filesToScan = changedPaths.map(f => path.relative(this.config.rootDir, f));
      
      for (const file of filesToScan) {
        this.manifestStore.clearFilePatterns(path.join(this.config.rootDir, file));
      }
    }

    for (const file of filesToScan) {
      const fileStart = Date.now();
      const filePath = path.join(this.config.rootDir, file);
      const language = getLanguage(file);

      if (!language) {
        fileResults.push({
          file,
          patterns: [],
          violations: [],
          duration: Date.now() - fileStart,
        });
        continue;
      }

      try {
        const content = await fs.readFile(filePath, 'utf-8');
        const contentHash = hashContent(content);
        const filePatterns: FileScanResult['patterns'] = [];
        const fileViolations: AggregatedViolation[] = [];

        const context: DetectionContext = {
          file,
          content,
          language,
          ast: null,
          imports: [],
          exports: [],
          extension: path.extname(file),
          isTestFile: /\.(test|spec)\.[jt]sx?$/.test(file) || file.includes('__tests__'),
          isTypeDefinition: file.endsWith('.d.ts'),
          projectContext: {
            rootDir: projectContext.rootDir,
            files: projectContext.files,
            config: projectContext.config,
          },
        };

        for (const detector of this.detectors) {
          if (!isDetectorApplicable(detector, language)) {
            detectorsSkipped++;
            continue;
          }

          detectorsRan++;

          try {
            const result = await detector.detect(context);
            const info = detector.getInfo();

            for (const match of result.patterns) {
              const extendedMatch = match as PatternMatch & {
                outlierReason?: string;
                matchedText?: string;
                metadata?: Record<string, unknown>;
              };
              
              const enhancedLocation: FileScanResult['patterns'][0]['location'] = {
                file: match.location.file,
                line: match.location.line,
                column: match.location.column,
              };
              if (match.location.endLine !== undefined) {enhancedLocation.endLine = match.location.endLine;}
              if (match.location.endColumn !== undefined) {enhancedLocation.endColumn = match.location.endColumn;}
              
              const filePattern: FileScanResult['patterns'][0] = {
                patternId: match.patternId,
                detectorId: detector.id,
                confidence: match.confidence,
                location: enhancedLocation,
              };
              if (match.isOutlier !== undefined) {filePattern.isOutlier = match.isOutlier;}
              if (extendedMatch.outlierReason !== undefined) {filePattern.outlierReason = extendedMatch.outlierReason;}
              if (extendedMatch.matchedText !== undefined) {filePattern.matchedText = extendedMatch.matchedText;}
              const metadata = extendedMatch.metadata ?? result.metadata?.custom;
              if (metadata !== undefined) {filePattern.metadata = metadata;}
              filePatterns.push(filePattern);

              const key = match.patternId;
              const existing = patternMap.get(key);
              
              const aggLocation: AggregatedPattern['locations'][0] = {
                file: match.location.file,
                line: match.location.line,
                column: match.location.column,
                confidence: match.confidence,
              };
              if (match.location.endLine !== undefined) {aggLocation.endLine = match.location.endLine;}
              if (match.location.endColumn !== undefined) {aggLocation.endColumn = match.location.endColumn;}
              if (match.isOutlier !== undefined) {aggLocation.isOutlier = match.isOutlier;}
              if (extendedMatch.outlierReason !== undefined) {aggLocation.outlierReason = extendedMatch.outlierReason;}
              if (extendedMatch.matchedText !== undefined) {aggLocation.matchedText = extendedMatch.matchedText;}
              
              if (existing) {
                addUniqueLocation(existing.locations, aggLocation);
                existing.occurrences++;
                existing.confidence = Math.max(existing.confidence, match.confidence);
                if (match.isOutlier) {
                  existing.outlierCount = (existing.outlierCount || 0) + 1;
                }
                if (extendedMatch.metadata || result.metadata?.custom) {
                  existing.metadata = { ...existing.metadata, ...(extendedMatch.metadata ?? result.metadata?.custom) };
                }
              } else {
                const newPattern: AggregatedPattern = {
                  patternId: match.patternId,
                  detectorId: detector.id,
                  category: info.category,
                  subcategory: info.subcategory,
                  name: info.name,
                  description: info.description,
                  locations: [aggLocation],
                  confidence: match.confidence,
                  occurrences: 1,
                  outlierCount: match.isOutlier ? 1 : 0,
                };
                const patternMetadata = extendedMatch.metadata ?? result.metadata?.custom;
                if (patternMetadata !== undefined) {newPattern.metadata = patternMetadata;}
                patternMap.set(key, newPattern);
              }

              if (this.config.generateManifest) {
                const semanticLoc = this.createSemanticLocation(
                  match.location,
                  content,
                  contentHash,
                  language
                );

                const manifestKey = `${info.category}/${info.subcategory}/${match.patternId}`;
                const existingManifest = manifestPatternMap.get(manifestKey);

                if (existingManifest) {
                  addUniqueSemanticLocation(existingManifest.locations, semanticLoc);
                  existingManifest.confidence = Math.max(existingManifest.confidence, match.confidence);
                  existingManifest.lastSeen = new Date().toISOString();
                } else {
                  manifestPatternMap.set(manifestKey, {
                    id: manifestKey,
                    name: info.name,
                    category: info.category as any,
                    subcategory: info.subcategory,
                    status: 'discovered',
                    confidence: match.confidence,
                    locations: [semanticLoc],
                    outliers: [],
                    description: info.description,
                    firstSeen: new Date().toISOString(),
                    lastSeen: new Date().toISOString(),
                  });
                }
              }
            }

            // Process violations
            for (const violation of result.violations) {
              const aggViolation: AggregatedViolation = {
                patternId: violation.patternId,
                detectorId: detector.id,
                category: info.category,
                severity: violation.severity,
                file: violation.file,
                line: violation.range.start.line + 1,
                column: violation.range.start.character + 1,
                message: violation.message,
                suggestedFix: violation.expected,
              };
              if (violation.explanation) {
                aggViolation.explanation = violation.explanation;
              }
              fileViolations.push(aggViolation);
              allViolations.push(aggViolation);
            }
          } catch (detectorError) {
            if (this.config.verbose) {
              errors.push(`Detector ${detector.id} failed on ${file}: ${(detectorError as Error).message}`);
            }
          }
        }

        fileResults.push({
          file,
          patterns: filePatterns,
          violations: fileViolations,
          duration: Date.now() - fileStart,
        });
      } catch (e) {
        const error = `Failed to scan ${file}: ${e instanceof Error ? e.message : e}`;
        errors.push(error);
        fileResults.push({
          file,
          patterns: [],
          violations: [],
          duration: Date.now() - fileStart,
          error,
        });
      }
    }

    const patterns = Array.from(patternMap.values());

    // Run statistical outlier detection
    const outlierDetectorST = new OutlierDetector({ 
      sensitivity: 0.5,
      minSampleSize: 5,
    });

    for (const pattern of patterns) {
      if (pattern.locations.length < 5) {continue;}

      const matchResults: PatternMatchResult[] = pattern.locations.map((loc) => {
        const result: PatternMatchResult = {
          patternId: pattern.patternId,
          location: {
            file: loc.file,
            line: loc.line,
            column: loc.column,
          },
          confidence: loc.confidence ?? pattern.confidence,
          isOutlier: loc.isOutlier ?? false,
          matchType: 'ast' as const,
          timestamp: new Date(),
        };
        if (loc.endLine !== undefined) {result.location.endLine = loc.endLine;}
        if (loc.endColumn !== undefined) {result.location.endColumn = loc.endColumn;}
        if (loc.matchedText !== undefined) {result.matchedText = loc.matchedText;}
        if (loc.outlierReason !== undefined) {result.outlierReason = loc.outlierReason;}
        return result;
      });

      const outlierResult = outlierDetectorST.detect(matchResults, pattern.patternId);

      for (const outlier of outlierResult.outliers) {
        const locIndex = pattern.locations.findIndex(
          loc => loc.file === outlier.location.file && 
                 loc.line === outlier.location.line &&
                 loc.column === outlier.location.column
        );

        if (locIndex !== -1) {
          const loc = pattern.locations[locIndex];
          if (!loc?.isOutlier) {
            if (loc) {
              loc.isOutlier = true;
              loc.outlierReason = outlier.reason;
            }
            pattern.outlierCount++;
          }
        }
      }
    }

    let manifest: Manifest | undefined;
    if (this.config.generateManifest && this.manifestStore) {
      const manifestPatterns = Array.from(manifestPatternMap.values());
      this.manifestStore.updatePatterns(manifestPatterns);
      await this.manifestStore.save();
      manifest = await this.manifestStore.get();
    }

    return {
      files: fileResults,
      patterns,
      violations: allViolations,
      totalPatterns: patterns.reduce((sum, p) => sum + p.occurrences, 0),
      totalViolations: allViolations.length,
      totalFiles: files.length,
      duration: Date.now() - startTime,
      errors,
      detectorStats: {
        total: this.detectors.length,
        ran: detectorsRan,
        skipped: detectorsSkipped,
      },
      manifest,
    };
  }


  /**
   * Create a semantic location from a basic location
   */
  private createSemanticLocation(
    location: { file: string; line: number; column: number },
    content: string,
    hash: string,
    language: Language,
    name?: string
  ): SemanticLocation {
    const lines = content.split('\n');
    const lineContent = lines[location.line - 1] || '';
    const semanticInfo = this.extractSemanticInfo(lineContent, language);

    const result: SemanticLocation = {
      file: location.file,
      hash,
      range: {
        start: location.line,
        end: location.line,
      },
      type: semanticInfo.type,
      name: name || semanticInfo.name || `line-${location.line}`,
      confidence: 0.9,
      snippet: lineContent.trim().substring(0, 100),
      language,
    };

    if (semanticInfo.signature) {
      result.signature = semanticInfo.signature;
    }

    return result;
  }

  /**
   * Extract semantic information from a line of code
   */
  private extractSemanticInfo(line: string, language: Language): {
    type: SemanticType;
    name?: string;
    signature?: string;
  } {
    const trimmed = line.trim();

    if (language === 'typescript' || language === 'javascript') {
      const classMatch = trimmed.match(/^(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/);
      if (classMatch?.[1]) {
        return { type: 'class', name: classMatch[1], signature: trimmed.substring(0, 80) };
      }

      const funcMatch = trimmed.match(/^(?:export\s+)?(?:async\s+)?function\s+(\w+)/);
      if (funcMatch?.[1]) {
        return { type: 'function', name: funcMatch[1], signature: trimmed.substring(0, 80) };
      }

      const arrowMatch = trimmed.match(/^(?:export\s+)?const\s+(\w+)\s*=/);
      if (arrowMatch?.[1]) {
        return { type: 'function', name: arrowMatch[1], signature: trimmed.substring(0, 80) };
      }

      const interfaceMatch = trimmed.match(/^(?:export\s+)?interface\s+(\w+)/);
      if (interfaceMatch?.[1]) {
        return { type: 'interface', name: interfaceMatch[1], signature: trimmed.substring(0, 80) };
      }

      const typeMatch = trimmed.match(/^(?:export\s+)?type\s+(\w+)/);
      if (typeMatch?.[1]) {
        return { type: 'type', name: typeMatch[1], signature: trimmed.substring(0, 80) };
      }
    }

    if (language === 'python') {
      const classMatch = trimmed.match(/^class\s+(\w+)/);
      if (classMatch?.[1]) {
        return { type: 'class', name: classMatch[1], signature: trimmed.substring(0, 80) };
      }

      const defMatch = trimmed.match(/^(?:async\s+)?def\s+(\w+)/);
      if (defMatch?.[1]) {
        return { type: 'function', name: defMatch[1], signature: trimmed.substring(0, 80) };
      }

      const decoratorMatch = trimmed.match(/^@(\w+)/);
      if (decoratorMatch?.[1]) {
        return { type: 'decorator', name: decoratorMatch[1], signature: trimmed };
      }
    }

    if (language === 'php') {
      const classMatch = trimmed.match(/^(?:abstract\s+|final\s+)?class\s+(\w+)/);
      if (classMatch?.[1]) {
        return { type: 'class', name: classMatch[1], signature: trimmed.substring(0, 80) };
      }

      const interfaceMatch = trimmed.match(/^interface\s+(\w+)/);
      if (interfaceMatch?.[1]) {
        return { type: 'interface', name: interfaceMatch[1], signature: trimmed.substring(0, 80) };
      }

      const traitMatch = trimmed.match(/^trait\s+(\w+)/);
      if (traitMatch?.[1]) {
        return { type: 'class', name: traitMatch[1], signature: trimmed.substring(0, 80) };
      }

      const funcMatch = trimmed.match(/^(?:public|protected|private)?\s*(?:static\s+)?function\s+(\w+)/);
      if (funcMatch?.[1]) {
        return { type: 'function', name: funcMatch[1], signature: trimmed.substring(0, 80) };
      }

      const attrMatch = trimmed.match(/^#\[(\w+)/);
      if (attrMatch?.[1]) {
        return { type: 'decorator', name: attrMatch[1], signature: trimmed };
      }
    }

    return { type: 'block' };
  }

  /**
   * Get the manifest store
   */
  getManifestStore(): ManifestStore | null {
    return this.manifestStore;
  }

  /**
   * Destroy the worker pool
   */
  async destroy(): Promise<void> {
    if (this.pool) {
      await this.pool.destroy();
      this.pool = null;
    }
  }
}

/**
 * Create a scanner service
 */
export function createScannerService(config: ScannerServiceConfig): ScannerService {
  return new ScannerService(config);
}
