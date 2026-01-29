/**
 * C# Environment Variable Extractor
 *
 * Extracts environment variable access patterns from C#.
 * 
 * Supports:
 * - Environment.GetEnvironmentVariable("VAR")
 * - IConfiguration["VAR"] and IConfiguration.GetValue<T>("VAR")
 * - ConfigurationManager.AppSettings["VAR"]
 * - appsettings.json patterns
 */

import { BaseEnvExtractor } from './base-env-extractor.js';

import type { EnvLanguage, EnvExtractionResult } from '../types.js';

/**
 * C# environment variable extractor
 */
export class CSharpEnvExtractor extends BaseEnvExtractor {
  readonly language: EnvLanguage = 'csharp';
  readonly extensions: string[] = ['.cs'];

  /**
   * Extract environment variable access from C# source
   */
  extract(source: string, filePath: string): EnvExtractionResult {
    const result = this.createEmptyResult(filePath);

    try {
      // Extract Environment.GetEnvironmentVariable patterns
      this.extractEnvironmentGetEnv(source, filePath, result);
      
      // Extract IConfiguration patterns
      this.extractIConfiguration(source, filePath, result);
      
      // Extract ConfigurationManager patterns
      this.extractConfigurationManager(source, filePath, result);
      
    } catch (error) {
      result.errors.push(error instanceof Error ? error.message : 'Unknown parse error');
    }

    return result;
  }

