/**
 * Base Constant Extractor
 *
 * Abstract base class for hybrid constant extractors that combine
 * tree-sitter (primary) with regex fallback for enterprise-grade coverage.
 *
 * Follows the same pattern as call-graph/extractors/hybrid-extractor-base.ts
 */

import {
  DEFAULT_CONSTANT_HYBRID_CONFIG,
  CONSTANT_EXTRACTION_CONFIDENCE,
} from '../types.js';

import type {
  ConstantLanguage,
  FileConstantResult,
  ConstantExtraction,
  EnumExtraction,
  ConstantReference,
  ConstantExtractionQuality,
  ConstantHybridConfig,
} from '../types.js';
import type { BaseConstantRegexExtractor } from './regex/base-regex.js';

/**
 * Abstract base class for hybrid constant extractors
 */
export abstract class BaseConstantExtractor {
  /** Language this extractor handles */
  abstract readonly language: ConstantLanguage;

  /** File extensions this extractor handles */
  abstract readonly extensions: string[];

  /** Configuration */
  protected config: Required<ConstantHybridConfig>;

  /** Regex fallback extractor */
  protected abstract regexExtractor: BaseConstantRegexExtractor;

  constructor(config?: ConstantHybridConfig) {
    this.config = { ...DEFAULT_CONSTANT_HYBRID_CONFIG, ...config };
  }

  /**
   * Check if this extractor can handle a file
   */
  canHandle(filePath: string): boolean {
    const ext = this.getExtension(filePath);
    return this.extensions.includes(ext);
  }

