/**
 * TypeScript/JavaScript Environment Variable Extractor
 *
 * Extracts environment variable access patterns from TypeScript/JavaScript.
 * 
 * Supports:
 * - process.env.VAR_NAME
 * - process.env['VAR_NAME']
 * - import.meta.env.VAR_NAME
 * - dotenv config patterns
 * - Vite/Next.js env patterns
 */

import { BaseEnvExtractor } from './base-env-extractor.js';

import type { EnvLanguage, EnvExtractionResult } from '../types.js';

/**
 * TypeScript/JavaScript environment variable extractor
 */
export class TypeScriptEnvExtractor extends BaseEnvExtractor {
  readonly language: EnvLanguage = 'typescript';
  readonly extensions: string[] = ['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs'];

  /**
   * Extract environment variable access from TypeScript/JavaScript source
   */
  extract(source: string, filePath: string): EnvExtractionResult {
    const result = this.createEmptyResult(filePath);
    
    // Determine actual language
    if (filePath.endsWith('.js') || filePath.endsWith('.jsx') || 
        filePath.endsWith('.mjs') || filePath.endsWith('.cjs')) {
      result.language = 'javascript';
    }

    try {
      // Extract process.env patterns
      this.extractProcessEnv(source, filePath, result);
      
      // Extract import.meta.env patterns (Vite)
      this.extractImportMetaEnv(source, filePath, result);
      
      // Extract dotenv patterns
      this.extractDotenvPatterns(source, filePath, result);
      
      // Extract config() patterns (e.g., from config libraries)
      this.extractConfigPatterns(source, filePath, result);
      
    } catch (error) {
      result.errors.push(error instanceof Error ? error.message : 'Unknown parse error');
    }

    return result;
  }

