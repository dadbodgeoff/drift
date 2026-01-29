/**
 * TypeScript/JavaScript Regex Extractor
 *
 * Regex-based fallback extractor for TypeScript/JavaScript when tree-sitter
 * or the TypeScript compiler API is unavailable.
 */

import { BaseRegexExtractor } from './base-regex-extractor.js';

import type {
  CallGraphLanguage,
  FunctionExtraction,
  CallExtraction,
  ImportExtraction,
  ExportExtraction,
  ClassExtraction,
} from '../../types.js';
import type { LanguagePatterns } from '../types.js';

/**
 * TypeScript/JavaScript regex patterns
 */
const TS_PATTERNS: LanguagePatterns = {
  language: 'typescript',
  functions: [],
  classes: [],
  imports: [],
  exports: [],
  calls: [],
};

/**
 * TypeScript/JavaScript regex-based extractor
 */
export class TypeScriptRegexExtractor extends BaseRegexExtractor {
  readonly language: CallGraphLanguage = 'typescript';
  readonly extensions: string[] = ['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs'];
  protected readonly patterns = TS_PATTERNS;

  // ==========================================================================
  // Function Extraction
  // ==========================================================================

  protected extractFunctions(
    cleanSource: string,
    originalSource: string,
    _filePath: string
  ): FunctionExtraction[] {
    const functions: FunctionExtraction[] = [];
    const seen = new Set<string>();

    // Pattern 1: Function declarations
    // function name(...) { ... }
    // async function name(...) { ... }
    // export function name(...) { ... }
    const funcDeclPattern = /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*(?:<[^>]*>)?\s*\(([^)]*)\)\s*(?::\s*([^{]+))?\s*\{/g;
    let match;

    while ((match = funcDeclPattern.exec(cleanSource)) !== null) {
      const name = match[1]!;
      const key = `func:${name}:${this.getLineNumber(originalSource, match.index)}`;
      if (seen.has(key)) {continue;}
      seen.add(key);

      const startLine = this.getLineNumber(originalSource, match.index);
      const endIndex = this.findBlockEnd(cleanSource, match.index);
      const endLine = this.getLineNumber(originalSource, endIndex);
      const isExported = match[0].startsWith('export');
      const isAsync = match[0].includes('async');
      const params = this.parseParameters(match[2] || '');
      const returnType = match[3]?.trim();

      const funcOpts: Parameters<typeof this.createFunction>[0] = {
        name,
        startLine,
        endLine,
        parameters: params,
        isExported,
        isAsync,
      };
      if (returnType) {funcOpts.returnType = returnType;}

      functions.push(this.createFunction(funcOpts));
    }

    // Pattern 2: Arrow functions assigned to variables
    // const name = (...) => { ... }
    // export const name = async (...) => { ... }
    const arrowPattern = /(?:export\s+)?(?:const|let|var)\s+(\w+)\s*(?::\s*[^=]+)?\s*=\s*(?:async\s+)?\([^)]*\)\s*(?::\s*[^=]+)?\s*=>/g;

    while ((match = arrowPattern.exec(cleanSource)) !== null) {
      const name = match[1]!;
      const key = `arrow:${name}:${this.getLineNumber(originalSource, match.index)}`;
      if (seen.has(key)) {continue;}
      seen.add(key);

      const startLine = this.getLineNumber(originalSource, match.index);
      // Find the end - could be block or expression
      let endIndex = match.index + match[0].length;
      const afterArrow = cleanSource.slice(endIndex);
      if (afterArrow.trimStart().startsWith('{')) {
        endIndex = this.findBlockEnd(cleanSource, endIndex);
      } else {
        // Expression body - find semicolon or newline
        const semiIndex = cleanSource.indexOf(';', endIndex);
        endIndex = semiIndex > 0 ? semiIndex : endIndex + 100;
      }
      const endLine = this.getLineNumber(originalSource, endIndex);
      const isExported = match[0].startsWith('export');
      const isAsync = match[0].includes('async');

      functions.push(this.createFunction({
        name,
        startLine,
        endLine,
        isExported,
        isAsync,
      }));
    }

    // Pattern 3: Arrow functions with single parameter (no parens)
    // const name = x => ...
    const singleParamArrowPattern = /(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(\w+)\s*=>/g;

    while ((match = singleParamArrowPattern.exec(cleanSource)) !== null) {
      const name = match[1]!;
      const key = `arrow-single:${name}:${this.getLineNumber(originalSource, match.index)}`;
      if (seen.has(key)) {continue;}
      seen.add(key);

      const startLine = this.getLineNumber(originalSource, match.index);
      const endLine = startLine + 5; // Estimate
      const isExported = match[0].startsWith('export');
      const isAsync = match[0].includes('async');
      const paramName = match[2]!;

      functions.push(this.createFunction({
        name,
        startLine,
        endLine,
        parameters: [{ name: paramName, hasDefault: false, isRest: false }],
        isExported,
        isAsync,
      }));
    }

    return functions;
  }

  // ==========================================================================
  // Class Extraction
  // ==========================================================================

  protected extractClasses(
    cleanSource: string,
    originalSource: string,
    _filePath: string
  ): ClassExtraction[] {
    const classes: ClassExtraction[] = [];

    // Pattern: class Name extends Base implements Interface { ... }
    const classPattern = /(?:export\s+)?(?:abstract\s+)?class\s+(\w+)(?:\s+extends\s+(\w+))?(?:\s+implements\s+([^{]+))?\s*\{/g;
    let match;

    while ((match = classPattern.exec(cleanSource)) !== null) {
      const name = match[1]!;
      const startLine = this.getLineNumber(originalSource, match.index);
      const endIndex = this.findBlockEnd(cleanSource, match.index);
      const endLine = this.getLineNumber(originalSource, endIndex);
      const isExported = match[0].startsWith('export');

      const baseClasses: string[] = [];
      if (match[2]) {baseClasses.push(match[2]);}

      // Extract method names from class body
      const classBody = cleanSource.slice(match.index, endIndex);
      const methods = this.extractMethodNames(classBody);

      classes.push(this.createClass({
        name,
        startLine,
        endLine,
        baseClasses,
        methods,
        isExported,
      }));
    }

    return classes;
  }

  /**
   * Extract method names from a class body
   */
  private extractMethodNames(classBody: string): string[] {
    const methods: string[] = [];
    
    // Method pattern: name(...) { or async name(...) {
    const methodPattern = /(?:public|private|protected|static|async|readonly|\s)*(\w+)\s*\([^)]*\)\s*(?::\s*[^{]+)?\s*\{/g;
    let match;

    while ((match = methodPattern.exec(classBody)) !== null) {
      const name = match[1]!;
      if (name !== 'if' && name !== 'for' && name !== 'while' && name !== 'switch') {
        methods.push(name);
      }
    }

    return methods;
  }

  // ==========================================================================
  // Import Extraction
  // ==========================================================================

  protected extractImports(
    _cleanSource: string,
    originalSource: string,
    _filePath: string
  ): ImportExtraction[] {
    const imports: ImportExtraction[] = [];

    // Use originalSource for imports since we need the string values
    // Pattern 1: import { a, b } from 'module'
    const namedImportPattern = /import\s+(?:type\s+)?\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/g;
    let match;

    while ((match = namedImportPattern.exec(originalSource)) !== null) {
      const namesStr = match[1]!;
      const source = match[2]!;
      const line = this.getLineNumber(originalSource, match.index);
      const isTypeOnly = match[0].includes('import type');

      const names = namesStr.split(',').map(n => {
        const parts = n.trim().split(/\s+as\s+/);
        return {
          imported: parts[0]!.trim(),
          local: (parts[1] || parts[0])!.trim(),
          isDefault: false,
          isNamespace: false,
        };
      }).filter(n => n.imported);

      imports.push(this.createImport({ source, names, line, isTypeOnly }));
    }

    // Pattern 2: import name from 'module' (default import)
    const defaultImportPattern = /import\s+(?:type\s+)?(\w+)\s+from\s+['"]([^'"]+)['"]/g;

    while ((match = defaultImportPattern.exec(originalSource)) !== null) {
      const name = match[1]!;
      const source = match[2]!;
      const line = this.getLineNumber(originalSource, match.index);
      const isTypeOnly = match[0].includes('import type');

      imports.push(this.createImport({
        source,
        names: [{ imported: 'default', local: name, isDefault: true }],
        line,
        isTypeOnly,
      }));
    }

    // Pattern 3: import * as name from 'module'
    const namespaceImportPattern = /import\s+\*\s+as\s+(\w+)\s+from\s+['"]([^'"]+)['"]/g;

    while ((match = namespaceImportPattern.exec(originalSource)) !== null) {
      const name = match[1]!;
      const source = match[2]!;
      const line = this.getLineNumber(originalSource, match.index);

      imports.push(this.createImport({
        source,
        names: [{ imported: '*', local: name, isNamespace: true }],
        line,
      }));
    }

    return imports;
  }

  // ==========================================================================
  // Export Extraction
  // ==========================================================================

  protected extractExports(
    cleanSource: string,
    originalSource: string,
    _filePath: string
  ): ExportExtraction[] {
    const exports: ExportExtraction[] = [];

    // Pattern 1: export { a, b }
    const namedExportPattern = /export\s+\{([^}]+)\}(?:\s+from\s+['"]([^'"]+)['"])?/g;
    let match;

    while ((match = namedExportPattern.exec(cleanSource)) !== null) {
      const namesStr = match[1]!;
      const source = match[2];
      const line = this.getLineNumber(originalSource, match.index);

      for (const name of namesStr.split(',')) {
        const trimmed = name.trim().split(/\s+as\s+/)[0]!.trim();
        if (trimmed) {
          const exportOpts: Parameters<typeof this.createExport>[0] = {
            name: trimmed,
            isReExport: !!source,
            line,
          };
          if (source) {exportOpts.source = source;}
          exports.push(this.createExport(exportOpts));
        }
      }
    }

    // Pattern 2: export default
    const defaultExportPattern = /export\s+default\s+(?:class|function|const|let|var)?\s*(\w+)?/g;

    while ((match = defaultExportPattern.exec(cleanSource)) !== null) {
      const name = match[1] || 'default';
      const line = this.getLineNumber(originalSource, match.index);

      exports.push(this.createExport({
        name,
        isDefault: true,
        line,
      }));
    }

    // Pattern 3: export const/let/var/function/class
    const declExportPattern = /export\s+(?:const|let|var|function|class|async\s+function)\s+(\w+)/g;

    while ((match = declExportPattern.exec(cleanSource)) !== null) {
      const name = match[1]!;
      const line = this.getLineNumber(originalSource, match.index);

      exports.push(this.createExport({ name, line }));
    }

    return exports;
  }

  // ==========================================================================
  // Call Extraction
  // ==========================================================================

  protected extractCalls(
    cleanSource: string,
    originalSource: string,
    _filePath: string
  ): CallExtraction[] {
    const calls: CallExtraction[] = [];
    const seen = new Set<string>();

    // Pattern 1: Method calls - obj.method(...)
    const methodCallPattern = /(\w+)\.(\w+)\s*\(/g;
    let match;

    while ((match = methodCallPattern.exec(cleanSource)) !== null) {
      const receiver = match[1]!;
      const calleeName = match[2]!;
      const line = this.getLineNumber(originalSource, match.index);
      const key = `${receiver}.${calleeName}:${line}`;
      
      if (seen.has(key)) {continue;}
      seen.add(key);

      // Skip common non-call patterns
      if (['if', 'for', 'while', 'switch', 'catch'].includes(receiver)) {continue;}

      calls.push(this.createCall({
        calleeName,
        receiver,
        fullExpression: `${receiver}.${calleeName}`,
        line,
        isMethodCall: true,
      }));
    }

    // Pattern 2: Direct function calls - func(...)
    const funcCallPattern = /(?<![.\w])(\w+)\s*\(/g;

    while ((match = funcCallPattern.exec(cleanSource)) !== null) {
      const calleeName = match[1]!;
      const line = this.getLineNumber(originalSource, match.index);
      const key = `${calleeName}:${line}`;
      
      if (seen.has(key)) {continue;}
      seen.add(key);

      // Skip keywords and common non-function patterns
      if (['if', 'for', 'while', 'switch', 'catch', 'function', 'return', 'throw', 'new', 'typeof', 'instanceof'].includes(calleeName)) {continue;}

      calls.push(this.createCall({
        calleeName,
        fullExpression: calleeName,
        line,
        isConstructorCall: /^[A-Z]/.test(calleeName),
      }));
    }

    // Pattern 3: Constructor calls - new Class(...) - use originalSource to catch all
    const newPattern = /new\s+(\w+)\s*\(/g;

    while ((match = newPattern.exec(originalSource)) !== null) {
      const calleeName = match[1]!;
      const line = this.getLineNumber(originalSource, match.index);
      const key = `new:${calleeName}:${line}`;
      
      if (seen.has(key)) {continue;}
      seen.add(key);

      calls.push(this.createCall({
        calleeName,
        fullExpression: `new ${calleeName}`,
        line,
        isConstructorCall: true,
      }));
    }

    // Pattern 4: JSX components - <Component ... />
    const jsxPattern = /<([A-Z]\w*)[^>]*(?:\/>|>)/g;

    while ((match = jsxPattern.exec(cleanSource)) !== null) {
      const calleeName = match[1]!;
      const line = this.getLineNumber(originalSource, match.index);
      const key = `jsx:${calleeName}:${line}`;
      
      if (seen.has(key)) {continue;}
      seen.add(key);

      calls.push(this.createCall({
        calleeName,
        fullExpression: `<${calleeName} />`,
        line,
        argumentCount: 1,
      }));
    }

    return calls;
  }
}
