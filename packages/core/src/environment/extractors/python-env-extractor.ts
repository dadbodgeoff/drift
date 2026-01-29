/**
 * Python Environment Variable Extractor
 *
 * Extracts environment variable access patterns from Python.
 * 
 * Supports:
 * - os.environ['VAR_NAME']
 * - os.environ.get('VAR_NAME')
 * - os.getenv('VAR_NAME')
 * - dotenv patterns
 * - pydantic Settings patterns
 */

import { BaseEnvExtractor } from './base-env-extractor.js';

import type { EnvLanguage, EnvExtractionResult } from '../types.js';

/**
 * Python environment variable extractor
 */
export class PythonEnvExtractor extends BaseEnvExtractor {
  readonly language: EnvLanguage = 'python';
  readonly extensions: string[] = ['.py', '.pyw'];

  /**
   * Extract environment variable access from Python source
   */
  extract(source: string, filePath: string): EnvExtractionResult {
    const result = this.createEmptyResult(filePath);

    try {
      // Extract os.environ patterns
      this.extractOsEnviron(source, filePath, result);
      
      // Extract os.getenv patterns
      this.extractOsGetenv(source, filePath, result);
      
      // Extract dotenv patterns
      this.extractDotenvPatterns(source, filePath, result);
      
      // Extract pydantic Settings patterns
      this.extractPydanticSettings(source, filePath, result);
      
    } catch (error) {
      result.errors.push(error instanceof Error ? error.message : 'Unknown parse error');
    }

    return result;
  }