  /**
   * Extract process.env.VAR_NAME and process.env['VAR_NAME'] patterns
   */
  private extractProcessEnv(source: string, filePath: string, result: EnvExtractionResult): void {
    // Pattern: process.env.VAR_NAME
    const dotPattern = /process\.env\.([A-Z_][A-Z0-9_]*)/g;
    let match;
    
    while ((match = dotPattern.exec(source)) !== null) {
      const varName = match[1];
      if (!varName) {continue;}
      
      const pos = this.getPosition(source, match.index);
      const context = this.getContext(source, match.index);
      const { hasDefault, defaultValue, isRequired } = this.detectDefault(source, match.index, match[0].length);
      
      result.accessPoints.push(this.createAccessPoint({
        varName,
        method: 'process.env',
        file: filePath,
        line: pos.line,
        column: pos.column,
        context,
        hasDefault,
        defaultValue,
        isRequired,
      }));
    }

    // Pattern: process.env['VAR_NAME'] or process.env["VAR_NAME"]
    const bracketPattern = /process\.env\[['"]([A-Z_][A-Z0-9_]*)['"]\]/g;
    
    while ((match = bracketPattern.exec(source)) !== null) {
      const varName = match[1];
      if (!varName) {continue;}
      
      const pos = this.getPosition(source, match.index);
      const context = this.getContext(source, match.index);
      const { hasDefault, defaultValue, isRequired } = this.detectDefault(source, match.index, match[0].length);
      
      // Avoid duplicates
      const exists = result.accessPoints.some(ap => 
        ap.line === pos.line && ap.varName === varName
      );
      if (exists) {continue;}
      
      result.accessPoints.push(this.createAccessPoint({
        varName,
        method: 'process.env',
        file: filePath,
        line: pos.line,
        column: pos.column,
        context,
        hasDefault,
        defaultValue,
        isRequired,
      }));
    }
  }

  /**
   * Extract import.meta.env patterns (Vite, Astro)
   */
  private extractImportMetaEnv(source: string, filePath: string, result: EnvExtractionResult): void {
    // Pattern: import.meta.env.VITE_VAR_NAME
    const pattern = /import\.meta\.env\.([A-Z_][A-Z0-9_]*)/g;
    let match;
    
    while ((match = pattern.exec(source)) !== null) {
      const varName = match[1];
      if (!varName) {continue;}
      
      const pos = this.getPosition(source, match.index);
      const context = this.getContext(source, match.index);
      const { hasDefault, defaultValue, isRequired } = this.detectDefault(source, match.index, match[0].length);
      
      result.accessPoints.push(this.createAccessPoint({
        varName,
        method: 'import.meta.env',
        file: filePath,
        line: pos.line,
        column: pos.column,
        context,
        hasDefault,
        defaultValue,
        isRequired,
      }));
    }
  }

  /**
   * Extract dotenv config patterns
   */
  private extractDotenvPatterns(source: string, filePath: string, result: EnvExtractionResult): void {
    // Pattern: dotenv.config() or require('dotenv').config()
    const configPattern = /(?:dotenv|require\(['"]dotenv['"]\))\.config\(/g;
    let match;
    
    while ((match = configPattern.exec(source)) !== null) {
      const pos = this.getPosition(source, match.index);
      const context = this.getContext(source, match.index);
      
      // This is a config initialization, not a variable access
      // But we track it for completeness
      result.accessPoints.push(this.createAccessPoint({
        varName: '__DOTENV_CONFIG__',
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
   * Extract config() patterns from config libraries
   */
  private extractConfigPatterns(source: string, filePath: string, result: EnvExtractionResult): void {
    // Pattern: config.get('VAR_NAME') or config('VAR_NAME')
    const patterns = [
      /config\.get\(['"]([A-Za-z_][A-Za-z0-9_.]*)['"]\)/g,
      /config\(['"]([A-Za-z_][A-Za-z0-9_.]*)['"]\)/g,
      /getConfig\(['"]([A-Za-z_][A-Za-z0-9_.]*)['"]\)/g,
    ];
    
    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(source)) !== null) {
        const varName = match[1];
        if (!varName) {continue;}
        
        const pos = this.getPosition(source, match.index);
        const context = this.getContext(source, match.index);
        
        result.accessPoints.push(this.createAccessPoint({
          varName,
          method: 'config',
          file: filePath,
          line: pos.line,
          column: pos.column,
          context,
          hasDefault: false,
          isRequired: true,
          confidence: 0.8,
        }));
      }
    }
  }

  /**
   * Detect if a default value is provided
   */
  private detectDefault(source: string, matchIndex: number, matchLength: number): {
    hasDefault: boolean;
    defaultValue?: string | undefined;
    isRequired: boolean;
  } {
    // Look for patterns like:
    // process.env.VAR || 'default'
    // process.env.VAR ?? 'default'
    // process.env.VAR || defaultValue
    
    const afterMatch = source.slice(matchIndex + matchLength, matchIndex + matchLength + 100);
    
    // Check for || or ?? followed by a value
    const defaultMatch = afterMatch.match(/^\s*(?:\|\||[\?]{2})\s*(['"`]([^'"`]*?)['"`]|[a-zA-Z_][a-zA-Z0-9_]*|\d+)/);
    
    if (defaultMatch) {
      const defaultValue = defaultMatch[2] ?? defaultMatch[1];
      return {
        hasDefault: true,
        defaultValue,
        isRequired: false,
      };
    }
    
    // Check for ternary with throw
    const throwMatch = afterMatch.match(/^\s*\?\s*[^:]+\s*:\s*(?:throw|process\.exit)/);
    if (throwMatch) {
      return { hasDefault: false, isRequired: true };
    }
    
    // Check if wrapped in required() or similar
    const beforeMatch = source.slice(Math.max(0, matchIndex - 50), matchIndex);
    const requiredMatch = beforeMatch.match(/(?:required|mustHave|assert)\s*\(\s*$/);
    if (requiredMatch) {
      return { hasDefault: false, isRequired: true };
    }
    
    return { hasDefault: false, isRequired: false };
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
 * Create a TypeScript environment extractor
 */
export function createTypeScriptEnvExtractor(): TypeScriptEnvExtractor {
  return new TypeScriptEnvExtractor();
}