  /**
   * Extract constants with hybrid approach: tree-sitter first, regex fallback
   */
  extract(source: string, filePath: string): FileConstantResult {
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
  ): FileConstantResult | null;

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
    treeSitterResult: FileConstantResult | null,
    startTime: number
  ): FileConstantResult {
    // Get regex results
    const regexResult = this.regexExtractor.extract(source, filePath);

    if (!treeSitterResult) {
      // No tree-sitter result - use regex only
      regexResult.quality.extractionTimeMs = performance.now() - startTime;
      return regexResult;
    }

    // Merge results
    const merged = this.mergeResults(treeSitterResult, regexResult);

    // Create merged quality
    const quality = this.createMergedQuality(treeSitterResult, regexResult, startTime);

    return { ...merged, quality };
  }

  /**
   * Extract using regex only
   */
  private extractWithRegexOnly(
    source: string,
    filePath: string,
    startTime: number,
    treeSitterError?: unknown
  ): FileConstantResult {
    const result = this.regexExtractor.extract(source, filePath);

    // Add tree-sitter error to warnings if present
    if (treeSitterError) {
      const errorMsg =
        treeSitterError instanceof Error
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
    primary: FileConstantResult,
    fallback: FileConstantResult
  ): FileConstantResult {
    return {
      file: primary.file,
      language: primary.language,
      constants: this.mergeUniqueConstants(primary.constants, fallback.constants),
      enums: this.mergeUniqueEnums(primary.enums, fallback.enums),
      references: this.mergeUniqueReferences(primary.references, fallback.references),
      errors: [...primary.errors],
      quality: primary.quality, // Will be replaced by caller
    };
  }

  /**
   * Merge constants, avoiding duplicates
   */
  private mergeUniqueConstants(
    primary: ConstantExtraction[],
    fallback: ConstantExtraction[]
  ): ConstantExtraction[] {
    const seen = new Set(primary.map((c) => `${c.name}:${c.line}`));
    const result = [...primary];

    for (const constant of fallback) {
      const key = `${constant.name}:${constant.line}`;
      if (!seen.has(key)) {
        seen.add(key);
        result.push(constant);
      }
    }

    return result;
  }

  /**
   * Merge enums, avoiding duplicates
   */
  private mergeUniqueEnums(
    primary: EnumExtraction[],
    fallback: EnumExtraction[]
  ): EnumExtraction[] {
    const seen = new Set(primary.map((e) => `${e.name}:${e.line}`));
    const result = [...primary];

    for (const enumDef of fallback) {
      const key = `${enumDef.name}:${enumDef.line}`;
      if (!seen.has(key)) {
        seen.add(key);
        result.push(enumDef);
      }
    }

    return result;
  }

  /**
   * Merge references, avoiding duplicates
   */
  private mergeUniqueReferences(
    primary: ConstantReference[],
    fallback: ConstantReference[]
  ): ConstantReference[] {
    const seen = new Set(primary.map((r) => `${r.constantId}:${r.line}:${r.column}`));
    const result = [...primary];

    for (const ref of fallback) {
      const key = `${ref.constantId}:${ref.line}:${ref.column}`;
      if (!seen.has(key)) {
        seen.add(key);
        result.push(ref);
      }
    }

    return result;
  }

  /**
   * Check if extraction result has good coverage
   */
  private hasGoodCoverage(result: FileConstantResult): boolean {
    // Consider it good if we found at least some constants or enums
    // or if there were no errors (file might just have no constants)
    return (
      result.constants.length > 0 ||
      result.enums.length > 0 ||
      result.errors.length === 0
    );
  }

  /**
   * Create quality metrics for tree-sitter extraction
   */
  private createTreeSitterQuality(
    result: FileConstantResult,
    startTime: number
  ): ConstantExtractionQuality {
    return {
      method: 'tree-sitter',
      confidence:
        result.errors.length === 0
          ? CONSTANT_EXTRACTION_CONFIDENCE.TREE_SITTER
          : CONSTANT_EXTRACTION_CONFIDENCE.REGEX,
      coveragePercent: result.errors.length === 0 ? 95 : 70,
      itemsExtracted: result.constants.length + result.enums.length,
      parseErrors: result.errors.length,
      warnings: [],
      usedFallback: false,
      extractionTimeMs: performance.now() - startTime,
    };
  }

  /**
   * Create merged quality metrics
   */
  private createMergedQuality(
    treeSitterResult: FileConstantResult,
    regexResult: FileConstantResult,
    startTime: number
  ): ConstantExtractionQuality {
    const treeSitterItems = treeSitterResult.constants.length + treeSitterResult.enums.length;
    const regexItems = regexResult.constants.length + regexResult.enums.length;
    const totalItems = Math.max(treeSitterItems, regexItems);

    return {
      method: 'hybrid',
      confidence: CONSTANT_EXTRACTION_CONFIDENCE.HYBRID,
      coveragePercent: 90,
      itemsExtracted: totalItems,
      parseErrors: treeSitterResult.errors.length,
      warnings: [
        ...regexResult.quality.warnings,
        `Merged ${treeSitterItems} tree-sitter + ${regexItems} regex items`,
      ],
      usedFallback: true,
      extractionTimeMs: performance.now() - startTime,
    };
  }

  /**
   * Create error result
   */
  private createErrorResult(
    filePath: string,
    error: unknown,
    startTime: number
  ): FileConstantResult {
    const errorMsg = error instanceof Error ? error.message : 'Unknown extraction error';

    return {
      file: filePath,
      language: this.language,
      constants: [],
      enums: [],
      references: [],
      errors: [errorMsg],
      quality: {
        method: 'tree-sitter',
        confidence: CONSTANT_EXTRACTION_CONFIDENCE.UNKNOWN,
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
  private createEmptyResult(filePath: string, startTime: number): FileConstantResult {
    return {
      file: filePath,
      language: this.language,
      constants: [],
      enums: [],
      references: [],
      errors: ['No extraction method available'],
      quality: {
        method: 'tree-sitter',
        confidence: 0,
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

  /**
   * Generate constant ID
   */
  protected generateConstantId(file: string, name: string, line: number): string {
    return `${file}:${name}:${line}`;
  }

  /**
   * Create default quality metrics
   */
  protected createDefaultQuality(): ConstantExtractionQuality {
    return {
      method: 'tree-sitter',
      confidence: CONSTANT_EXTRACTION_CONFIDENCE.TREE_SITTER,
      coveragePercent: 0,
      itemsExtracted: 0,
      parseErrors: 0,
      warnings: [],
      usedFallback: false,
      extractionTimeMs: 0,
    };
  }
}
