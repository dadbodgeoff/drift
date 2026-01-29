/**
 * Scanner Adapter
 *
 * Integrates constant extraction into the main scanning pipeline.
 * Provides parallel extraction support and incremental updates.
 */

import { createHash } from 'crypto';

import { CSharpConstantRegexExtractor } from '../extractors/regex/csharp-regex.js';
import { GoConstantRegexExtractor } from '../extractors/regex/go-regex.js';
import { JavaConstantRegexExtractor } from '../extractors/regex/java-regex.js';
import { PhpConstantRegexExtractor } from '../extractors/regex/php-regex.js';
import { PythonConstantRegexExtractor } from '../extractors/regex/python-regex.js';
import { TypeScriptConstantRegexExtractor } from '../extractors/regex/typescript-regex.js';
import { ConstantStore } from '../store/constant-store.js';

import type { BaseConstantRegexExtractor } from '../extractors/regex/base-regex.js';
import type {
  ConstantLanguage,
  FileConstantResult,
  ConstantExtractionQuality,
  ConstantHybridConfig,
} from '../types.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Scanner adapter configuration
 */
export interface ConstantScannerConfig {
  /** Root directory */
  rootDir: string;

  /** Enable constant extraction */
  enabled?: boolean;

  /** Enable incremental scanning */
  incremental?: boolean;

  /** Hybrid extractor config */
  hybridConfig?: ConstantHybridConfig;

  /** Verbose logging */
  verbose?: boolean;
}

/**
 * Scan result for a single file
 */
export interface ConstantScanResult {
  /** File path */
  file: string;

  /** Extraction result */
  result: FileConstantResult | null;

  /** Whether file was skipped (cached) */
  skipped: boolean;

  /** Error if extraction failed */
  error?: string;

  /** Duration in ms */
  duration: number;
}

/**
 * Batch scan result
 */
export interface ConstantBatchScanResult {
  /** Individual file results */
  files: ConstantScanResult[];

  /** Total constants extracted */
  totalConstants: number;

  /** Total enums extracted */
  totalEnums: number;

  /** Files processed */
  filesProcessed: number;

  /** Files skipped (cached) */
  filesSkipped: number;

  /** Files with errors */
  filesWithErrors: number;

  /** Total duration in ms */
  duration: number;
}

// ============================================================================
// Language Detection
// ============================================================================

const EXTENSION_TO_LANGUAGE: Record<string, ConstantLanguage> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.py': 'python',
  '.pyw': 'python',
  '.java': 'java',
  '.cs': 'csharp',
  '.php': 'php',
  '.go': 'go',
};

/**
 * Get language from file path
 */
export function getConstantLanguage(filePath: string): ConstantLanguage | null {
  const ext = getExtension(filePath);
  return EXTENSION_TO_LANGUAGE[ext] ?? null;
}

/**
 * Get file extension
 */
function getExtension(filePath: string): string {
  const lastDot = filePath.lastIndexOf('.');
  return lastDot >= 0 ? filePath.slice(lastDot).toLowerCase() : '';
}

/**
 * Hash content for change detection
 */
export function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

// ============================================================================
// Scanner Adapter
// ============================================================================

/**
 * Adapter for integrating constant extraction into the scanner pipeline
 */
export class ConstantScannerAdapter {
  private readonly config: Required<ConstantScannerConfig>;
  private readonly store: ConstantStore;
  private readonly extractors: Map<ConstantLanguage, BaseConstantRegexExtractor>;
  private initialized = false;

  constructor(config: ConstantScannerConfig) {
    this.config = {
      rootDir: config.rootDir,
      enabled: config.enabled ?? true,
      incremental: config.incremental ?? true,
      hybridConfig: config.hybridConfig ?? {},
      verbose: config.verbose ?? false,
    };

    this.store = new ConstantStore({ rootDir: config.rootDir });
    this.extractors = new Map();
  }

  /**
   * Initialize the adapter
   */
  async initialize(): Promise<void> {
    if (this.initialized) {return;}

    await this.store.initialize();

    // Create extractors for each language
    this.extractors.set('typescript', new TypeScriptConstantRegexExtractor());
    this.extractors.set('javascript', new TypeScriptConstantRegexExtractor()); // Same extractor
    this.extractors.set('python', new PythonConstantRegexExtractor());
    this.extractors.set('java', new JavaConstantRegexExtractor());
    this.extractors.set('csharp', new CSharpConstantRegexExtractor());
    this.extractors.set('php', new PhpConstantRegexExtractor());
    this.extractors.set('go', new GoConstantRegexExtractor());

    this.initialized = true;
  }

  /**
   * Check if constant extraction is enabled
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Get the constant store
   */
  getStore(): ConstantStore {
    return this.store;
  }

