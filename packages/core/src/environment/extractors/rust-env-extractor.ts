/**
 * Rust Environment Variable Extractor
 *
 * Extracts environment variable access patterns from Rust.
 * 
 * Supports:
 * - std::env::var("VAR_NAME")
 * - std::env::var_os("VAR_NAME")
 * - dotenvy patterns
 * - config-rs patterns
 * - envy patterns
 */

import { BaseEnvExtractor } from './base-env-extractor.js';

import type { EnvLanguage, EnvExtractionResult } from '../types.js';

/**
 * Rust environment variable extractor
 */
export class RustEnvExtractor extends BaseEnvExtractor {
  readonly language: EnvLanguage = 'rust' as EnvLanguage;
  readonly extensions: string[] = ['.rs'];

  /**
   * Extract environment variable access from Rust source
   */
  extract(source: string, filePath: string): EnvExtractionResult {
    const result = this.createEmptyResult(filePath);

    try {
      // Extract std::env::var patterns
      this.extractStdEnvVar(source, filePath, result);
      
      // Extract std::env::var_os patterns
      this.extractStdEnvVarOs(source, filePath, result);
      
      // Extract dotenvy patterns
      this.extractDotenvyPatterns(source, filePath, result);
      
      // Extract config-rs patterns
      this.extractConfigRsPatterns(source, filePath, result);
      
      // Extract envy patterns
      this.extractEnvyPatterns(source, filePath, result);
      
    } catch (error) {
      result.errors.push(error instanceof Error ? error.message : 'Unknown parse error');
    }

    return result;
  }

