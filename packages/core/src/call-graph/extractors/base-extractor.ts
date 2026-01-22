/**
 * Base Call Graph Extractor
 *
 * Abstract base class for language-specific extractors.
 * Provides common utilities and defines the extraction interface.
 */

import type {
  CallGraphLanguage,
  FileExtractionResult,
  FunctionExtraction,
  CallExtraction,
  ImportExtraction,
  ExportExtraction,
  ClassExtraction,
  ParameterInfo,
} from '../types.js';

/**
 * Abstract base class for call graph extractors
 */
export abstract class BaseCallGraphExtractor {
  /** Language this extractor handles */
  abstract readonly language: CallGraphLanguage;

  /** File extensions this extractor handles */
  abstract readonly extensions: string[];

  /**
   * Extract functions, calls, imports, and exports from source code
   */
  abstract extract(source: string, filePath: string): FileExtractionResult;

  /**
   * Check if this extractor can handle a file
   */
  canHandle(filePath: string): boolean {
    const ext = this.getExtension(filePath);
    return this.extensions.includes(ext);
  }

  /**
   * Get file extension
   */
  protected getExtension(filePath: string): string {
    const lastDot = filePath.lastIndexOf('.');
    return lastDot >= 0 ? filePath.slice(lastDot) : '';
  }

  /**
   * Generate a unique function ID
   */
  protected generateFunctionId(file: string, name: string, line: number): string {
    return `${file}:${name}:${line}`;
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
    returnType?: string | undefined;
    isMethod?: boolean;
    isStatic?: boolean;
    isExported?: boolean;
    isConstructor?: boolean;
    isAsync?: boolean;
    className?: string | undefined;
    moduleName?: string | undefined;
    decorators?: string[];
    bodyStartLine?: number;
    bodyEndLine?: number;
  }): FunctionExtraction {
    // Use provided qualifiedName or compute from className/moduleName
    const qualifiedName = opts.qualifiedName ?? (
      opts.className
        ? `${opts.className}.${opts.name}`
        : opts.moduleName
          ? `${opts.moduleName}.${opts.name}`
          : opts.name
    );

    return {
      name: opts.name,
      qualifiedName,
      startLine: opts.startLine,
      endLine: opts.endLine,
      startColumn: opts.startColumn ?? 0,
      endColumn: opts.endColumn ?? 0,
      parameters: opts.parameters ?? [],
      returnType: opts.returnType,
      isMethod: opts.isMethod ?? false,
      isStatic: opts.isStatic ?? false,
      isExported: opts.isExported ?? false,
      isConstructor: opts.isConstructor ?? false,
      isAsync: opts.isAsync ?? false,
      className: opts.className,
      moduleName: opts.moduleName,
      decorators: opts.decorators ?? [],
      bodyStartLine: opts.bodyStartLine ?? opts.startLine,
      bodyEndLine: opts.bodyEndLine ?? opts.endLine,
    };
  }

  /**
   * Create a call extraction
   */
  protected createCall(opts: {
    calleeName: string;
    receiver?: string | undefined;
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
    source?: string | undefined;
    line: number;
  }): ExportExtraction {
    return {
      name: opts.name,
      isDefault: opts.isDefault ?? false,
      isReExport: opts.isReExport ?? false,
      source: opts.source,
      line: opts.line,
    };
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

  /**
   * Parse parameter string into ParameterInfo
   */
  protected parseParameter(
    name: string,
    type?: string,
    hasDefault = false,
    isRest = false
  ): ParameterInfo {
    return { name, type, hasDefault, isRest };
  }
}
