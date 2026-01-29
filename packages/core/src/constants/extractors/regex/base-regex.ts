/**
 * Base Constant Regex Extractor
 *
 * Abstract base class for regex-based constant extraction.
 * Used as fallback when tree-sitter is unavailable.
 */

import { inferCategory } from '../../analysis/categorizer.js';
import { CONSTANT_EXTRACTION_CONFIDENCE } from '../../types.js';

import type {
  ConstantLanguage,
  FileConstantResult,
  ConstantExtraction,
  EnumExtraction,
  ConstantExtractionQuality,
  ConstantKind,
} from '../../types.js';

/**
 * Abstract base class for regex-based constant extractors
 */
export abstract class BaseConstantRegexExtractor {
  /** Language this extractor handles */
  abstract readonly language: ConstantLanguage;

  /**
   * Extract constants using regex patterns
   */
  extract(source: string, filePath: string): FileConstantResult {
    const startTime = performance.now();
    const constants: ConstantExtraction[] = [];
    const enums: EnumExtraction[] = [];
    const errors: string[] = [];

    try {
      // Extract constants
      const extractedConstants = this.extractConstants(source, filePath);
      constants.push(...extractedConstants);

      // Extract enums
      const extractedEnums = this.extractEnums(source, filePath);
      enums.push(...extractedEnums);

      // Infer categories for constants
      for (const constant of constants) {
        if (constant.category === 'uncategorized') {
          constant.category = inferCategory(constant);
        }
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown regex extraction error';
      errors.push(errorMsg);
    }

    const quality = this.createQuality(constants, enums, errors, startTime);

    return {
      file: filePath,
      language: this.language,
      constants,
      enums,
      references: [], // Regex doesn't track references
      errors,
      quality,
    };
  }

  /**
   * Extract constants (implemented by subclass)
   */
  protected abstract extractConstants(source: string, filePath: string): ConstantExtraction[];

  /**
   * Extract enums (implemented by subclass)
   */
  protected abstract extractEnums(source: string, filePath: string): EnumExtraction[];

  /**
   * Create quality metrics
   */
  private createQuality(
    constants: ConstantExtraction[],
    enums: EnumExtraction[],
    errors: string[],
    startTime: number
  ): ConstantExtractionQuality {
    return {
      method: 'regex',
      confidence: errors.length === 0 ? CONSTANT_EXTRACTION_CONFIDENCE.REGEX : 0.5,
      coveragePercent: 75, // Regex typically catches ~75% of constants
      itemsExtracted: constants.length + enums.length,
      parseErrors: errors.length,
      warnings: [],
      usedFallback: true,
      extractionTimeMs: performance.now() - startTime,
    };
  }

  /**
   * Generate constant ID
   */
  protected generateId(file: string, name: string, line: number): string {
    return `${file}:${name}:${line}`;
  }

  /**
   * Get line number from character index
   */
  protected getLineNumber(source: string, index: number): number {
    const lines = source.slice(0, index).split('\n');
    return lines.length;
  }

  /**
   * Get column number from character index
   */
  protected getColumnNumber(source: string, index: number): number {
    const lastNewline = source.lastIndexOf('\n', index - 1);
    return index - lastNewline;
  }

  /**
   * Extract value from a string literal
   */
  protected extractStringValue(raw: string): string {
    // Remove quotes
    if ((raw.startsWith('"') && raw.endsWith('"')) ||
        (raw.startsWith("'") && raw.endsWith("'"))) {
      return raw.slice(1, -1);
    }
    // Template literals
    if (raw.startsWith('`') && raw.endsWith('`')) {
      return raw.slice(1, -1);
    }
    return raw;
  }

  /**
   * Extract value from a numeric literal
   */
  protected extractNumericValue(raw: string): number | null {
    const num = parseFloat(raw);
    return isNaN(num) ? null : num;
  }

  /**
   * Determine constant kind from value
   */
  protected inferKind(value: string): ConstantKind {
    // Check for object literal
    if (value.trim().startsWith('{')) {
      return 'object';
    }
    // Check for array literal
    if (value.trim().startsWith('[')) {
      return 'array';
    }
    // Check for string
    if (value.startsWith('"') || value.startsWith("'") || value.startsWith('`')) {
      return 'primitive';
    }
    // Check for number
    if (/^-?\d+(\.\d+)?$/.test(value.trim())) {
      return 'primitive';
    }
    // Check for boolean
    if (value === 'true' || value === 'false') {
      return 'primitive';
    }
    // Otherwise it's computed
    return 'computed';
  }

  /**
   * Check if a name looks like a constant (UPPER_CASE)
   */
  protected isConstantName(name: string): boolean {
    // All uppercase with underscores
    if (/^[A-Z][A-Z0-9_]*$/.test(name)) {
      return true;
    }
    // PascalCase constants (common in C#, Go)
    if (/^[A-Z][a-zA-Z0-9]*$/.test(name)) {
      return true;
    }
    return false;
  }

  /**
   * Extract doc comment before a line
   */
  protected extractDocComment(source: string, lineIndex: number): string | undefined {
    const lines = source.split('\n');
    if (lineIndex <= 0 || lineIndex > lines.length) {
      return undefined;
    }

    const comments: string[] = [];
    let i = lineIndex - 2; // Line before the constant (0-indexed)

    // Look for JSDoc/JavaDoc style comments
    while (i >= 0) {
      const line = lines[i]?.trim();
      if (!line && line !== '') {break;} // undefined check
      
      // End of block comment
      if (line.endsWith('*/')) {
        // Find start of block comment
        while (i >= 0) {
          const blockLine = lines[i]?.trim();
          if (!blockLine && blockLine !== '') {break;}
          comments.unshift(blockLine);
          if (blockLine.startsWith('/*') || blockLine.startsWith('/**')) {
            break;
          }
          i--;
        }
        break;
      }
      
      // Single line comment
      if (line.startsWith('//') || line.startsWith('#')) {
        comments.unshift(line);
        i--;
        continue;
      }
      
      // Empty line or non-comment - stop
      if (line !== '') {
        break;
      }
      i--;
    }

    if (comments.length === 0) {
      return undefined;
    }

    // Clean up the comment
    return comments
      .map(c => c.replace(/^\/\*\*?|\*\/$/g, '').replace(/^\s*\*\s?/g, '').replace(/^\/\/\s?/g, '').replace(/^#\s?/g, '').trim())
      .filter(c => c.length > 0)
      .join('\n');
  }

  /**
   * Truncate value for storage (max 500 chars)
   */
  protected truncateValue(value: string, maxLength: number = 500): string {
    if (value.length <= maxLength) {
      return value;
    }
    return value.slice(0, maxLength - 3) + '...';
  }
}
