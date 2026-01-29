/**
 * Base Environment Variable Extractor
 *
 * Abstract base class for language-specific environment variable extractors.
 */

import { classifyEnvSensitivity } from '../types.js';

import type {
  EnvLanguage,
  EnvAccessMethod,
  EnvAccessPoint,
  EnvExtractionResult,
  EnvSensitivity,
} from '../types.js';

/**
 * Base class for environment variable extractors
 */
export abstract class BaseEnvExtractor {
  /** Language this extractor handles */
  abstract readonly language: EnvLanguage;
  
  /** File extensions this extractor handles */
  abstract readonly extensions: string[];

  /**
   * Check if this extractor can handle a file
   */
  canHandle(filePath: string): boolean {
    const lower = filePath.toLowerCase();
    return this.extensions.some(ext => lower.endsWith(ext));
  }

  /**
   * Extract environment variable access from source code
   */
  abstract extract(source: string, filePath: string): EnvExtractionResult;

  /**
   * Create an empty extraction result
   */
  protected createEmptyResult(filePath: string): EnvExtractionResult {
    return {
      file: filePath,
      language: this.language,
      accessPoints: [],
      errors: [],
    };
  }

  /**
   * Create an environment access point
   */
  protected createAccessPoint(params: {
    varName: string;
    method: EnvAccessMethod;
    file: string;
    line: number;
    column: number;
    context: string;
    hasDefault?: boolean | undefined;
    defaultValue?: string | undefined;
    isRequired?: boolean | undefined;
    containingFunction?: string | undefined;
    confidence?: number | undefined;
    sensitivity?: EnvSensitivity | undefined;
  }): EnvAccessPoint {
    const sensitivity = params.sensitivity ?? classifyEnvSensitivity(params.varName);
    const id = `${params.file}:${params.line}:${params.column}:${params.varName}`;
    
    return {
      id,
      varName: params.varName,
      method: params.method,
      file: params.file,
      line: params.line,
      column: params.column,
      context: params.context.slice(0, 200),
      language: this.language,
      sensitivity,
      confidence: params.confidence ?? 0.9,
      hasDefault: params.hasDefault ?? false,
      defaultValue: params.defaultValue,
      isRequired: params.isRequired ?? !params.hasDefault,
      containingFunction: params.containingFunction,
    };
  }

  /**
   * Extract string value from quotes
   */
  protected extractStringValue(text: string): string | null {
    // Match single, double, or backtick quotes
    const match = text.match(/^['"`](.*)['"`]$/);
    if (match?.[1] !== undefined) {
      return match[1];
    }
    return null;
  }

  /**
   * Get line and column from position in source
   */
  protected getPosition(source: string, offset: number): { line: number; column: number } {
    const lines = source.slice(0, offset).split('\n');
    return {
      line: lines.length,
      column: (lines[lines.length - 1]?.length ?? 0) + 1,
    };
  }
}
