/**
 * Hybrid Extractor Base
 *
 * Base class for extractors that combine tree-sitter (primary) with
 * regex fallback for enterprise-grade extraction coverage.
 *
 * Pattern: Try tree-sitter first, fall back to regex on failure,
 * merge results with confidence tracking.
 */

import {
  type ExtractionQuality,
  type HybridExtractorConfig,
  DEFAULT_HYBRID_CONFIG,
  EXTRACTION_CONFIDENCE,
  createDefaultQuality,
  mergeQualities,
} from './types.js';

import type {
  CallGraphLanguage,
  FileExtractionResult,
  FunctionExtraction,
  CallExtraction,
  ImportExtraction,
  ExportExtraction,
  ClassExtraction,
} from '../types.js';
import type { BaseRegexExtractor } from './regex/base-regex-extractor.js';

/**
 * Extended file extraction result with quality metrics
 */
export interface HybridExtractionResult extends FileExtractionResult {
  /** Extraction quality metrics */
  quality: ExtractionQuality;
}

/**
 * Abstract base class for hybrid extractors
 */
export abstract class HybridExtractorBase {
  /** Language this extractor handles */
  abstract readonly language: CallGraphLanguage;

  /** File extensions this extractor handles */
  abstract readonly extensions: string[];

  /** Configuration */
  protected config: Required<HybridExtractorConfig>;

  /** Regex fallback extractor */
  protected abstract regexExtractor: BaseRegexExtractor;

  constructor(config?: HybridExtractorConfig) {
    this.config = { ...DEFAULT_HYBRID_CONFIG, ...config };
  }

  /**
   * Check if this extractor can handle a file
   */
  canHandle(filePath: string): boolean {
    const ext = this.getExtension(filePath);
    return this.extensions.includes(ext);
  }

  /**
   * Extract with hybrid approach: tree-sitter first, regex fallback
   */
  extract(source: string, filePath: string): HybridExtractionResult {
    const startTime = performance.now();

    // Try tree-sitter first if enabled
    if (this.config.enableTreeSitter) {
      try {
        const treeSitterResult = this.extractWithTreeSitter(source, filePath);
        
        // If tree-sitter succeeded with good results, return them
        if (treeSitterResult?.errors.length === 0) {
          const quality = this.createTreeSitterQuality(treeSitterResult, startTime);
          
          // Check if we got meaningful results
          if (this.hasGoodCoverage(treeSitterResult)) {
            return { ...treeSitterResult, quality };
          }
        }
        
        // Tree-sitter had errors or poor coverage - try regex fallback
        if (this.config.enableRegexFallback) {
          return this.extractWithFallback(source, filePath, treeSitterResult, startTime);
        }
        
        // No fallback enabled, return tree-sitter result as-is
        if (treeSitterResult) {
          const quality = this.createTreeSitterQuality(treeSitterResult, startTime);
          return { ...treeSitterResult, quality };
        }
      } catch (error) {
        // Tree-sitter failed completely - use regex fallback
        if (this.config.enableRegexFallback) {
          return this.extractWithRegexOnly(source, filePath, startTime, error);
        }
        
        // No fallback, return error result
        return this.createErrorResult(filePath, error, startTime);
      }
    }

    // Tree-sitter disabled - use regex only
    if (this.config.enableRegexFallback) {
      return this.extractWithRegexOnly(source, filePath, startTime);
    }

    // Nothing enabled - return empty result
    return this.createEmptyResult(filePath, startTime);
  }

  /**
   * Extract using tree-sitter (implemented by subclass)
   */
  protected abstract extractWithTreeSitter(
    source: string,
    filePath: string
  ): FileExtractionResult | null;

  /**
   * Check if tree-sitter is available for this language
   */
  protected abstract isTreeSitterAvailable(): boolean;

  /**
   * Extract with regex fallback, merging with tree-sitter results
   */
  private extractWithFallback(
    source: string,
    filePath: string,
    treeSitterResult: FileExtractionResult | null,
    startTime: number
  ): HybridExtractionResult {
    // Get regex results
    const regexResult = this.regexExtractor.extract(source, filePath);

    if (!treeSitterResult) {
      // No tree-sitter result - use regex only
      return regexResult;
    }

    // Merge results
    const merged = this.mergeResults(treeSitterResult, regexResult);
    
    // Create merged quality
    const treeSitterQuality = this.createTreeSitterQuality(treeSitterResult, startTime);
    const mergedQuality = mergeQualities(treeSitterQuality, regexResult.quality);
    mergedQuality.extractionTimeMs = performance.now() - startTime;

    return { ...merged, quality: mergedQuality };
  }

  /**
   * Extract using regex only
   */
  private extractWithRegexOnly(
    source: string,
    filePath: string,
    startTime: number,
    treeSitterError?: unknown
  ): HybridExtractionResult {
    const result = this.regexExtractor.extract(source, filePath);
    
    // Add tree-sitter error to warnings if present
    if (treeSitterError) {
      const errorMsg = treeSitterError instanceof Error 
        ? treeSitterError.message 
        : 'Tree-sitter unavailable';
      result.quality.warnings.push(`Tree-sitter fallback: ${errorMsg}`);
    }
    
    result.quality.usedFallback = true;
    result.quality.extractionTimeMs = performance.now() - startTime;
    
    return result;
  }

