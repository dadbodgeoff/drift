/**
 * Go Environment Variable Extractor
 *
 * Extracts environment variable access patterns from Go.
 * 
 * Supports:
 * - os.Getenv("VAR_NAME")
 * - os.LookupEnv("VAR_NAME")
 * - viper patterns
 * - envconfig patterns
 */

import { BaseEnvExtractor } from './base-env-extractor.js';

import type { EnvLanguage, EnvExtractionResult } from '../types.js';

/**
 * Go environment variable extractor
 */
export class GoEnvExtractor extends BaseEnvExtractor {
  readonly language: EnvLanguage = 'go';
  readonly extensions: string[] = ['.go'];

  /**
   * Extract environment variable access from Go source
   */
  extract(source: string, filePath: string): EnvExtractionResult {
    const result = this.createEmptyResult(filePath);

    try {
      // Extract os.Getenv patterns
      this.extractOsGetenv(source, filePath, result);
      
      // Extract os.LookupEnv patterns
      this.extractOsLookupEnv(source, filePath, result);
      
      // Extract viper patterns
      this.extractViperPatterns(source, filePath, result);
      
      // Extract envconfig patterns
      this.extractEnvconfigPatterns(source, filePath, result);
      
    } catch (error) {
      result.errors.push(error instanceof Error ? error.message : 'Unknown parse error');
    }

    return result;
  }

