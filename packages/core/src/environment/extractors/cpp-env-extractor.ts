/**
 * C++ Environment Variable Extractor
 *
 * Extracts environment variable access patterns from C++.
 * 
 * Supports:
 * - std::getenv("VAR_NAME")
 * - getenv("VAR_NAME") (C-style)
 * - Boost.Program_options environment
 * - Qt QProcessEnvironment
 * - Windows GetEnvironmentVariable
 */

import { BaseEnvExtractor } from './base-env-extractor.js';

import type { EnvLanguage, EnvExtractionResult } from '../types.js';

/**
 * C++ environment variable extractor
 */
export class CppEnvExtractor extends BaseEnvExtractor {
  readonly language: EnvLanguage = 'cpp' as EnvLanguage;
  readonly extensions: string[] = ['.cpp', '.cc', '.cxx', '.c++', '.hpp', '.hh', '.hxx', '.h++', '.h'];

  /**
   * Extract environment variable access from C++ source
   */
  extract(source: string, filePath: string): EnvExtractionResult {
    const result = this.createEmptyResult(filePath);

    try {
      // Extract std::getenv patterns
      this.extractStdGetenv(source, filePath, result);
      
      // Extract C-style getenv patterns
      this.extractCGetenv(source, filePath, result);
      
      // Extract Boost.Program_options patterns
      this.extractBoostEnvPatterns(source, filePath, result);
      
      // Extract Qt patterns
      this.extractQtEnvPatterns(source, filePath, result);
      
      // Extract Windows API patterns
      this.extractWindowsEnvPatterns(source, filePath, result);
      
    } catch (error) {
      result.errors.push(error instanceof Error ? error.message : 'Unknown parse error');
    }

    return result;
  }


