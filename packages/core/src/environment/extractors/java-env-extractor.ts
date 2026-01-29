/**
 * Java Environment Variable Extractor
 *
 * Extracts environment variable access patterns from Java.
 * 
 * Supports:
 * - System.getenv("VAR_NAME")
 * - System.getProperty("VAR_NAME")
 * - @Value("${VAR_NAME}") Spring annotations
 * - @ConfigurationProperties Spring patterns
 * - Environment.getProperty() Spring patterns
 */

import { BaseEnvExtractor } from './base-env-extractor.js';

import type { EnvLanguage, EnvExtractionResult } from '../types.js';

/**
 * Java environment variable extractor
 */
export class JavaEnvExtractor extends BaseEnvExtractor {
  readonly language: EnvLanguage = 'java';
  readonly extensions: string[] = ['.java'];

  /**
   * Extract environment variable access from Java source
   */
  extract(source: string, filePath: string): EnvExtractionResult {
    const result = this.createEmptyResult(filePath);

    try {
      // Extract System.getenv patterns
      this.extractSystemGetenv(source, filePath, result);
      
      // Extract System.getProperty patterns
      this.extractSystemGetProperty(source, filePath, result);
      
      // Extract Spring @Value patterns
      this.extractSpringValue(source, filePath, result);
      
      // Extract Spring Environment patterns
      this.extractSpringEnvironment(source, filePath, result);
      
      // Extract @ConfigurationProperties patterns
      this.extractConfigurationProperties(source, filePath, result);
      
    } catch (error) {
      result.errors.push(error instanceof Error ? error.message : 'Unknown parse error');
    }

    return result;
  }

  /**
   * Extract System.getenv("VAR") patterns
   */
  private extractSystemGetenv(source: string, filePath: string, result: EnvExtractionResult): void {
    // Pattern: System.getenv("VAR_NAME")
    const pattern = /System\.getenv\(\s*"([A-Z_][A-Z0-9_]*)"\s*\)/g;
    let match;
    
    while ((match = pattern.exec(source)) !== null) {
      const varName = match[1];
      if (!varName) {continue;}
      
      const pos = this.getPosition(source, match.index);
      const context = this.getContext(source, match.index);
      const { hasDefault, defaultValue } = this.detectDefault(source, match.index, match[0].length);
      
      result.accessPoints.push(this.createAccessPoint({
        varName,
        method: 'System.getenv',
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
   * Extract System.getProperty("VAR") patterns
   */
  private extractSystemGetProperty(source: string, filePath: string, result: EnvExtractionResult): void {
    // Pattern: System.getProperty("property.name") or System.getProperty("property.name", "default")
    const pattern = /System\.getProperty\(\s*"([a-zA-Z_][a-zA-Z0-9_.]*)"(?:\s*,\s*"([^"]*)")?\s*\)/g;
    let match;
    
    while ((match = pattern.exec(source)) !== null) {
      const varName = match[1];
      if (!varName) {continue;}
      
      const pos = this.getPosition(source, match.index);
      const context = this.getContext(source, match.index);
      const defaultValue = match[2];
      const hasDefault = defaultValue !== undefined;
      
      result.accessPoints.push(this.createAccessPoint({
        varName,
        method: 'System.getProperty',
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
   * Extract Spring @Value("${VAR}") patterns
   */
  private extractSpringValue(source: string, filePath: string, result: EnvExtractionResult): void {
    // Pattern: @Value("${VAR_NAME}") or @Value("${VAR_NAME:default}")
    const pattern = /@Value\(\s*"\$\{([a-zA-Z_][a-zA-Z0-9_.]*)(?::([^}]*))?\}"\s*\)/g;
    let match;
    
    while ((match = pattern.exec(source)) !== null) {
      const varName = match[1];
      if (!varName) {continue;}
      
      const pos = this.getPosition(source, match.index);
      const context = this.getContext(source, match.index);
      const defaultValue = match[2];
      const hasDefault = defaultValue !== undefined;
      
      result.accessPoints.push(this.createAccessPoint({
        varName,
        method: '@Value',
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
   * Extract Spring Environment.getProperty patterns
   */
  private extractSpringEnvironment(source: string, filePath: string, result: EnvExtractionResult): void {
    // Pattern: environment.getProperty("VAR") or env.getProperty("VAR", "default")
    const patterns = [
      /(?:environment|env)\.getProperty\(\s*"([a-zA-Z_][a-zA-Z0-9_.]*)"(?:\s*,\s*"([^"]*)")?\s*\)/gi,
      /(?:environment|env)\.getRequiredProperty\(\s*"([a-zA-Z_][a-zA-Z0-9_.]*)"\s*\)/gi,
    ];
    
    for (const pattern of patterns) {
      let match;
      const isRequired = pattern.source.includes('Required');
      
      while ((match = pattern.exec(source)) !== null) {
        const varName = match[1];
        if (!varName) {continue;}
        
        const pos = this.getPosition(source, match.index);
        const context = this.getContext(source, match.index);
        const defaultValue = match[2];
        const hasDefault = defaultValue !== undefined && !isRequired;
        
        result.accessPoints.push(this.createAccessPoint({
          varName,
          method: 'Environment',
          file: filePath,
          line: pos.line,
          column: pos.column,
          context,
          hasDefault,
          defaultValue,
          isRequired: isRequired || !hasDefault,
          confidence: 0.9,
        }));
      }
    }
  }

  /**
   * Extract @ConfigurationProperties patterns
   */
  private extractConfigurationProperties(source: string, filePath: string, result: EnvExtractionResult): void {
    // Pattern: @ConfigurationProperties(prefix = "app.config")
    const pattern = /@ConfigurationProperties\(\s*(?:prefix\s*=\s*)?"([a-zA-Z_][a-zA-Z0-9_.]*)"\s*\)/g;
    let match;
    
    while ((match = pattern.exec(source)) !== null) {
      const prefix = match[1];
      if (!prefix) {continue;}
      
      const pos = this.getPosition(source, match.index);
      const context = this.getContext(source, match.index);
      
      result.accessPoints.push(this.createAccessPoint({
        varName: `${prefix}.*`,
        method: '@ConfigurationProperties',
        file: filePath,
        line: pos.line,
        column: pos.column,
        context,
        hasDefault: true,
        isRequired: false,
        confidence: 0.85,
      }));
    }
  }

  /**
   * Detect if a default value is provided via Optional or ternary
   */
  private detectDefault(source: string, matchIndex: number, matchLength: number): {
    hasDefault: boolean;
    defaultValue?: string | undefined;
  } {
    const afterMatch = source.slice(matchIndex + matchLength, matchIndex + matchLength + 100);
    
    // Check for Optional.ofNullable(...).orElse("default")
    const orElseMatch = afterMatch.match(/^\s*\)\s*\.orElse\(\s*"([^"]*)"\s*\)/);
    if (orElseMatch) {
      return { hasDefault: true, defaultValue: orElseMatch[1] };
    }
    
    // Check for ternary: != null ? ... : "default"
    const ternaryMatch = afterMatch.match(/^\s*!=\s*null\s*\?\s*[^:]+\s*:\s*"([^"]*)"/);
    if (ternaryMatch) {
      return { hasDefault: true, defaultValue: ternaryMatch[1] };
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
 * Create a Java environment extractor
 */
export function createJavaEnvExtractor(): JavaEnvExtractor {
  return new JavaEnvExtractor();
}
