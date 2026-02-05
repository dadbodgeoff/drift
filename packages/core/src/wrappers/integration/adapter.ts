/**
 * Call Graph to Wrapper Detection Adapter
 *
 * Bridges the call graph infrastructure with wrapper detection.
 * Converts FileExtractionResult to DiscoveryContext and DetectionContext.
 */

import { minimatch } from 'minimatch';

import type {
  FileExtractionResult,
  FunctionExtraction,
  CallExtraction,
  ImportExtraction,
  CallGraphLanguage,
} from '../../call-graph/types.js';
import type {
  FunctionInfo,
  ParameterInfo,
  CallInfo,
  DetectionContext,
} from '../detection/detector.js';
import type {
  ImportInfo,
  DecoratorUsage,
  FunctionUsage,
  DiscoveryContext,
} from '../primitives/discovery.js';
import type {
  SupportedLanguage,
  DetectedPrimitive,
} from '../types.js';

// =============================================================================
// Language Mapping
// =============================================================================

/**
 * Map call graph language to wrapper supported language
 */
export function mapLanguage(lang: CallGraphLanguage): SupportedLanguage | null {
  const mapping: Record<CallGraphLanguage, SupportedLanguage | null> = {
    typescript: 'typescript',
    javascript: 'typescript', // Treat JS as TS for wrapper detection
    python: 'python',
    java: 'java',
    csharp: 'csharp',
    php: 'php',
    go: null, // Go wrapper detection not yet implemented
    rust: 'rust',
    cpp: 'cpp',
    'structured-text': null, // ST wrapper detection not yet implemented
  };
  return mapping[lang];
}

// =============================================================================
// Function Conversion
// =============================================================================

/**
 * Convert FunctionExtraction to FunctionInfo for wrapper detection
 */
export function convertFunction(
  func: FunctionExtraction,
  file: string,
  language: SupportedLanguage,
  calls: CallExtraction[]
): FunctionInfo {
  // Filter calls that belong to this function (by line range)
  const functionCalls = calls.filter(
    (c) => c.line >= func.startLine && c.line <= func.endLine
  );

  return {
    name: func.name,
    qualifiedName: func.qualifiedName,
    file,
    startLine: func.startLine,
    endLine: func.endLine,
    language,
    isAsync: func.isAsync,
    returnType: func.returnType,
    parameters: func.parameters.map((p) => convertParameter(p)),
    decorators: func.decorators,
    calls: functionCalls.map(convertCall),
  };
}

/**
 * Convert parameter info
 */
function convertParameter(param: { name: string; type?: string | undefined; hasDefault: boolean }): ParameterInfo {
  return {
    name: param.name,
    type: param.type,
    defaultValue: param.hasDefault ? 'default' : undefined,
  };
}

/**
 * Convert call extraction to call info
 */
function convertCall(call: CallExtraction): CallInfo {
  return {
    calleeName: call.calleeName,
    calleeQualifiedName: call.receiver
      ? `${call.receiver}.${call.calleeName}`
      : call.calleeName,
    line: call.line,
    isCallback: false, // Could be enhanced with more analysis
  };
}

// =============================================================================
// Import Conversion
// =============================================================================

/**
 * Convert ImportExtraction to ImportInfo for primitive discovery
 */
export function convertImport(imp: ImportExtraction): ImportInfo {
  return {
    source: imp.source,
    names: imp.names.map((n) => ({
      imported: n.imported,
      local: n.local,
      isDefault: n.isDefault,
    })),
    line: imp.line,
    isTypeOnly: imp.isTypeOnly,
  };
}

// =============================================================================
// Context Builders
// =============================================================================

/**
 * Build DiscoveryContext from FileExtractionResult(s)
 */