  /**
   * Extract os.environ['VAR'] and os.environ.get('VAR') patterns
   */
  private extractOsEnviron(source: string, filePath: string, result: EnvExtractionResult): void {
    // Pattern: os.environ['VAR_NAME'] or os.environ["VAR_NAME"]
    const bracketPattern = /os\.environ\[['"]([A-Z_][A-Z0-9_]*)['"]\]/g;
    let match;
    
    while ((match = bracketPattern.exec(source)) !== null) {
      const varName = match[1];
      if (!varName) {continue;}
      
      const pos = this.getPosition(source, match.index);
      const context = this.getContext(source, match.index);
      
      result.accessPoints.push(this.createAccessPoint({
        varName,
        method: 'os.environ',
        file: filePath,
        line: pos.line,
        column: pos.column,
        context,
        hasDefault: false,
        isRequired: true, // Direct bracket access raises KeyError if missing
      }));
    }

    // Pattern: os.environ.get('VAR_NAME') or os.environ.get('VAR_NAME', 'default')
    const getPattern = /os\.environ\.get\(\s*['"]([A-Z_][A-Z0-9_]*)['"](?:\s*,\s*(['"][^'"]*['"]|[^)]+))?\s*\)/g;
    
    while ((match = getPattern.exec(source)) !== null) {
      const varName = match[1];
      if (!varName) {continue;}
      
      const pos = this.getPosition(source, match.index);
      const context = this.getContext(source, match.index);
      const defaultArg = match[2];
      const hasDefault = defaultArg !== undefined && defaultArg.trim() !== '';
      const defaultValue = hasDefault ? this.extractStringValue(defaultArg.trim()) ?? defaultArg.trim() : undefined;
      
      result.accessPoints.push(this.createAccessPoint({
        varName,
        method: 'os.environ',
        file: filePath,
        line: pos.line,
        column: pos.column,
        context,
        hasDefault,
        defaultValue,
        isRequired: !hasDefault,
      }));
    }
  }

  /**
   * Extract os.getenv('VAR') patterns
   */
  private extractOsGetenv(source: string, filePath: string, result: EnvExtractionResult): void {
    // Pattern: os.getenv('VAR_NAME') or os.getenv('VAR_NAME', 'default')
    const pattern = /os\.getenv\(\s*['"]([A-Z_][A-Z0-9_]*)['"](?:\s*,\s*(['"][^'"]*['"]|[^)]+))?\s*\)/g;
    let match;
    
    while ((match = pattern.exec(source)) !== null) {
      const varName = match[1];
      if (!varName) {continue;}
      
      const pos = this.getPosition(source, match.index);
      const context = this.getContext(source, match.index);
      const defaultArg = match[2];
      const hasDefault = defaultArg !== undefined && defaultArg.trim() !== '';
      const defaultValue = hasDefault ? this.extractStringValue(defaultArg.trim()) ?? defaultArg.trim() : undefined;
      
      result.accessPoints.push(this.createAccessPoint({
        varName,
        method: 'os.getenv',
        file: filePath,
        line: pos.line,
        column: pos.column,
        context,
        hasDefault,
        defaultValue,
        isRequired: !hasDefault,
      }));
    }
  }

  /**
   * Extract python-dotenv patterns
   */
  private extractDotenvPatterns(source: string, filePath: string, result: EnvExtractionResult): void {
    // Pattern: load_dotenv() or dotenv.load_dotenv()
    const loadPattern = /(?:dotenv\.)?load_dotenv\(/g;
    let match;
    
    while ((match = loadPattern.exec(source)) !== null) {
      const pos = this.getPosition(source, match.index);
      const context = this.getContext(source, match.index);
      
      result.accessPoints.push(this.createAccessPoint({
        varName: '__DOTENV_LOAD__',
        method: 'dotenv',
        file: filePath,
        line: pos.line,
        column: pos.column,
        context,
        hasDefault: true,
        isRequired: false,
        confidence: 0.7,
      }));
    }

    // Pattern: dotenv_values() or dotenv.dotenv_values()
    const valuesPattern = /(?:dotenv\.)?dotenv_values\(/g;
    
    while ((match = valuesPattern.exec(source)) !== null) {
      const pos = this.getPosition(source, match.index);
      const context = this.getContext(source, match.index);
      
      result.accessPoints.push(this.createAccessPoint({
        varName: '__DOTENV_VALUES__',
        method: 'dotenv',
        file: filePath,
        line: pos.line,
        column: pos.column,
        context,
        hasDefault: true,
        isRequired: false,
        confidence: 0.7,
      }));
    }
  }

  /**
   * Extract pydantic Settings patterns
   */
  private extractPydanticSettings(source: string, filePath: string, result: EnvExtractionResult): void {
    // Pattern: class Settings(BaseSettings): with Field(env='VAR_NAME')
    // This is a simplified pattern - full parsing would need AST
    const fieldPattern = /Field\([^)]*env\s*=\s*['"]([A-Z_][A-Z0-9_]*)['"]/g;
    let match;
    
    while ((match = fieldPattern.exec(source)) !== null) {
      const varName = match[1];
      if (!varName) {continue;}
      
      const pos = this.getPosition(source, match.index);
      const context = this.getContext(source, match.index);
      
      result.accessPoints.push(this.createAccessPoint({
        varName,
        method: 'pydantic-settings',
        file: filePath,
        line: pos.line,
        column: pos.column,
        context,
        hasDefault: false, // Would need more context to determine
        isRequired: true,
        confidence: 0.85,
      }));
    }

    // Pattern: model_config with env_prefix
    const prefixPattern = /env_prefix\s*=\s*['"]([A-Z_][A-Z0-9_]*)['"]/g;
    
    while ((match = prefixPattern.exec(source)) !== null) {
      const prefix = match[1];
      if (!prefix) {continue;}
      
      const pos = this.getPosition(source, match.index);
      const context = this.getContext(source, match.index);
      
      result.accessPoints.push(this.createAccessPoint({
        varName: `${prefix}*`,
        method: 'pydantic-settings',
        file: filePath,
        line: pos.line,
        column: pos.column,
        context,
        hasDefault: true,
        isRequired: false,
        confidence: 0.7,
      }));
    }
  }

  /**
   * Get context around a match
   */
  private getContext(source: string, index: number): string {
    const start = Math.max(0, index - 20);
    const end = Math.min(source.length, index + 80);
    return source.slice(start, end).replace(/\n/g, ' ').trim();
  }
}

/**
 * Create a Python environment extractor
 */
export function createPythonEnvExtractor(): PythonEnvExtractor {
  return new PythonEnvExtractor();
}