  /**
   * Extract os.Getenv("VAR") patterns
   */
  private extractOsGetenv(source: string, filePath: string, result: EnvExtractionResult): void {
    // Pattern: os.Getenv("VAR_NAME")
    const pattern = /os\.Getenv\(\s*"([A-Z_][A-Z0-9_]*)"\s*\)/g;
    let match;
    
    while ((match = pattern.exec(source)) !== null) {
      const varName = match[1];
      if (!varName) {continue;}
      
      const pos = this.getPosition(source, match.index);
      const context = this.getContext(source, match.index);
      const { hasDefault, defaultValue } = this.detectDefault(source, match.index, match[0].length);
      
      result.accessPoints.push(this.createAccessPoint({
        varName,
        method: 'os.Getenv',
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
   * Extract os.LookupEnv("VAR") patterns
   */
  private extractOsLookupEnv(source: string, filePath: string, result: EnvExtractionResult): void {
    // Pattern: os.LookupEnv("VAR_NAME")
    const pattern = /os\.LookupEnv\(\s*"([A-Z_][A-Z0-9_]*)"\s*\)/g;
    let match;
    
    while ((match = pattern.exec(source)) !== null) {
      const varName = match[1];
      if (!varName) {continue;}
      
      const pos = this.getPosition(source, match.index);
      const context = this.getContext(source, match.index);
      
      // LookupEnv returns (value, ok) so it's typically used with a check
      // This means it's usually not required (has implicit handling)
      result.accessPoints.push(this.createAccessPoint({
        varName,
        method: 'os.LookupEnv',
        file: filePath,
        line: pos.line,
        column: pos.column,
        context,
        hasDefault: true, // LookupEnv implies handling of missing case
        isRequired: false,
        confidence: 0.9,
      }));
    }
  }

  /**
   * Extract viper patterns
   */
  private extractViperPatterns(source: string, filePath: string, result: EnvExtractionResult): void {
    // Pattern: viper.GetString("VAR") or viper.Get("VAR")
    const getPatterns = [
      /viper\.GetString\(\s*"([a-zA-Z_][a-zA-Z0-9_.]*)"\s*\)/g,
      /viper\.GetInt\(\s*"([a-zA-Z_][a-zA-Z0-9_.]*)"\s*\)/g,
      /viper\.GetBool\(\s*"([a-zA-Z_][a-zA-Z0-9_.]*)"\s*\)/g,
      /viper\.Get\(\s*"([a-zA-Z_][a-zA-Z0-9_.]*)"\s*\)/g,
      /viper\.GetDuration\(\s*"([a-zA-Z_][a-zA-Z0-9_.]*)"\s*\)/g,
    ];
    
    for (const pattern of getPatterns) {
      let match;
      while ((match = pattern.exec(source)) !== null) {
        const varName = match[1];
        if (!varName) {continue;}
        
        const pos = this.getPosition(source, match.index);
        const context = this.getContext(source, match.index);
        
        result.accessPoints.push(this.createAccessPoint({
          varName,
          method: 'viper',
          file: filePath,
          line: pos.line,
          column: pos.column,
          context,
          hasDefault: false,
          isRequired: true,
          confidence: 0.9,
        }));
      }
    }

    // Pattern: viper.SetDefault("key", value)
    const setDefaultPattern = /viper\.SetDefault\(\s*"([a-zA-Z_][a-zA-Z0-9_.]*)"\s*,\s*([^)]+)\s*\)/g;
    let match;
    
    while ((match = setDefaultPattern.exec(source)) !== null) {
      const varName = match[1];
      if (!varName) {continue;}
      
      const pos = this.getPosition(source, match.index);
      const context = this.getContext(source, match.index);
      const defaultValue = match[2]?.trim();
      
      result.accessPoints.push(this.createAccessPoint({
        varName,
        method: 'viper',
        file: filePath,
        line: pos.line,
        column: pos.column,
        context,
        hasDefault: true,
        defaultValue,
        isRequired: false,
        confidence: 0.85,
      }));
    }

    // Pattern: viper.BindEnv("key", "ENV_VAR")
    const bindEnvPattern = /viper\.BindEnv\(\s*"([a-zA-Z_][a-zA-Z0-9_.]*)"\s*(?:,\s*"([A-Z_][A-Z0-9_]*)")?\s*\)/g;
    
    while ((match = bindEnvPattern.exec(source)) !== null) {
      const configKey = match[1];
      const envVar = match[2] ?? configKey?.toUpperCase().replace(/\./g, '_');
      if (!envVar) {continue;}
      
      const pos = this.getPosition(source, match.index);
      const context = this.getContext(source, match.index);
      
      result.accessPoints.push(this.createAccessPoint({
        varName: envVar,
        method: 'viper',
        file: filePath,
        line: pos.line,
        column: pos.column,
        context,
        hasDefault: false,
        isRequired: true,
        confidence: 0.9,
      }));
    }

    // Pattern: viper.AutomaticEnv()
    const autoEnvPattern = /viper\.AutomaticEnv\(\)/g;
    
    while ((match = autoEnvPattern.exec(source)) !== null) {
      const pos = this.getPosition(source, match.index);
      const context = this.getContext(source, match.index);
      
      result.accessPoints.push(this.createAccessPoint({
        varName: '__VIPER_AUTO_ENV__',
        method: 'viper',
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
   * Extract envconfig patterns
   */
  private extractEnvconfigPatterns(source: string, filePath: string, result: EnvExtractionResult): void {
    // Pattern: envconfig.Process("prefix", &config)
    const processPattern = /envconfig\.Process\(\s*"([a-zA-Z_][a-zA-Z0-9_]*)"\s*,/g;
    let match;
    
    while ((match = processPattern.exec(source)) !== null) {
      const prefix = match[1];
      if (!prefix) {continue;}
      
      const pos = this.getPosition(source, match.index);
      const context = this.getContext(source, match.index);
      
      result.accessPoints.push(this.createAccessPoint({
        varName: `${prefix.toUpperCase()}_*`,
        method: 'envconfig',
        file: filePath,
        line: pos.line,
        column: pos.column,
        context,
        hasDefault: true,
        isRequired: false,
        confidence: 0.8,
      }));
    }

    // Pattern: struct tags `envconfig:"VAR_NAME"`
    const tagPattern = /`[^`]*envconfig:"([A-Z_][A-Z0-9_]*)(?:,([^"]*))?"[^`]*`/g;
    
    while ((match = tagPattern.exec(source)) !== null) {
      const varName = match[1];
      if (!varName) {continue;}
      
      const pos = this.getPosition(source, match.index);
      const context = this.getContext(source, match.index);
      const options = match[2] ?? '';
      const isRequired = options.includes('required');
      const hasDefault = options.includes('default');
      
      result.accessPoints.push(this.createAccessPoint({
        varName,
        method: 'envconfig',
        file: filePath,
        line: pos.line,
        column: pos.column,
        context,
        hasDefault,
        isRequired,
        confidence: 0.95,
      }));
    }
  }

  /**
   * Detect if a default value is provided
   */
  private detectDefault(source: string, matchIndex: number, matchLength: number): {
    hasDefault: boolean;
    defaultValue?: string | undefined;
  } {
    const afterMatch = source.slice(matchIndex + matchLength, matchIndex + matchLength + 100);
    
    // Check for if val == "" { val = "default" } pattern
    const ifEmptyMatch = afterMatch.match(/^\s*\)\s*\n?\s*if\s+\w+\s*==\s*""\s*\{\s*\w+\s*=\s*"([^"]*)"/);
    if (ifEmptyMatch) {
      return { hasDefault: true, defaultValue: ifEmptyMatch[1] };
    }
    
    // Check for inline default: val := os.Getenv("X"); if val == "" { val = "default" }
    // This is harder to detect without full parsing
    
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
 * Create a Go environment extractor
 */
export function createGoEnvExtractor(): GoEnvExtractor {
  return new GoEnvExtractor();
}