  /**
   * Extract std::getenv("VAR") patterns
   */
  private extractStdGetenv(source: string, filePath: string, result: EnvExtractionResult): void {
    // Pattern: std::getenv("VAR_NAME")
    const pattern = /std::getenv\s*\(\s*"([A-Z_][A-Z0-9_]*)"\s*\)/g;
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
   * Extract C-style getenv("VAR") patterns
   */
  private extractCGetenv(source: string, filePath: string, result: EnvExtractionResult): void {
    // Pattern: getenv("VAR_NAME") - but not std::getenv
    const pattern = /(?<!std::)getenv\s*\(\s*"([A-Z_][A-Z0-9_]*)"\s*\)/g;
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
        confidence: 0.9,
      }));
    }
  }

  /**
   * Extract Boost.Program_options environment patterns
   */
  private extractBoostEnvPatterns(source: string, filePath: string, result: EnvExtractionResult): void {
    // Pattern: environment_iterator or environment variables in options
    const envIterPattern = /boost::this_process::environment\s*\(\s*\)/g;
    let match;
    
    while ((match = envIterPattern.exec(source)) !== null) {
      const pos = this.getPosition(source, match.index);
      const context = this.getContext(source, match.index);
      
      result.accessPoints.push(this.createAccessPoint({
        varName: '__BOOST_ENV_ITER__',
        method: 'config' as any,
        file: filePath,
        line: pos.line,
        column: pos.column,
        context,
        hasDefault: true,
        isRequired: false,
        confidence: 0.7,
      }));
    }

    // Pattern: env["VAR_NAME"]
    const envAccessPattern = /env\s*\[\s*"([A-Z_][A-Z0-9_]*)"\s*\]/g;
    
    while ((match = envAccessPattern.exec(source)) !== null) {
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

  /**
   * Extract Qt QProcessEnvironment patterns
   */
  private extractQtEnvPatterns(source: string, filePath: string, result: EnvExtractionResult): void {
    // Pattern: QProcessEnvironment::systemEnvironment().value("VAR")
    const qEnvValuePattern = /QProcessEnvironment[^.]*\.value\s*\(\s*"([A-Z_][A-Z0-9_]*)"/g;
    let match;
    
    while ((match = qEnvValuePattern.exec(source)) !== null) {
      const varName = match[1];
      if (!varName) {continue;}
      
      const pos = this.getPosition(source, match.index);
      const context = this.getContext(source, match.index);
      
      // Check for default value in second argument
      const afterMatch = source.slice(match.index + match[0].length, match.index + match[0].length + 50);
      const hasDefault = afterMatch.match(/^\s*,\s*"([^"]*)"/);
      
      result.accessPoints.push(this.createAccessPoint({
        varName,
        method: 'config' as any,
        file: filePath,
        line: pos.line,
        column: pos.column,
        context,
        hasDefault: !!hasDefault,
        defaultValue: hasDefault?.[1],
        isRequired: !hasDefault,
        confidence: 0.9,
      }));
    }

    // Pattern: qgetenv("VAR")
    const qgetenvPattern = /qgetenv\s*\(\s*"([A-Z_][A-Z0-9_]*)"\s*\)/g;
    
    while ((match = qgetenvPattern.exec(source)) !== null) {
      const varName = match[1];
      if (!varName) {continue;}
      
      const pos = this.getPosition(source, match.index);
      const context = this.getContext(source, match.index);
      
      result.accessPoints.push(this.createAccessPoint({
        varName,
        method: 'os.Getenv',
        file: filePath,
        line: pos.line,
        column: pos.column,
        context,
        hasDefault: false,
        isRequired: true,
        confidence: 0.9,
      }));
    }

    // Pattern: qEnvironmentVariable("VAR")
    const qEnvVarPattern = /qEnvironmentVariable\s*\(\s*"([A-Z_][A-Z0-9_]*)"/g;
    
    while ((match = qEnvVarPattern.exec(source)) !== null) {
      const varName = match[1];
      if (!varName) {continue;}
      
      const pos = this.getPosition(source, match.index);
      const context = this.getContext(source, match.index);
      
      result.accessPoints.push(this.createAccessPoint({
        varName,
        method: 'os.Getenv',
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

  /**
   * Extract Windows API environment patterns
   */
  private extractWindowsEnvPatterns(source: string, filePath: string, result: EnvExtractionResult): void {
    // Pattern: GetEnvironmentVariable("VAR", ...)
    const getEnvVarPattern = /GetEnvironmentVariable[AW]?\s*\(\s*(?:TEXT\s*\(\s*)?"([A-Z_][A-Z0-9_]*)"/g;
    let match;
    
    while ((match = getEnvVarPattern.exec(source)) !== null) {
      const varName = match[1];
      if (!varName) {continue;}
      
      const pos = this.getPosition(source, match.index);
      const context = this.getContext(source, match.index);
      
      result.accessPoints.push(this.createAccessPoint({
        varName,
        method: 'os.Getenv',
        file: filePath,
        line: pos.line,
        column: pos.column,
        context,
        hasDefault: false,
        isRequired: true,
        confidence: 0.9,
      }));
    }

    // Pattern: _wgetenv(L"VAR") or _tgetenv
    const wgetenvPattern = /_[wt]?getenv\s*\(\s*(?:L|_T\s*\(\s*)?"([A-Z_][A-Z0-9_]*)"/g;
    
    while ((match = wgetenvPattern.exec(source)) !== null) {
      const varName = match[1];
      if (!varName) {continue;}
      
      const pos = this.getPosition(source, match.index);
      const context = this.getContext(source, match.index);
      
      result.accessPoints.push(this.createAccessPoint({
        varName,
        method: 'os.Getenv',
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

  /**
   * Detect if a default value is provided
   */
  private detectDefault(source: string, matchIndex: number, matchLength: number): {
    hasDefault: boolean;
    defaultValue?: string | undefined;
  } {
    const afterMatch = source.slice(matchIndex + matchLength, matchIndex + matchLength + 150);
    
    // Check for ternary operator: getenv("VAR") ? getenv("VAR") : "default"
    const ternaryMatch = afterMatch.match(/^\s*\?\s*[^:]+:\s*"([^"]*)"/);
    if (ternaryMatch) {
      return { hasDefault: true, defaultValue: ternaryMatch[1] };
    }
    
    // Check for null check with default: if (env) ... else "default"
    // This is harder to detect reliably, so we check for common patterns
    
    // Check for || "default" pattern (less common in C++ but possible)
    const orMatch = afterMatch.match(/^\s*\|\|\s*"([^"]*)"/);
    if (orMatch) {
      return { hasDefault: true, defaultValue: orMatch[1] };
    }
    
    // Check for != nullptr check (implies handling)
    if (afterMatch.match(/^\s*!=\s*nullptr/) || afterMatch.match(/^\s*!=\s*NULL/)) {
      return { hasDefault: true };
    }
    
    // Check for if (result) pattern
    if (afterMatch.match(/^\s*\)\s*\{/) || afterMatch.match(/^\s*;\s*if\s*\(/)) {
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
 * Create a C++ environment extractor
 */
export function createCppEnvExtractor(): CppEnvExtractor {
  return new CppEnvExtractor();
}