  /**
   * Extract constants from a single file
   */
  async extractFile(
    filePath: string,
    content: string
  ): Promise<ConstantScanResult> {
    const startTime = performance.now();

    if (!this.config.enabled) {
      return {
        file: filePath,
        result: null,
        skipped: true,
        duration: performance.now() - startTime,
      };
    }

    const language = getConstantLanguage(filePath);
    if (!language) {
      return {
        file: filePath,
        result: null,
        skipped: true,
        duration: performance.now() - startTime,
      };
    }

    // Check if we can skip (incremental mode)
    const contentHash = hashContent(content);
    if (this.config.incremental) {
      const needsExtraction = await this.store.needsExtraction(filePath, contentHash);
      if (!needsExtraction) {
        return {
          file: filePath,
          result: null,
          skipped: true,
          duration: performance.now() - startTime,
        };
      }
    }

    try {
      const extractor = this.extractors.get(language);
      if (!extractor) {
        return {
          file: filePath,
          result: null,
          skipped: true,
          error: `No extractor for language: ${language}`,
          duration: performance.now() - startTime,
        };
      }

      // Extract constants
      const result = extractor.extract(content, filePath);

      // Save to store
      await this.store.saveFileResult(result, contentHash);

      return {
        file: filePath,
        result,
        skipped: false,
        duration: performance.now() - startTime,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return {
        file: filePath,
        result: null,
        skipped: false,
        error: errorMsg,
        duration: performance.now() - startTime,
      };
    }
  }

  /**
   * Extract constants from multiple files
   */
  async extractFiles(
    files: Array<{ path: string; content: string }>
  ): Promise<ConstantBatchScanResult> {
    const startTime = performance.now();
    const results: ConstantScanResult[] = [];

    let totalConstants = 0;
    let totalEnums = 0;
    let filesProcessed = 0;
    let filesSkipped = 0;
    let filesWithErrors = 0;

    for (const file of files) {
      const result = await this.extractFile(file.path, file.content);
      results.push(result);

      if (result.skipped) {
        filesSkipped++;
      } else if (result.error) {
        filesWithErrors++;
      } else if (result.result) {
        filesProcessed++;
        totalConstants += result.result.constants.length;
        totalEnums += result.result.enums.length;
      }
    }

    return {
      files: results,
      totalConstants,
      totalEnums,
      filesProcessed,
      filesSkipped,
      filesWithErrors,
      duration: performance.now() - startTime,
    };
  }

  /**
   * Handle file deletion
   */
  async handleFileDeleted(filePath: string): Promise<void> {
    await this.store.deleteFileResult(filePath);
  }

  /**
   * Rebuild the index
   */
  async rebuildIndex(): Promise<void> {
    await this.store.rebuildIndex();
  }

  /**
   * Clear all constant data
   */
  async clear(): Promise<void> {
    await this.store.clear();
  }
}

// ============================================================================
// Worker Task Types (for parallel processing)
// ============================================================================

/**
 * Task for constant extraction worker
 */
export interface ConstantWorkerTask {
  /** Task type */
  type: 'extract' | 'warmup';

  /** File path */
  file?: string;

  /** File content */
  content?: string;

  /** Root directory */
  rootDir?: string;
}

/**
 * Result from constant extraction worker
 */
export interface ConstantWorkerResult {
  /** File path */
  file: string;

  /** Language detected */
  language: ConstantLanguage | null;

  /** Extraction result */
  result: FileConstantResult | null;

  /** Content hash */
  contentHash: string;

  /** Error if failed */
  error?: string;

  /** Duration in ms */
  duration: number;
}

/**
 * Process a constant extraction task (for worker threads)
 */
export function processConstantTask(task: ConstantWorkerTask): ConstantWorkerResult {
  const startTime = performance.now();

  if (task.type === 'warmup') {
    return {
      file: '',
      language: null,
      result: null,
      contentHash: '',
      duration: performance.now() - startTime,
    };
  }

  if (!task.file || !task.content) {
    return {
      file: task.file ?? '',
      language: null,
      result: null,
      contentHash: '',
      error: 'Missing file or content',
      duration: performance.now() - startTime,
    };
  }

  const language = getConstantLanguage(task.file);
  if (!language) {
    return {
      file: task.file,
      language: null,
      result: null,
      contentHash: hashContent(task.content),
      duration: performance.now() - startTime,
    };
  }

  try {
    // Create extractor based on language
    let extractor: BaseConstantRegexExtractor;
    switch (language) {
      case 'typescript':
      case 'javascript':
        extractor = new TypeScriptConstantRegexExtractor();
        break;
      case 'python':
        extractor = new PythonConstantRegexExtractor();
        break;
      case 'java':
        extractor = new JavaConstantRegexExtractor();
        break;
      case 'csharp':
        extractor = new CSharpConstantRegexExtractor();
        break;
      case 'php':
        extractor = new PhpConstantRegexExtractor();
        break;
      case 'go':
        extractor = new GoConstantRegexExtractor();
        break;
      default:
        return {
          file: task.file,
          language,
          result: null,
          contentHash: hashContent(task.content),
          error: `Unsupported language: ${language}`,
          duration: performance.now() - startTime,
        };
    }

    const result = extractor.extract(task.content, task.file);

    return {
      file: task.file,
      language,
      result,
      contentHash: hashContent(task.content),
      duration: performance.now() - startTime,
    };
  } catch (error) {
    return {
      file: task.file,
      language,
      result: null,
      contentHash: hashContent(task.content),
      error: error instanceof Error ? error.message : String(error),
      duration: performance.now() - startTime,
    };
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a constant scanner adapter
 */
export function createConstantScanner(config: ConstantScannerConfig): ConstantScannerAdapter {
  return new ConstantScannerAdapter(config);
}

/**
 * Create default extraction quality
 */
export function createDefaultConstantQuality(): ConstantExtractionQuality {
  return {
    method: 'regex',
    confidence: 0.75,
    coveragePercent: 80,
    itemsExtracted: 0,
    parseErrors: 0,
    warnings: [],
    usedFallback: false,
    extractionTimeMs: 0,
  };
}
