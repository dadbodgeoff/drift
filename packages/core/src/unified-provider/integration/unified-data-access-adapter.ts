/**
 * Unified Data Access Adapter
 *
 * Bridges the UnifiedLanguageProvider with the existing SemanticDataAccessScanner
 * and CallGraphAnalyzer systems. This adapter converts between the unified
 * extraction format and the legacy DataAccessPoint format.
 */

import { UnifiedLanguageProvider, createUnifiedProvider } from '../provider/unified-language-provider.js';

import type { DataAccessPoint } from '../../boundaries/types.js';
import type { FileExtractionResult, FunctionExtraction, CallExtraction, ImportExtraction, ExportExtraction, ClassExtraction, CallGraphLanguage } from '../../call-graph/types.js';
import type { UnifiedExtractionResult, UnifiedDataAccess, UnifiedFunction, UnifiedClass, UnifiedImport, UnifiedExport, UnifiedLanguage } from '../types.js';

/**
 * Convert UnifiedLanguage to CallGraphLanguage
 */
function toCallGraphLanguage(lang: UnifiedLanguage): CallGraphLanguage {
  return lang as CallGraphLanguage;
}

/**
 * Convert UnifiedDataAccess to DataAccessPoint
 */
export function toDataAccessPoint(access: UnifiedDataAccess): DataAccessPoint {
  return {
    id: access.id,
    table: access.table,
    fields: access.fields,
    operation: access.operation,
    file: access.file,
    line: access.line,
    column: access.column,
    context: access.context,
    isRawSql: access.isRawSql,
    confidence: access.confidence,
  };
}

/**
 * Convert UnifiedFunction to FunctionExtraction
 */
export function toFunctionExtraction(func: UnifiedFunction): FunctionExtraction {
  return {
    name: func.name,
    qualifiedName: func.qualifiedName,
    startLine: func.startLine,
    endLine: func.endLine,
    startColumn: func.startColumn,
    endColumn: func.endColumn,
    parameters: func.parameters.map(p => ({
      name: p.name,
      type: p.type,
      hasDefault: p.hasDefault,
      isRest: p.isRest,
    })),
    returnType: func.returnType,
    isMethod: func.isMethod,
    isStatic: func.isStatic,
    isExported: func.isExported,
    isConstructor: func.isConstructor,
    isAsync: func.isAsync,
    className: func.className,
    decorators: func.decorators,
    bodyStartLine: func.bodyStartLine,
    bodyEndLine: func.bodyEndLine,
  };
}

/**
 * Convert UnifiedClass to ClassExtraction
 */
export function toClassExtraction(cls: UnifiedClass): ClassExtraction {
  return {
    name: cls.name,
    startLine: cls.startLine,
    endLine: cls.endLine,
    baseClasses: cls.baseClasses,
    methods: cls.methods,
    isExported: cls.isExported,
  };
}

/**
 * Convert UnifiedImport to ImportExtraction
 */
export function toImportExtraction(imp: UnifiedImport): ImportExtraction {
  return {
    source: imp.source,
    names: imp.names.map(n => ({
      imported: n.imported,
      local: n.local,
      isDefault: n.isDefault,
      isNamespace: n.isNamespace,
    })),
    line: imp.line,
    isTypeOnly: imp.isTypeOnly,
  };
}

/**
 * Convert UnifiedExport to ExportExtraction
 */
export function toExportExtraction(exp: UnifiedExport): ExportExtraction {
  return {
    name: exp.name,
    isDefault: exp.isDefault,
    isReExport: exp.isReExport,
    source: exp.source,
    line: exp.line,
  };
}

/**
 * Convert UnifiedExtractionResult to FileExtractionResult
 */
export function toFileExtractionResult(result: UnifiedExtractionResult): FileExtractionResult {
  // Extract calls from call chains
  const calls: CallExtraction[] = [];
  for (const chain of result.callChains) {
    // Each call chain represents a series of method calls
    // We extract individual calls from the chain
    for (let i = 0; i < chain.segments.length; i++) {
      const segment = chain.segments[i];
      if (!segment) {continue;}
      
      if (segment.isCall) {
        const prevSegment = i > 0 ? chain.segments[i - 1] : undefined;
        const receiver = i === 0 ? chain.receiver : prevSegment?.name;
        calls.push({
          calleeName: segment.name,
          receiver,
          fullExpression: chain.fullExpression,
          line: segment.line,
          column: segment.column,
          argumentCount: segment.args.length,
          isMethodCall: i > 0 || !!chain.receiver,
          isConstructorCall: false,
        });
      }
    }
  }

  return {
    file: result.file,
    language: toCallGraphLanguage(result.language),
    functions: result.functions.map(toFunctionExtraction),
    calls,
    imports: result.imports.map(toImportExtraction),
    exports: result.exports.map(toExportExtraction),
    classes: result.classes.map(toClassExtraction),
    errors: result.errors,
  };
}

/**
 * Unified Data Access Adapter
 *
 * Provides a drop-in replacement for the existing data access extractors
 * using the new unified language provider.
 */
export class UnifiedDataAccessAdapter {
  private provider: UnifiedLanguageProvider;

  constructor(projectRoot?: string) {
    this.provider = createUnifiedProvider({
      projectRoot,
      extractDataAccess: true,
      extractCallGraph: true,
    });
  }

  /**
   * Extract data access points from source code
   * Compatible with BaseDataAccessExtractor interface
   */
  async extract(source: string, filePath: string): Promise<{
    accessPoints: DataAccessPoint[];
    language: string;
    errors: string[];
  }> {
    const result = await this.provider.extract(source, filePath);

    return {
      accessPoints: result.dataAccess.map(toDataAccessPoint),
      language: result.language,
      errors: result.errors,
    };
  }

  /**
   * Extract full file information
   * Compatible with CallGraphExtractor interface
   */
  async extractFull(source: string, filePath: string): Promise<FileExtractionResult> {
    const result = await this.provider.extract(source, filePath);
    return toFileExtractionResult(result);
  }

  /**
   * Get the raw unified extraction result
   */
  async extractUnified(source: string, filePath: string): Promise<UnifiedExtractionResult> {
    return this.provider.extract(source, filePath);
  }

  /**
   * Check if a file can be handled
   */
  canHandle(filePath: string): boolean {
    const ext = filePath.split('.').pop()?.toLowerCase();
    const supportedExtensions = [
      'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs',  // TypeScript/JavaScript
      'py', 'pyw',                               // Python
      'java',                                    // Java
      'cs',                                      // C#
      'php', 'phtml',                            // PHP
    ];
    return ext ? supportedExtensions.includes(ext) : false;
  }

  /**
   * Get supported languages
   */
  async getSupportedLanguages(): Promise<UnifiedLanguage[]> {
    return this.provider.getSupportedLanguages();
  }
}

/**
 * Create a unified data access adapter
 */
export function createUnifiedDataAccessAdapter(projectRoot?: string): UnifiedDataAccessAdapter {
  return new UnifiedDataAccessAdapter(projectRoot);
}
