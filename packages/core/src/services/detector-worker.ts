/**
 * Detector Worker - Worker thread for running pattern detectors
 *
 * This worker runs in a separate thread and handles:
 * - Loading and running detectors on file content
 * - Tree-sitter AST parsing
 * - Pattern matching and violation detection
 *
 * MOVED FROM: drift/packages/cli/src/workers/detector-worker.ts
 * This worker is now shared between CLI and MCP packages.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import type { Language, PatternMatch } from '../index.js';

// ============================================================================
// Dynamic Detector Import (breaks cyclic dependency with detectors package)
// ============================================================================

/**
 * Detector types - defined locally to avoid static import from detectors package
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

// ============================================================================
// Types
// ============================================================================

/**
 * Warmup task - preloads detectors without processing files
 */
export interface WarmupTask {
  type: 'warmup';
  categories?: string[] | undefined;
  criticalOnly?: boolean | undefined;
}

/**
 * Warmup result
 */
export interface WarmupResult {
  type: 'warmup';
  detectorsLoaded: number;
  duration: number;
}

/**
 * Task input for detector worker
 */
export interface DetectorWorkerTask {
  /** Task type - 'scan' for file processing, 'warmup' for preloading */
  type?: 'scan' | undefined;

  /** Relative path to the file */
  file: string;

  /** Root directory */
  rootDir: string;

  /** Project files list (for context) */
  projectFiles: string[];

  /** Project config */
  projectConfig: Record<string, unknown>;

  /** Detector IDs to run (empty = all) */
  detectorIds?: string[] | undefined;

  /** Categories to filter by */
  categories?: string[] | undefined;

  /** Only run critical detectors */
  criticalOnly?: boolean | undefined;
}

/**
 * Pattern match from detector
 * 
 * Enhanced to preserve all metadata from detectors including:
 * - Full location range (endLine/endColumn)
 * - Outlier information (isOutlier, outlierReason)
 * - Matched text for context
 * - Custom detector metadata
 */
export interface WorkerPatternMatch {
  patternId: string;
  detectorId: string;
  detectorName: string;
  detectorDescription: string;
  category: string;
  subcategory: string;
  confidence: number;
  location: {
    file: string;
    line: number;
    column: number;
    /** End line for full range highlighting */
    endLine?: number;
    /** End column for full range highlighting */
    endColumn?: number;
  };
  /** Whether this match deviates from the established pattern */
  isOutlier?: boolean;
  /** Explanation for why this is an outlier */
  outlierReason?: string;
  /** The actual text that was matched */
  matchedText?: string;
  /** Custom metadata from the detector (auth types, route info, etc.) */
  metadata?: Record<string, unknown>;
}

/**
 * Violation from detector
 */
export interface WorkerViolation {
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
 * Result from detector worker
 */
export interface DetectorWorkerResult {
  /** File that was processed */
  file: string;

  /** Detected language */
  language: string | null;

  /** Pattern matches found */
  patterns: WorkerPatternMatch[];

  /** Violations found */
  violations: WorkerViolation[];

  /** Number of detectors that ran */
  detectorsRan: number;

  /** Number of detectors skipped */
  detectorsSkipped: number;

  /** Processing duration in milliseconds */
  duration: number;