  /**
   * Merge tree-sitter and regex results
   */
  private mergeResults(
    primary: FileExtractionResult,
    fallback: FileExtractionResult & { quality: ExtractionQuality }
  ): FileExtractionResult {
    // Start with primary results
    const merged: FileExtractionResult = {
      file: primary.file,
      language: primary.language,
      functions: [...primary.functions],
      calls: [...primary.calls],
      imports: [...primary.imports],
      exports: [...primary.exports],
      classes: [...primary.classes],
      errors: [...primary.errors],
    };

    // Add unique items from fallback
    merged.functions = this.mergeUniqueFunctions(merged.functions, fallback.functions);
    merged.calls = this.mergeUniqueCalls(merged.calls, fallback.calls);
    merged.imports = this.mergeUniqueImports(merged.imports, fallback.imports);
    merged.exports = this.mergeUniqueExports(merged.exports, fallback.exports);
    merged.classes = this.mergeUniqueClasses(merged.classes, fallback.classes);

    return merged;
  }

  /**
   * Merge functions, avoiding duplicates
   */
  private mergeUniqueFunctions(
    primary: FunctionExtraction[],
    fallback: FunctionExtraction[]
  ): FunctionExtraction[] {
    const seen = new Set(primary.map(f => `${f.name}:${f.startLine}`));
    const result = [...primary];

    for (const func of fallback) {
      const key = `${func.name}:${func.startLine}`;
      if (!seen.has(key)) {
        seen.add(key);
        result.push(func);
      }
    }

    return result;
  }

  /**
   * Merge calls, avoiding duplicates
   */
  private mergeUniqueCalls(
    primary: CallExtraction[],
    fallback: CallExtraction[]
  ): CallExtraction[] {
    const seen = new Set(primary.map(c => `${c.calleeName}:${c.line}`));
    const result = [...primary];

    for (const call of fallback) {
      const key = `${call.calleeName}:${call.line}`;
      if (!seen.has(key)) {
        seen.add(key);
        result.push(call);
      }
    }

    return result;
  }

  /**
   * Merge imports, avoiding duplicates
   */
  private mergeUniqueImports(
    primary: ImportExtraction[],
    fallback: ImportExtraction[]
  ): ImportExtraction[] {
    const seen = new Set(primary.map(i => `${i.source}:${i.line}`));
    const result = [...primary];

    for (const imp of fallback) {
      const key = `${imp.source}:${imp.line}`;
      if (!seen.has(key)) {
        seen.add(key);
        result.push(imp);
      }
    }

    return result;
  }

  /**
   * Merge exports, avoiding duplicates
   */
  private mergeUniqueExports(
    primary: ExportExtraction[],
    fallback: ExportExtraction[]
  ): ExportExtraction[] {
    const seen = new Set(primary.map(e => `${e.name}:${e.line}`));
    const result = [...primary];

    for (const exp of fallback) {
      const key = `${exp.name}:${exp.line}`;
      if (!seen.has(key)) {
        seen.add(key);
        result.push(exp);
      }
    }

    return result;
  }

  /**
   * Merge classes, avoiding duplicates
   */
  private mergeUniqueClasses(
    primary: ClassExtraction[],
    fallback: ClassExtraction[]
  ): ClassExtraction[] {
    const seen = new Set(primary.map(c => `${c.name}:${c.startLine}`));
    const result = [...primary];

    for (const cls of fallback) {
      const key = `${cls.name}:${cls.startLine}`;
      if (!seen.has(key)) {
        seen.add(key);
        result.push(cls);
      }
    }

    return result;
  }

  /**
   * Check if extraction result has good coverage
   */
  private hasGoodCoverage(result: FileExtractionResult): boolean {
    // Consider it good if we found at least some functions or classes
    return result.functions.length > 0 || result.classes.length > 0;
  }

  /**
   * Create quality metrics for tree-sitter extraction
   */
  private createTreeSitterQuality(
    result: FileExtractionResult,
    startTime: number
  ): ExtractionQuality {
    const quality = createDefaultQuality();
    quality.method = 'tree-sitter';
    quality.confidence = result.errors.length === 0 
      ? EXTRACTION_CONFIDENCE.TREE_SITTER 
      : EXTRACTION_CONFIDENCE.REGEX;
    quality.itemsExtracted = 
      result.functions.length +
      result.classes.length +
      result.imports.length +
      result.exports.length +
      result.calls.length;
    quality.parseErrors = result.errors.length;
    quality.coveragePercent = result.errors.length === 0 ? 95 : 70;
    quality.extractionTimeMs = performance.now() - startTime;
    quality.usedFallback = false;
    
    return quality;
  }

  /**
   * Create error result
   */
  private createErrorResult(
    filePath: string,
    error: unknown,
    startTime: number
  ): HybridExtractionResult {
    const errorMsg = error instanceof Error ? error.message : 'Unknown extraction error';
    
    return {
      file: filePath,
      language: this.language,
      functions: [],
      calls: [],
      imports: [],
      exports: [],
      classes: [],
      errors: [errorMsg],
      quality: {
        confidence: EXTRACTION_CONFIDENCE.UNKNOWN,
        method: 'tree-sitter',
        coveragePercent: 0,
        itemsExtracted: 0,
        parseErrors: 1,
        warnings: [],
        usedFallback: false,
        extractionTimeMs: performance.now() - startTime,
      },
    };
  }

  /**
   * Create empty result
   */
  private createEmptyResult(filePath: string, startTime: number): HybridExtractionResult {
    return {
      file: filePath,
      language: this.language,
      functions: [],
      calls: [],
      imports: [],
      exports: [],
      classes: [],
      errors: ['No extraction method available'],
      quality: {
        confidence: 0,
        method: 'tree-sitter',
        coveragePercent: 0,
        itemsExtracted: 0,
        parseErrors: 0,
        warnings: ['No extraction method enabled'],
        usedFallback: false,
        extractionTimeMs: performance.now() - startTime,
      },
    };
  }

  /**
   * Get file extension
   */
  protected getExtension(filePath: string): string {
    const lastDot = filePath.lastIndexOf('.');
    return lastDot >= 0 ? filePath.slice(lastDot) : '';
  }
}
