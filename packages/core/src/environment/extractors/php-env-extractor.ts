/**
 * PHP Environment Variable Extractor
 *
 * Extracts environment variable access patterns from PHP.
 * 
 * Supports:
 * - getenv('VAR_NAME')
 * - $_ENV['VAR_NAME']
 * - $_SERVER['VAR_NAME']
 * - env('VAR_NAME') Laravel helper
 * - config('key') Laravel config
 */

import { BaseEnvExtractor } from './base-env-extractor.js';

import type { EnvLanguage, EnvExtractionResult } from '../types.js';

/**
 * PHP environment variable extractor
 */
export class PhpEnvExtractor extends BaseEnvExtractor {
  readonly language: EnvLanguage = 'php';
  readonly extensions: string[] = ['.php'];

  /**
   * Extract environment variable access from PHP source
   */
  extract(source: string, filePath: string): EnvExtractionResult {
    const result = this.createEmptyResult(filePath);

    try {
      // Extract getenv() patterns
      this.extractGetenv(source, filePath, result);
      
      // Extract $_ENV patterns
      this.extractEnvSuperglobal(source, filePath, result);
      
      // Extract $_SERVER patterns
      this.extractServerSuperglobal(source, filePath, result);
      
      // Extract Laravel env() patterns
      this.extractLaravelEnv(source, filePath, result);
      
      // Extract Laravel config() patterns
      this.extractLaravelConfig(source, filePath, result);
      
    } catch (error) {
      result.errors.push(error instanceof Error ? error.message : 'Unknown parse error');
    }

    return result;
  }

  /**
   * Extract getenv('VAR') patterns
   */
  private extractGetenv(source: string, filePath: string, result: EnvExtractionResult): void {
    // Pattern: getenv('VAR_NAME') or getenv("VAR_NAME")
    const pattern = /getenv\(\s*['"]([A-Z_][A-Z0-9_]*)['"]\s*\)/g;
    let match;
    
    while ((match = pattern.exec(source)) !== null) {
      const varName = match[1];
      if (!varName) {continue;}
      
      const pos = this.getPosition(source, match.index);
      const context = this.getContext(source, match.index);
      const { hasDefault, defaultValue } = this.detectDefault(source, match.index, match[0].length);
      
      result.accessPoints.push(this.createAccessPoint({
        varName,
        method: 'getenv',
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
   * Extract $_ENV['VAR'] patterns
   */
  private extractEnvSuperglobal(source: string, filePath: string, result: EnvExtractionResult): void {
    // Pattern: $_ENV['VAR_NAME'] or $_ENV["VAR_NAME"]
    const pattern = /\$_ENV\[['"]([A-Z_][A-Z0-9_]*)['"]\]/g;
    let match;
    
    while ((match = pattern.exec(source)) !== null) {
      const varName = match[1];
      if (!varName) {continue;}
      
      const pos = this.getPosition(source, match.index);
      const context = this.getContext(source, match.index);
      const { hasDefault, defaultValue } = this.detectDefault(source, match.index, match[0].length);
      
      result.accessPoints.push(this.createAccessPoint({
        varName,
        method: '$_ENV',
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
   * Extract $_SERVER['VAR'] patterns (for env vars passed via server)
   */
  private extractServerSuperglobal(source: string, filePath: string, result: EnvExtractionResult): void {
    // Pattern: $_SERVER['VAR_NAME'] - only for env-like vars
    const pattern = /\$_SERVER\[['"]([A-Z_][A-Z0-9_]*)['"]\]/g;
    let match;
    
    // Common server vars that are NOT env vars
    const serverVars = new Set([
      'REQUEST_METHOD', 'REQUEST_URI', 'QUERY_STRING', 'HTTP_HOST',
      'HTTP_USER_AGENT', 'HTTP_ACCEPT', 'HTTP_REFERER', 'REMOTE_ADDR',
      'SERVER_NAME', 'SERVER_PORT', 'SCRIPT_NAME', 'SCRIPT_FILENAME',
      'DOCUMENT_ROOT', 'PATH_INFO', 'PHP_SELF', 'CONTENT_TYPE', 'CONTENT_LENGTH',
    ]);
    
    while ((match = pattern.exec(source)) !== null) {
      const varName = match[1];
      if (!varName) {continue;}
      
      // Skip common server variables
      if (serverVars.has(varName)) {continue;}
      
      const pos = this.getPosition(source, match.index);
      const context = this.getContext(source, match.index);
      const { hasDefault, defaultValue } = this.detectDefault(source, match.index, match[0].length);
      
      result.accessPoints.push(this.createAccessPoint({
        varName,
        method: '$_SERVER',
        file: filePath,
        line: pos.line,
        column: pos.column,
        context,
        hasDefault,
        defaultValue,
        isRequired: !hasDefault,
        confidence: 0.7, // Lower confidence as $_SERVER can be server vars
      }));
    }
  }

  /**
   * Extract Laravel env('VAR') patterns
   */
  private extractLaravelEnv(source: string, filePath: string, result: EnvExtractionResult): void {
    // Pattern: env('VAR_NAME') or env('VAR_NAME', 'default')
    const pattern = /\benv\(\s*['"]([A-Z_][A-Z0-9_]*)['"](?:\s*,\s*(['"][^'"]*['"]|[^)]+))?\s*\)/g;
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
        method: 'env()',
        file: filePath,
        line: pos.line,
        column: pos.column,
        context,
        hasDefault,
        defaultValue,
        isRequired: !hasDefault,
        confidence: 0.95,
      }));
    }
  }

  /**
   * Extract Laravel config('key') patterns
   */
  private extractLaravelConfig(source: string, filePath: string, result: EnvExtractionResult): void {
    // Pattern: config('app.key') or config('app.key', 'default')
    const pattern = /\bconfig\(\s*['"]([a-zA-Z_][a-zA-Z0-9_.]*)['"](?:\s*,\s*(['"][^'"]*['"]|[^)]+))?\s*\)/g;
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
        method: 'config()',
        file: filePath,
        line: pos.line,
        column: pos.column,
        context,
        hasDefault,
        defaultValue,
        isRequired: !hasDefault,
        confidence: 0.9,
      }));
    }
  }

  /**
   * Detect if a default value is provided via ternary or null coalescing
   */
  private detectDefault(source: string, matchIndex: number, matchLength: number): {
    hasDefault: boolean;
    defaultValue?: string | undefined;
  } {
    const afterMatch = source.slice(matchIndex + matchLength, matchIndex + matchLength + 100);
    
    // Check for null coalescing: ?? 'default'
    const nullCoalesceMatch = afterMatch.match(/^\s*\?\?\s*['"]([^'"]*)['"]/);
    if (nullCoalesceMatch) {
      return { hasDefault: true, defaultValue: nullCoalesceMatch[1] };
    }
    
    // Check for ternary: ?: 'default'
    const elvisMatch = afterMatch.match(/^\s*\?:\s*['"]([^'"]*)['"]/);
    if (elvisMatch) {
      return { hasDefault: true, defaultValue: elvisMatch[1] };
    }
    
    // Check for || 'default'
    const orMatch = afterMatch.match(/^\s*\|\|\s*['"]([^'"]*)['"]/);
    if (orMatch) {
      return { hasDefault: true, defaultValue: orMatch[1] };
    }
    
    return { hasDefault: false };
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
 * Create a PHP environment extractor
 */
export function createPhpEnvExtractor(): PhpEnvExtractor {
  return new PhpEnvExtractor();
}