  /** Error message if processing failed */
  error?: string | undefined;
}

// ============================================================================
// Constants
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
// Worker State (cached per worker thread)
// ============================================================================

let cachedDetectors: BaseDetector[] | null = null;
let detectorsLoading: Promise<BaseDetector[]> | null = null;

/**
 * Load detectors (cached per worker)
 */
async function loadDetectors(): Promise<BaseDetector[]> {
  if (cachedDetectors) {
    return cachedDetectors;
  }

  if (detectorsLoading) {
    return detectorsLoading;
  }

  detectorsLoading = createAllDetectorsArray().then(detectors => {
    cachedDetectors = detectors;
    return detectors;
  });

  return detectorsLoading;
}

// ============================================================================
// Helper Functions
// ============================================================================

function getLanguage(filePath: string): Language | null {
  const ext = path.extname(filePath).slice(1).toLowerCase();
  return EXTENSION_TO_LANGUAGE[ext] || null;
}

function isDetectorApplicable(detector: BaseDetector, language: Language | null): boolean {
  if (!language) {return false;}
  const info = detector.getInfo();
  return info.supportedLanguages.includes(language);
}

function filterDetectors(
  detectors: BaseDetector[],
  task: DetectorWorkerTask
): BaseDetector[] {
  let filtered = detectors;

  // Filter by specific IDs
  if (task.detectorIds && task.detectorIds.length > 0) {
    const ids = new Set(task.detectorIds);
    filtered = filtered.filter(d => ids.has(d.id));
  }

  // Filter by categories
  if (task.categories && task.categories.length > 0) {
    const categories = new Set(task.categories);
    filtered = filtered.filter(d => {
      const info = d.getInfo();
      return categories.has(info.category);
    });
  }

  // Filter to critical only
  if (task.criticalOnly) {
    filtered = filtered.filter(d => CRITICAL_DETECTOR_IDS.has(d.id));
  }

  return filtered;
}

// ============================================================================
// Main Worker Function
// ============================================================================

/**
 * Handle warmup task - preload detectors without processing files
 */
async function handleWarmup(task: WarmupTask): Promise<WarmupResult> {
  const startTime = Date.now();
  
  // Force load detectors
  const detectors = await loadDetectors();
  
  // Apply filters to cache the filtered set too
  let count = detectors.length;
  if (task.categories && task.categories.length > 0) {
    const categories = new Set(task.categories);
    count = detectors.filter(d => categories.has(d.getInfo().category)).length;
  }
  if (task.criticalOnly) {
    count = detectors.filter(d => CRITICAL_DETECTOR_IDS.has(d.id)).length;
  }
  
  return {
    type: 'warmup',
    detectorsLoaded: count,
    duration: Date.now() - startTime,
  };
}

/**
 * Process a single file with detectors
 *
 * This is the main export that Piscina will call for each task.
 */
export default async function processFile(task: DetectorWorkerTask | WarmupTask): Promise<DetectorWorkerResult | WarmupResult> {
  // Handle warmup task
  if ('type' in task && task.type === 'warmup') {
    return handleWarmup(task);
  }
  
  // Regular file processing
  const scanTask = task;
  const startTime = Date.now();
  const language = getLanguage(scanTask.file);

  // Skip files we can't detect language for
  if (!language) {
    return {
      file: scanTask.file,
      language: null,
      patterns: [],
      violations: [],
      detectorsRan: 0,
      detectorsSkipped: 0,
      duration: Date.now() - startTime,
    };
  }

  try {
    // Load detectors (cached)
    const allDetectors = await loadDetectors();
    const detectors = filterDetectors(allDetectors, scanTask);

    // Read file content
    const filePath = path.join(scanTask.rootDir, scanTask.file);
    const content = await fs.readFile(filePath, 'utf-8');

    // Create detection context
    const context: DetectionContext = {
      file: scanTask.file,
      content,
      language,
      ast: null,
      imports: [],
      exports: [],
      extension: path.extname(scanTask.file),
      isTestFile: /\.(test|spec)\.[jt]sx?$/.test(scanTask.file) || scanTask.file.includes('__tests__'),
      isTypeDefinition: scanTask.file.endsWith('.d.ts'),
      projectContext: {
        rootDir: scanTask.rootDir,
        files: scanTask.projectFiles,
        config: scanTask.projectConfig,
      },
    };

    const patterns: WorkerPatternMatch[] = [];
    const violations: WorkerViolation[] = [];
    let detectorsRan = 0;
    let detectorsSkipped = 0;

    // Run applicable detectors
    for (const detector of detectors) {
      if (!isDetectorApplicable(detector, language)) {
        detectorsSkipped++;
        continue;
      }

      detectorsRan++;

      try {
        const result = await detector.detect(context);
        const info = detector.getInfo();

        // Process patterns - PRESERVE ALL METADATA
        for (const match of result.patterns) {
          const extendedMatch = match as PatternMatch & {
            outlierReason?: string;
            matchedText?: string;
            metadata?: Record<string, unknown>;
          };
          
          // Build location object, only including defined values
          const location: WorkerPatternMatch['location'] = {
            file: match.location.file,
            line: match.location.line,
            column: match.location.column,
          };
          if (match.location.endLine !== undefined) {location.endLine = match.location.endLine;}
          if (match.location.endColumn !== undefined) {location.endColumn = match.location.endColumn;}
          
          // Build pattern match, only including defined values
          const patternMatch: WorkerPatternMatch = {
            patternId: match.patternId,
            detectorId: detector.id,
            detectorName: info.name,
            detectorDescription: info.description,
            category: info.category,
            subcategory: info.subcategory,
            confidence: match.confidence,
            location,
            isOutlier: match.isOutlier,
          };
          if (extendedMatch.outlierReason !== undefined) {patternMatch.outlierReason = extendedMatch.outlierReason;}
          if (extendedMatch.matchedText !== undefined) {patternMatch.matchedText = extendedMatch.matchedText;}
          const metadata = extendedMatch.metadata ?? result.metadata?.custom;
          if (metadata !== undefined) {patternMatch.metadata = metadata;}
          
          patterns.push(patternMatch);
        }

        // Process violations
        let violationsToProcess = result.violations;

        // Check for violations in custom metadata
        if (violationsToProcess.length === 0 && result.metadata?.custom) {
          const customData = result.metadata.custom;
          const customViolations = customData['violations'] as Array<{
            type?: string;
            file: string;
            line: number;
            column: number;
            endLine?: number;
            endColumn?: number;
            value?: string;
            issue?: string;
            message?: string;
            suggestedFix?: string;
            severity?: string;
          }> | undefined;

          if (customViolations && Array.isArray(customViolations)) {
            violationsToProcess = customViolations.map(cv => {
              const v: typeof result.violations[0] = {
                id: `${detector.id}-${cv.file}-${cv.line}-${cv.column}`,
                patternId: detector.id,
                severity: (cv.severity as 'error' | 'warning' | 'info' | 'hint') || 'warning',
                file: cv.file,
                range: {
                  start: { line: cv.line - 1, character: cv.column - 1 },
                  end: { line: (cv.endLine || cv.line) - 1, character: (cv.endColumn || cv.column) - 1 },
                },
                message: cv.issue || cv.message || cv.type || 'Pattern violation detected',
                expected: cv.suggestedFix || 'Follow established patterns',
                actual: cv.value || 'Non-conforming code',
                aiExplainAvailable: true,
                aiFixAvailable: !!cv.suggestedFix,
                firstSeen: new Date(),
                occurrences: 1,
              };
              if (cv.type) {
                v.explanation = `Violation type: ${cv.type}`;
              }
              return v;
            });
          }
        }

        for (const violation of violationsToProcess) {
          const wv: WorkerViolation = {
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
            wv.explanation = violation.explanation;
          }
          violations.push(wv);
        }
      } catch (detectorError) {
        // Log but don't fail the whole file
        // Errors will be aggregated in the main thread
      }
    }

    return {
      file: scanTask.file,
      language,
      patterns,
      violations,
      detectorsRan,
      detectorsSkipped,
      duration: Date.now() - startTime,
    };
  } catch (error) {
    return {
      file: scanTask.file,
      language,
      patterns: [],
      violations: [],
      detectorsRan: 0,
      detectorsSkipped: 0,
      duration: Date.now() - startTime,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