export function buildDiscoveryContext(
  extractions: FileExtractionResult[],
  language: SupportedLanguage
): DiscoveryContext {
  const imports: ImportInfo[] = [];
  const decorators: DecoratorUsage[] = [];
  const functionUsages: FunctionUsage[] = [];

  for (const extraction of extractions) {
    // Collect imports
    for (const imp of extraction.imports) {
      imports.push(convertImport(imp));
    }

    // Collect decorators from functions
    for (const func of extraction.functions) {
      for (const decorator of func.decorators) {
        decorators.push({
          name: decorator,
          file: extraction.file,
          line: func.startLine,
        });
      }
    }

    // Collect function usages (calls)
    for (const call of extraction.calls) {
      functionUsages.push({
        name: call.calleeName,
        file: extraction.file,
        line: call.line,
        isMethodCall: call.isMethodCall,
        receiver: call.receiver,
      });
    }
  }

  return {
    imports,
    decorators,
    functionUsages,
    language,
  };
}

/**
 * Build DetectionContext from FileExtractionResult(s)
 */
export function buildDetectionContext(
  extractions: FileExtractionResult[],
  primitives: DetectedPrimitive[],
  language: SupportedLanguage
): DetectionContext {
  const functions: FunctionInfo[] = [];

  for (const extraction of extractions) {
    const mappedLang = mapLanguage(extraction.language);
    if (!mappedLang) {continue;}

    for (const func of extraction.functions) {
      functions.push(
        convertFunction(func, extraction.file, mappedLang, extraction.calls)
      );
    }
  }

  return {
    functions,
    primitives,
    language,
  };
}

// =============================================================================
// Batch Processing
// =============================================================================

export interface AdapterOptions {
  /** Include test files in analysis */
  includeTestFiles?: boolean | undefined;
  /** Filter to specific file patterns */
  filePatterns?: string[] | undefined;
}

/**
 * Filter extractions based on options
 */
export function filterExtractions(
  extractions: FileExtractionResult[],
  options: AdapterOptions = {}
): FileExtractionResult[] {
  let filtered = extractions;

  // Filter test files if requested
  if (!options.includeTestFiles) {
    filtered = filtered.filter((e) => !isTestFile(e.file));
  }

  // Filter by file patterns if specified
  if (options.filePatterns && options.filePatterns.length > 0) {
    filtered = filtered.filter((e) =>
      options.filePatterns!.some((pattern) => matchesPattern(e.file, pattern))
    );
  }

  return filtered;
}

/**
 * Check if file is a test file
 */
function isTestFile(filePath: string): boolean {
  const testPatterns = [
    /\.test\.[jt]sx?$/,
    /\.spec\.[jt]sx?$/,
    /_test\.(py|go|java|cs|php)$/,
    /Test\.(java|cs)$/,
    /Tests?\//,
    /__tests__\//,
    /test_.*\.py$/,
  ];

  return testPatterns.some((pattern) => pattern.test(filePath));
}

/**
 * Simple glob-like pattern matching using minimatch
 */
function matchesPattern(filePath: string, pattern: string): boolean {
  return minimatch(filePath, pattern);
}

// =============================================================================
// Statistics
// =============================================================================

export interface ExtractionStats {
  totalFiles: number;
  totalFunctions: number;
  totalCalls: number;
  totalImports: number;
  byLanguage: Record<string, number>;
}

/**
 * Calculate statistics from extractions
 */
export function calculateExtractionStats(
  extractions: FileExtractionResult[]
): ExtractionStats {
  const byLanguage: Record<string, number> = {};

  let totalFunctions = 0;
  let totalCalls = 0;
  let totalImports = 0;

  for (const extraction of extractions) {
    totalFunctions += extraction.functions.length;
    totalCalls += extraction.calls.length;
    totalImports += extraction.imports.length;

    byLanguage[extraction.language] = (byLanguage[extraction.language] || 0) + 1;
  }

  return {
    totalFiles: extractions.length,
    totalFunctions,
    totalCalls,
    totalImports,
    byLanguage,
  };
}
