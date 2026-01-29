/**
 * Base Regex Extractor
 *
 * Abstract base class for regex-based code extraction.
 * Provides common utilities for pattern matching and result building.
 */

import {
  type ExtractionQuality,
  type LanguagePatterns,
  EXTRACTION_CONFIDENCE,
  createDefaultQuality,
} from '../types.js';

import type {
  CallGraphLanguage,
  FileExtractionResult,
  FunctionExtraction,
  CallExtraction,
  ImportExtraction,
  ExportExtraction,
  ClassExtraction,
  ParameterInfo,
} from '../../types.js';

/**
 * Abstract base class for regex-based extractors
 */
export abstract class BaseRegexExtractor {
  /** Language this extractor handles */
  abstract readonly language: CallGraphLanguage;

  /** File extensions this extractor handles */
  abstract readonly extensions: string[];

  /** Language-specific patterns */
  protected abstract readonly patterns: LanguagePatterns;

  /**
   * Extract using regex patterns
   */
  extract(source: string, filePath: string): FileExtractionResult & { quality: ExtractionQuality } {
    const startTime = performance.now();
    const result = this.createEmptyResult(filePath);
    const quality = createDefaultQuality();
    quality.method = 'regex';
    quality.confidence = EXTRACTION_CONFIDENCE.REGEX;

    try {
      // Pre-process source (remove comments, strings for cleaner matching)
      const cleanSource = this.preprocessSource(source);

      // Extract functions
      const functions = this.extractFunctions(cleanSource, source, filePath);
      result.functions.push(...functions);

      // Extract classes
      const classes = this.extractClasses(cleanSource, source, filePath);
      result.classes.push(...classes);

      // Extract imports
      const imports = this.extractImports(cleanSource, source, filePath);
      result.imports.push(...imports);

      // Extract exports
      const exports = this.extractExports(cleanSource, source, filePath);
      result.exports.push(...exports);

      // Extract calls
      const calls = this.extractCalls(cleanSource, source, filePath);
      result.calls.push(...calls);

      // Calculate quality metrics
      quality.itemsExtracted =
        result.functions.length +
        result.classes.length +
        result.imports.length +
        result.exports.length +
        result.calls.length;

      quality.coveragePercent = this.estimateCoverage(source, result);

    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown regex extraction error';
      result.errors.push(message);
      quality.parseErrors++;
      quality.confidence = EXTRACTION_CONFIDENCE.UNKNOWN;
    }

    quality.extractionTimeMs = performance.now() - startTime;

    return { ...result, quality };
  }

  /**
   * Check if this extractor can handle a file
   */
  canHandle(filePath: string): boolean {
    const ext = this.getExtension(filePath);
    return this.extensions.includes(ext);
  }

  // ===========================================================================
  // Abstract Methods (Language-Specific)
  // ===========================================================================

  /**
   * Extract functions using regex
   */
  protected abstract extractFunctions(
    cleanSource: string,
    originalSource: string,
    filePath: string
  ): FunctionExtraction[];

  /**
   * Extract classes using regex
   */
  protected abstract extractClasses(
    cleanSource: string,
    originalSource: string,
    filePath: string
  ): ClassExtraction[];

  /**
   * Extract imports using regex
   */
  protected abstract extractImports(
    cleanSource: string,
    originalSource: string,
    filePath: string
  ): ImportExtraction[];

  /**
   * Extract exports using regex
   */
  protected abstract extractExports(
    cleanSource: string,
    originalSource: string,
    filePath: string
  ): ExportExtraction[];

  /**
   * Extract calls using regex
   */
  protected abstract extractCalls(
    cleanSource: string,
    originalSource: string,
    filePath: string
  ): CallExtraction[];

  // ===========================================================================
  // Common Utilities
  // ===========================================================================