  /**
   * Extract std::env::var("VAR") patterns
   */
  private extractStdEnvVar(source: string, filePath: string, result: EnvExtractionResult): void {
    // Pattern: env::var("VAR_NAME") or std::env::var("VAR_NAME")
    const pattern = /(?:std::)?env::var\s*\(\s*"([A-Z_][A-Z0-9_]*)"\s*\)/g;
    let match;
    
    while ((match = pattern.exec(source)) !== null) {
      const varName = match[1];
      if (!varName) {continue;}
      
      const pos = this.getPosition(source, match.index);
      const context = this.getContext(source, match.index);
      const { hasDefault, defaultValue } = this.detectDefault(source, match.index, match[0].length);
      
      result.accessPoints.push(this.createAccessPoint({
        varName,
        method: 'os.Getenv', // Using Go-style method name for consistency
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
   * Extract std::env::var_os("VAR") patterns
   */
  private extractStdEnvVarOs(source: string, filePath: string, result: EnvExtractionResult): void {
    // Pattern: env::var_os("VAR_NAME")
    const pattern = /(?:std::)?env::var_os\s*\(\s*"([A-Z_][A-Z0-9_]*)"\s*\)/g;
    let match;
    
    while ((match = pattern.exec(source)) !== null) {
      const varName = match[1];
      if (!varName) {continue;}
      
      const pos = this.getPosition(source, match.index);
      const context = this.getContext(source, match.index);
      
      // var_os returns Option<OsString>, so it's typically used with handling
      result.accessPoints.push(this.createAccessPoint({
        varName,
        method: 'os.LookupEnv', // Using Go-style method name for consistency
        file: filePath,
        line: pos.line,
        column: pos.column,
        context,
        hasDefault: true, // var_os implies handling of missing case
        isRequired: false,
        confidence: 0.9,
      }));
    }
  }

  /**
   * Extract dotenvy patterns
   */
  private extractDotenvyPatterns(source: string, filePath: string, result: EnvExtractionResult): void {
    // Pattern: dotenvy::var("VAR_NAME")
    const varPattern = /dotenvy::var\s*\(\s*"([A-Z_][A-Z0-9_]*)"\s*\)/g;
    let match;
    
    while ((match = varPattern.exec(source)) !== null) {
      const varName = match[1];
      if (!varName) {continue;}
      
      const pos = this.getPosition(source, match.index);
      const context = this.getContext(source, match.index);
      
      result.accessPoints.push(this.createAccessPoint({
        varName,
        method: 'dotenv' as any,
        file: filePath,
        line: pos.line,
        column: pos.column,
        context,
        hasDefault: false,
        isRequired: true,
        confidence: 0.9,
      }));
    }

    // Pattern: dotenvy::dotenv() - loads .env file
    const dotenvPattern = /dotenvy::dotenv\s*\(\s*\)/g;
    
    while ((match = dotenvPattern.exec(source)) !== null) {
      const pos = this.getPosition(source, match.index);
      const context = this.getContext(source, match.index);
      
      result.accessPoints.push(this.createAccessPoint({
        varName: '__DOTENVY_LOAD__',
        method: 'dotenv' as any,
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
   * Extract config-rs patterns
   */
  private extractConfigRsPatterns(source: string, filePath: string, result: EnvExtractionResult): void {
    // Pattern: config.get::<Type>("key") or config.get_string("key")
    const getPatterns = [
      /\.get(?::<[^>]+>)?\s*\(\s*"([a-zA-Z_][a-zA-Z0-9_.]*)"\s*\)/g,
      /\.get_string\s*\(\s*"([a-zA-Z_][a-zA-Z0-9_.]*)"\s*\)/g,
      /\.get_int\s*\(\s*"([a-zA-Z_][a-zA-Z0-9_.]*)"\s*\)/g,
      /\.get_bool\s*\(\s*"([a-zA-Z_][a-zA-Z0-9_.]*)"\s*\)/g,
      /\.get_float\s*\(\s*"([a-zA-Z_][a-zA-Z0-9_.]*)"\s*\)/g,
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
          method: 'config' as any,
          file: filePath,
          line: pos.line,
          column: pos.column,
          context,
          hasDefault: false,
          isRequired: true,
          confidence: 0.85,
        }));
      }
    }

    // Pattern: Environment::with_prefix("PREFIX")
    const prefixPattern = /Environment::with_prefix\s*\(\s*"([A-Z_][A-Z0-9_]*)"\s*\)/g;
    let match;
    
    while ((match = prefixPattern.exec(source)) !== null) {
      const prefix = match[1];
      if (!prefix) {continue;}
      
      const pos = this.getPosition(source, match.index);
      const context = this.getContext(source, match.index);
      
      result.accessPoints.push(this.createAccessPoint({
        varName: `${prefix}_*`,
        method: 'config' as any,
        file: filePath,
        line: pos.line,
        column: pos.column,
        context,
        hasDefault: true,
        isRequired: false,
        confidence: 0.8,
      }));
    }
  }

  /**
   * Extract envy patterns
   */
  private extractEnvyPatterns(source: string, filePath: string, result: EnvExtractionResult): void {
    // Pattern: envy::from_env::<Config>()
    const fromEnvPattern = /envy::from_env(?::<[^>]+>)?\s*\(\s*\)/g;
    let match;
    
    while ((match = fromEnvPattern.exec(source)) !== null) {
      const pos = this.getPosition(source, match.index);
      const context = this.getContext(source, match.index);
      
      result.accessPoints.push(this.createAccessPoint({
        varName: '__ENVY_FROM_ENV__',
        method: 'envconfig' as any,
        file: filePath,
        line: pos.line,
        column: pos.column,
        context,
        hasDefault: true,
        isRequired: false,
        confidence: 0.8,
      }));
    }

    // Pattern: envy::prefixed("PREFIX_")
    const prefixedPattern = /envy::prefixed\s*\(\s*"([A-Z_][A-Z0-9_]*)"\s*\)/g;
    
    while ((match = prefixedPattern.exec(source)) !== null) {
      const prefix = match[1];
      if (!prefix) {continue;}
      
      const pos = this.getPosition(source, match.index);
      const context = this.getContext(source, match.index);
      
      result.accessPoints.push(this.createAccessPoint({
        varName: `${prefix}*`,
        method: 'envconfig' as any,
        file: filePath,
        line: pos.line,
        column: pos.column,
        context,
        hasDefault: true,
        isRequired: false,
        confidence: 0.8,
      }));
    }

    // Pattern: #[serde(rename = "VAR_NAME")] or #[envconfig(from = "VAR_NAME")]
    const attrPattern = /#\[(?:serde\s*\(\s*rename\s*=|envconfig\s*\(\s*from\s*=)\s*"([A-Z_][A-Z0-9_]*)"\s*\)\]/g;
    
    while ((match = attrPattern.exec(source)) !== null) {
      const varName = match[1];
      if (!varName) {continue;}
      
      const pos = this.getPosition(source, match.index);
      const context = this.getContext(source, match.index);
      
      result.accessPoints.push(this.createAccessPoint({
        varName,
        method: 'envconfig' as any,
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
   * Detect if a default value is provided
   */
  private detectDefault(source: string, matchIndex: number, matchLength: number): {
    hasDefault: boolean;
    defaultValue?: string | undefined;
  } {
    const afterMatch = source.slice(matchIndex + matchLength, matchIndex + matchLength + 150);
    
    // Check for .unwrap_or("default") pattern
    const unwrapOrMatch = afterMatch.match(/^\s*\)\s*\.unwrap_or\s*\(\s*"([^"]*)"/);
    if (unwrapOrMatch) {
      return { hasDefault: true, defaultValue: unwrapOrMatch[1] };
    }
    
    // Check for .unwrap_or_else(|| "default") pattern
    const unwrapOrElseMatch = afterMatch.match(/^\s*\)\s*\.unwrap_or_else\s*\(\s*\|\s*\|\s*"([^"]*)"/);
    if (unwrapOrElseMatch) {
      return { hasDefault: true, defaultValue: unwrapOrElseMatch[1] };
    }
    
    // Check for .unwrap_or_default() pattern
    if (afterMatch.match(/^\s*\)\s*\.unwrap_or_default\s*\(\s*\)/)) {
      return { hasDefault: true };
    }
    
    // Check for .ok() pattern (converts to Option, implies handling)
    if (afterMatch.match(/^\s*\)\s*\.ok\s*\(\s*\)/)) {
      return { hasDefault: true };
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
 * Create a Rust environment extractor
 */
export function createRustEnvExtractor(): RustEnvExtractor {
  return new RustEnvExtractor();
}