  /**
   * Extract Environment.GetEnvironmentVariable patterns
   */
  private extractEnvironmentGetEnv(source: string, filePath: string, result: EnvExtractionResult): void {
    // Pattern: Environment.GetEnvironmentVariable("VAR_NAME")
    const pattern = /Environment\.GetEnvironmentVariable\(\s*"([A-Z_][A-Z0-9_]*)"\s*\)/g;
    let match;
    
    while ((match = pattern.exec(source)) !== null) {
      const varName = match[1];
      if (!varName) {continue;}
      
      const pos = this.getPosition(source, match.index);
      const context = this.getContext(source, match.index);
      const { hasDefault, defaultValue } = this.detectDefault(source, match.index, match[0].length);
      
      result.accessPoints.push(this.createAccessPoint({
        varName,
        method: 'Environment.GetEnvironmentVariable',
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
   * Extract IConfiguration patterns
   */
  private extractIConfiguration(source: string, filePath: string, result: EnvExtractionResult): void {
    // Pattern: _configuration["Section:Key"] or configuration["Key"]
    const bracketPattern = /(?:_?configuration|config|settings)\["([a-zA-Z_][a-zA-Z0-9_:.]*)"\]/gi;
    let match;
    
    while ((match = bracketPattern.exec(source)) !== null) {
      const varName = match[1];
      if (!varName) {continue;}
      
      const pos = this.getPosition(source, match.index);
      const context = this.getContext(source, match.index);
      const { hasDefault, defaultValue } = this.detectDefault(source, match.index, match[0].length);
      
      result.accessPoints.push(this.createAccessPoint({
        varName,
        method: 'IConfiguration',
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

    // Pattern: configuration.GetValue<T>("Key") or configuration.GetValue<T>("Key", defaultValue)
    const getValuePattern = /(?:_?configuration|config|settings)\.GetValue<[^>]+>\(\s*"([a-zA-Z_][a-zA-Z0-9_:.]*)"(?:\s*,\s*([^)]+))?\s*\)/gi;
    
    while ((match = getValuePattern.exec(source)) !== null) {
      const varName = match[1];
      if (!varName) {continue;}
      
      const pos = this.getPosition(source, match.index);
      const context = this.getContext(source, match.index);
      const defaultArg = match[2];
      const hasDefault = defaultArg !== undefined && defaultArg.trim() !== '';
      
      result.accessPoints.push(this.createAccessPoint({
        varName,
        method: 'IConfiguration',
        file: filePath,
        line: pos.line,
        column: pos.column,
        context,
        hasDefault,
        defaultValue: hasDefault ? defaultArg?.trim() : undefined,
        isRequired: !hasDefault,
        confidence: 0.9,
      }));
    }

    // Pattern: configuration.GetSection("Section").Bind(options)
    const getSectionPattern = /(?:_?configuration|config|settings)\.GetSection\(\s*"([a-zA-Z_][a-zA-Z0-9_:.]*)"\s*\)/gi;
    
    while ((match = getSectionPattern.exec(source)) !== null) {
      const varName = match[1];
      if (!varName) {continue;}
      
      const pos = this.getPosition(source, match.index);
      const context = this.getContext(source, match.index);
      
      result.accessPoints.push(this.createAccessPoint({
        varName: `${varName}:*`,
        method: 'IConfiguration',
        file: filePath,
        line: pos.line,
        column: pos.column,
        context,
        hasDefault: true,
        isRequired: false,
        confidence: 0.85,
      }));
    }

    // Pattern: configuration.GetConnectionString("Name")
    const connStringPattern = /(?:_?configuration|config|settings)\.GetConnectionString\(\s*"([a-zA-Z_][a-zA-Z0-9_]*)"\s*\)/gi;
    
    while ((match = connStringPattern.exec(source)) !== null) {
      const varName = match[1];
      if (!varName) {continue;}
      
      const pos = this.getPosition(source, match.index);
      const context = this.getContext(source, match.index);
      
      result.accessPoints.push(this.createAccessPoint({
        varName: `ConnectionStrings:${varName}`,
        method: 'IConfiguration',
        file: filePath,
        line: pos.line,
        column: pos.column,
        context,
        hasDefault: false,
        isRequired: true,
        confidence: 0.95,
      }));
    }
  }

  /**
   * Extract ConfigurationManager patterns
   */
  private extractConfigurationManager(source: string, filePath: string, result: EnvExtractionResult): void {
    // Pattern: ConfigurationManager.AppSettings["Key"]
    const appSettingsPattern = /ConfigurationManager\.AppSettings\["([a-zA-Z_][a-zA-Z0-9_]*)"\]/g;
    let match;
    
    while ((match = appSettingsPattern.exec(source)) !== null) {
      const varName = match[1];
      if (!varName) {continue;}
      
      const pos = this.getPosition(source, match.index);
      const context = this.getContext(source, match.index);
      const { hasDefault, defaultValue } = this.detectDefault(source, match.index, match[0].length);
      
      result.accessPoints.push(this.createAccessPoint({
        varName,
        method: 'ConfigurationManager',
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

    // Pattern: ConfigurationManager.ConnectionStrings["Name"]
    const connStringsPattern = /ConfigurationManager\.ConnectionStrings\["([a-zA-Z_][a-zA-Z0-9_]*)"\]/g;
    
    while ((match = connStringsPattern.exec(source)) !== null) {
      const varName = match[1];
      if (!varName) {continue;}
      
      const pos = this.getPosition(source, match.index);
      const context = this.getContext(source, match.index);
      
      result.accessPoints.push(this.createAccessPoint({
        varName: `ConnectionStrings:${varName}`,
        method: 'ConfigurationManager',
        file: filePath,
        line: pos.line,
        column: pos.column,
        context,
        hasDefault: false,
        isRequired: true,
        confidence: 0.95,
      }));
    }
  }

  /**
   * Detect if a default value is provided via null-coalescing or ternary
   */
  private detectDefault(source: string, matchIndex: number, matchLength: number): {
    hasDefault: boolean;
    defaultValue?: string | undefined;
  } {
    const afterMatch = source.slice(matchIndex + matchLength, matchIndex + matchLength + 100);
    
    // Check for null-coalescing: ?? "default"
    const nullCoalesceMatch = afterMatch.match(/^\s*\?\?\s*"([^"]*)"/);
    if (nullCoalesceMatch) {
      return { hasDefault: true, defaultValue: nullCoalesceMatch[1] };
    }
    
    // Check for ternary: != null ? ... : "default"
    const ternaryMatch = afterMatch.match(/^\s*!=\s*null\s*\?\s*[^:]+\s*:\s*"([^"]*)"/);
    if (ternaryMatch) {
      return { hasDefault: true, defaultValue: ternaryMatch[1] };
    }
    
    // Check for string.IsNullOrEmpty pattern
    const isNullOrEmptyMatch = afterMatch.match(/^\s*\)\s*\?\s*"([^"]*)"\s*:/);
    if (isNullOrEmptyMatch) {
      return { hasDefault: true, defaultValue: isNullOrEmptyMatch[1] };
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
 * Create a C# environment extractor
 */
export function createCSharpEnvExtractor(): CSharpEnvExtractor {
  return new CSharpEnvExtractor();
}
