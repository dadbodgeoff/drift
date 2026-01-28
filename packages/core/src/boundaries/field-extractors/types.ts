/**
 * Field Extractor Types
 * 
 * Defines the interface for framework-specific field extractors.
 * Each ORM/framework has its own extractor that knows how to parse
 * field access patterns from that framework's syntax.
 */

import type { ORMFramework } from '../types.js';

/**
 * Source of field extraction
 */
export type FieldSource = 
  | 'query'      // Extracted from query (SELECT, .select(), etc.)
  | 'model'      // Extracted from model/entity definition
  | 'filter'     // Extracted from WHERE/filter clause
  | 'insert'     // Extracted from INSERT/create operation
  | 'update'     // Extracted from UPDATE operation
  | 'inferred';  // Inferred from context/patterns

/**
 * An extracted field with metadata
 */
export interface ExtractedField {
  /** Field/column name */
  name: string;
  /** Field type if detectable (e.g., 'string', 'int', 'boolean') */
  type?: string;
  /** Extraction confidence (0-1) */
  confidence: number;
  /** How the field was extracted */
  source: FieldSource;
  /** Line number where field was found */
  line?: number;
  /** Whether this is a relationship/foreign key */
  isRelation?: boolean;
  /** Related table for foreign keys */
  relatedTable?: string;
}

/**
 * Result of field extraction from a line
 */
export interface LineExtractionResult {
  /** Extracted fields */
  fields: ExtractedField[];
  /** Table name if detected */
  table?: string;
  /** Framework that matched */
  framework?: ORMFramework;
}

/**
 * Result of field extraction from a model definition
 */
export interface ModelExtractionResult {
  /** Model/class name */
  modelName: string;
  /** Mapped table name */
  tableName?: string;
  /** All fields in the model */
  fields: ExtractedField[];
  /** Framework that matched */
  framework: ORMFramework;
  /** Start line of model definition */
  startLine: number;
  /** End line of model definition */
  endLine: number;
}


/**
 * Interface for framework-specific field extractors
 */
export interface FieldExtractor {
  /** Extractor name for debugging */
  readonly name: string;
  
  /** ORM framework this extractor handles */
  readonly framework: ORMFramework;
  
  /** Languages this extractor supports */
  readonly languages: string[];
  
  /**
   * Check if this extractor can handle the given content
   * @param content File content
   * @param language Detected language
   */
  matches(content: string, language: string): boolean;
  
  /**
   * Extract fields from a single line of code
   * @param line The line to analyze
   * @param context Surrounding lines for context
   * @param lineNumber Line number in file
   */
  extractFromLine(line: string, context: string[], lineNumber: number): LineExtractionResult;
  
  /**
   * Extract fields from model/entity definitions in the content
   * @param content Full file content
   */
  extractFromModels(content: string): ModelExtractionResult[];
}

/**
 * Base class for field extractors with common utilities
 */
export abstract class BaseFieldExtractor implements FieldExtractor {
  abstract readonly name: string;
  abstract readonly framework: ORMFramework;
  abstract readonly languages: string[];
  
  abstract matches(content: string, language: string): boolean;
  abstract extractFromLine(line: string, context: string[], lineNumber: number): LineExtractionResult;
  abstract extractFromModels(content: string): ModelExtractionResult[];
  
  /**
   * Helper to create an extracted field with defaults
   */
  protected createField(
    name: string,
    source: FieldSource,
    confidence: number,
    options?: Partial<ExtractedField>
  ): ExtractedField {
    return {
      name,
      source,
      confidence,
      ...options,
    };
  }
  
  /**
   * Helper to extract fields from comma-separated string
   */
  protected parseFieldList(fieldStr: string): string[] {
    return fieldStr
      .split(/\s*,\s*/)
      .map(f => f.trim())
      .filter(f => f && f !== '*');
  }
  
  /**
   * Helper to check if line is a comment
   */
  protected isComment(line: string): boolean {
    const trimmed = line.trim();
    return (
      trimmed.startsWith('//') ||
      trimmed.startsWith('#') ||
      trimmed.startsWith('*') ||
      trimmed.startsWith('/*') ||
      trimmed.startsWith('--') ||
      trimmed.startsWith('"""') ||
      trimmed.startsWith("'''")
    );
  }
  
  /**
   * Helper to build LineExtractionResult without undefined values
   */
  protected buildResult(
    fields: ExtractedField[],
    table?: string,
    framework?: ORMFramework
  ): LineExtractionResult {
    const result: LineExtractionResult = { fields };
    if (table) {
      result.table = table;
    }
    if (framework) {
      result.framework = framework;
    }
    return result;
  }
}