  /**
   * Preprocess source to remove comments and strings for cleaner matching
   */
  protected preprocessSource(source: string): string {
    // Remove multi-line comments
    let clean = source.replace(/\/\*[\s\S]*?\*\//g, (match) => ' '.repeat(match.length));

    // Remove single-line comments (but preserve line structure)
    clean = clean.replace(/\/\/.*$/gm, (match) => ' '.repeat(match.length));

    // Remove strings (but preserve line structure)
    clean = clean.replace(/"(?:[^"\\]|\\.)*"/g, (match) => '"' + ' '.repeat(match.length - 2) + '"');
    clean = clean.replace(/'(?:[^'\\]|\\.)*'/g, (match) => "'" + ' '.repeat(match.length - 2) + "'");
    clean = clean.replace(/`(?:[^`\\]|\\.)*`/g, (match) => '`' + ' '.repeat(match.length - 2) + '`');

    return clean;
  }

  /**
   * Get line number from character index
   */
  protected getLineNumber(source: string, index: number): number {
    return source.slice(0, index).split('\n').length;
  }

  /**
   * Get column number from character index
   */
  protected getColumnNumber(source: string, index: number): number {
    const lastNewline = source.lastIndexOf('\n', index - 1);
    return index - lastNewline - 1;
  }

  /**
   * Parse parameter string into ParameterInfo array
   */
  protected parseParameters(paramString: string): ParameterInfo[] {
    if (!paramString?.trim()) {return [];}

    const params: ParameterInfo[] = [];
    let depth = 0;
    let current = '';
    let inString = false;
    let stringChar = '';

    for (const char of paramString) {
      if (!inString && (char === '"' || char === "'" || char === '`')) {
        inString = true;
        stringChar = char;
        current += char;
      } else if (inString && char === stringChar) {
        inString = false;
        current += char;
      } else if (!inString && (char === '<' || char === '(' || char === '[' || char === '{')) {
        depth++;
        current += char;
      } else if (!inString && (char === '>' || char === ')' || char === ']' || char === '}')) {
        depth--;
        current += char;
      } else if (!inString && char === ',' && depth === 0) {
        const param = this.parseParameter(current.trim());
        if (param) {params.push(param);}
        current = '';
      } else {
        current += char;
      }
    }

    if (current.trim()) {
      const param = this.parseParameter(current.trim());
      if (param) {params.push(param);}
    }

    return params;
  }

  /**
   * Parse a single parameter
   */
  protected parseParameter(paramStr: string): ParameterInfo | null {
    if (!paramStr) {return null;}

    // Handle rest parameters
    const isRest = paramStr.startsWith('...');
    if (isRest) {paramStr = paramStr.slice(3);}

    // Handle default values
    const hasDefault = paramStr.includes('=');
    if (hasDefault) {
      paramStr = paramStr.split('=')[0]!.trim();
    }

    // Handle type annotations (TypeScript style)
    let name = paramStr;
    let type: string | undefined;

    const colonIndex = paramStr.indexOf(':');
    if (colonIndex > 0) {
      name = paramStr.slice(0, colonIndex).trim();
      type = paramStr.slice(colonIndex + 1).trim();
    }

    // Clean up name (remove optional marker, etc.)
    name = name.replace(/\?$/, '').trim();

    if (!name) {return null;}

    return { name, type, hasDefault, isRest };
  }

  /**
   * Find the end of a block (matching braces)
   */
  protected findBlockEnd(source: string, startIndex: number): number {
    let depth = 0;
    let inString = false;
    let stringChar = '';
    let foundStart = false;

    for (let i = startIndex; i < source.length; i++) {
      const char = source[i]!;
      const prevChar = i > 0 ? source[i - 1] : '';

      // Handle strings
      if (!inString && (char === '"' || char === "'" || char === '`') && prevChar !== '\\') {
        inString = true;
        stringChar = char;
        continue;
      }
      if (inString && char === stringChar && prevChar !== '\\') {
        inString = false;
        continue;
      }
      if (inString) {continue;}

      // Handle braces
      if (char === '{') {
        depth++;
        foundStart = true;
      } else if (char === '}') {
        depth--;
        if (foundStart && depth === 0) {
          return i;
        }
      }
    }

    return source.length;
  }

  /**
   * Estimate extraction coverage
   */
  protected estimateCoverage(source: string, result: FileExtractionResult): number {
    // Simple heuristic: count lines with extractions vs total lines
    const lines = source.split('\n').length;
    const extractedLines = new Set<number>();

    for (const func of result.functions) {
      for (let i = func.startLine; i <= func.endLine; i++) {
        extractedLines.add(i);
      }
    }

    for (const cls of result.classes) {
      for (let i = cls.startLine; i <= cls.endLine; i++) {
        extractedLines.add(i);
      }
    }

    // Estimate: if we found functions/classes, assume good coverage
    // If not, check for imports/exports
    if (result.functions.length > 0 || result.classes.length > 0) {
      return Math.min(100, (extractedLines.size / lines) * 100 + 20);
    }

    if (result.imports.length > 0 || result.exports.length > 0) {
      return 50;
    }

    return 25;
  }

  /**
   * Get file extension
   */
  protected getExtension(filePath: string): string {
    const lastDot = filePath.lastIndexOf('.');
    return lastDot >= 0 ? filePath.slice(lastDot) : '';
  }

  /**
   * Create an empty extraction result
   */
  protected createEmptyResult(file: string): FileExtractionResult {
    return {
      file,
      language: this.language,
      functions: [],
      calls: [],
      imports: [],
      exports: [],
      classes: [],
      errors: [],
    };
  }

  /**
   * Create a function extraction
   */
  protected createFunction(opts: {
    name: string;
    qualifiedName?: string;
    startLine: number;
    endLine: number;
    startColumn?: number;
    endColumn?: number;
    parameters?: ParameterInfo[];
    returnType?: string;
    isMethod?: boolean;
    isStatic?: boolean;
    isExported?: boolean;
    isConstructor?: boolean;
    isAsync?: boolean;
    className?: string;
    decorators?: string[];
  }): FunctionExtraction {
    const result: FunctionExtraction = {
      name: opts.name,
      qualifiedName: opts.qualifiedName ?? opts.name,
      startLine: opts.startLine,
      endLine: opts.endLine,
      startColumn: opts.startColumn ?? 0,
      endColumn: opts.endColumn ?? 0,
      parameters: opts.parameters ?? [],
      isMethod: opts.isMethod ?? false,
      isStatic: opts.isStatic ?? false,
      isExported: opts.isExported ?? false,
      isConstructor: opts.isConstructor ?? false,
      isAsync: opts.isAsync ?? false,
      decorators: opts.decorators ?? [],
      bodyStartLine: opts.startLine,
      bodyEndLine: opts.endLine,
    };
    
    // Only set optional properties if they have values
    if (opts.returnType !== undefined) {
      result.returnType = opts.returnType;
    }
    if (opts.className !== undefined) {
      result.className = opts.className;
    }
    
    return result;
  }

  /**
   * Create a call extraction
   */
  protected createCall(opts: {
    calleeName: string;
    receiver?: string;
    fullExpression?: string;
    line: number;
    column?: number;
    argumentCount?: number;
    isMethodCall?: boolean;
    isConstructorCall?: boolean;
  }): CallExtraction {
    return {
      calleeName: opts.calleeName,
      receiver: opts.receiver,
      fullExpression: opts.fullExpression ?? opts.calleeName,
      line: opts.line,
      column: opts.column ?? 0,
      argumentCount: opts.argumentCount ?? 0,
      isMethodCall: opts.isMethodCall ?? !!opts.receiver,
      isConstructorCall: opts.isConstructorCall ?? false,
    };
  }

  /**
   * Create an import extraction
   */
  protected createImport(opts: {
    source: string;
    names: Array<{
      imported: string;
      local?: string;
      isDefault?: boolean;
      isNamespace?: boolean;
    }>;
    line: number;
    isTypeOnly?: boolean;
  }): ImportExtraction {
    return {
      source: opts.source,
      names: opts.names.map((n) => ({
        imported: n.imported,
        local: n.local ?? n.imported,
        isDefault: n.isDefault ?? false,
        isNamespace: n.isNamespace ?? false,
      })),
      line: opts.line,
      isTypeOnly: opts.isTypeOnly ?? false,
    };
  }

  /**
   * Create an export extraction
   */
  protected createExport(opts: {
    name: string;
    isDefault?: boolean;
    isReExport?: boolean;
    source?: string;
    line: number;
  }): ExportExtraction {
    const result: ExportExtraction = {
      name: opts.name,
      isDefault: opts.isDefault ?? false,
      isReExport: opts.isReExport ?? false,
      line: opts.line,
    };
    
    // Only set source if it has a value
    if (opts.source !== undefined) {
      result.source = opts.source;
    }
    
    return result;
  }

  /**
   * Create a class extraction
   */
  protected createClass(opts: {
    name: string;
    startLine: number;
    endLine: number;
    baseClasses?: string[];
    methods?: string[];
    isExported?: boolean;
  }): ClassExtraction {
    return {
      name: opts.name,
      startLine: opts.startLine,
      endLine: opts.endLine,
      baseClasses: opts.baseClasses ?? [],
      methods: opts.methods ?? [],
      isExported: opts.isExported ?? false,
    };
  }
}
