/**
 * C++ Regex Extractor
 *
 * Fallback regex-based extraction for C++ when tree-sitter is unavailable.
 * Provides reasonable extraction for common C++ patterns.
 *
 * @requirements C++ Language Support
 * @license Apache-2.0
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

const CPP_PATTERNS: LanguagePatterns = {
  language: 'cpp',
  functions: [],
  classes: [],
  imports: [],
  exports: [],
  calls: [],
};

/**
 * C++ regex-based extractor
 */
export class CppRegexExtractor extends BaseRegexExtractor {
  readonly language: CallGraphLanguage = 'cpp';
  readonly extensions: string[] = ['.cpp', '.cc', '.cxx', '.c++', '.hpp', '.hh', '.hxx', '.h++', '.h'];
  protected readonly patterns = CPP_PATTERNS;

  // ==========================================================================
  // Source Preprocessing
  // ==========================================================================

  /**
   * Preprocess C++ source to remove comments and strings
   */
  protected override preprocessSource(source: string): string {
    // Remove multi-line comments
    let clean = source.replace(/\/\*[\s\S]*?\*\//g, (match) => ' '.repeat(match.length));

    // Remove single-line comments (but preserve line structure)
    clean = clean.replace(/\/\/.*$/gm, (match) => ' '.repeat(match.length));

    // Remove strings (but preserve line structure)
    clean = clean.replace(/"(?:[^"\\]|\\.)*"/g, (match) => '"' + ' '.repeat(match.length - 2) + '"');

    // Remove raw strings
    clean = clean.replace(/R"([^(]*)\([\s\S]*?\)\1"/g, (match) => 'R"(' + ' '.repeat(match.length - 4) + ')"');

    // Remove character literals
    clean = clean.replace(/'(?:[^'\\]|\\.)'/g, (match) => "'" + ' '.repeat(match.length - 2) + "'");

    return clean;
  }

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
    const lines = originalSource.split('\n');

    // Pattern for function definitions (simplified)
    // Matches: [template] [modifiers] return_type [class::] name(params) [const] [noexcept] {
    const funcPattern = /^\s*(template\s*<[^>]*>\s*)?((?:virtual|static|inline|constexpr|explicit)\s+)*(\w[\w:<>*&\s]*?)\s+(\w+(?:::\w+)*)\s*\(([^)]*)\)\s*(const)?\s*(noexcept)?\s*(?:override)?\s*(?:=\s*0)?\s*[{;]/gm;

    let match;
    while ((match = funcPattern.exec(cleanSource)) !== null) {
      const modifiers = match[2] ?? '';
      const returnType = match[3]!.trim();
      const fullName = match[4]!;
      const paramsStr = match[5] ?? '';

      // Skip if this looks like a control structure
      if (['if', 'while', 'for', 'switch', 'catch'].includes(fullName)) {
        continue;
      }

      const startLine = this.getLineNumber(originalSource, match.index);
      const key = `${fullName}:${startLine}`;

      if (seen.has(key)) {continue;}
      seen.add(key);

      // Parse class::method
      const nameParts = fullName.split('::');
      const name = nameParts[nameParts.length - 1]!;
      const className = nameParts.length > 1 ? nameParts.slice(0, -1).join('::') : undefined;

      // Find end of function
      const lineContent = lines[startLine - 1] ?? '';
      const isDeclaration = lineContent.trim().endsWith(';');
      const endLine = isDeclaration ? startLine : this.findClosingBraceLine(lines, startLine - 1);

      // Parse parameters
      const parameters = this.parseParameters(paramsStr);

      functions.push(
        this.createFunction({
          name,
          qualifiedName: fullName,
          startLine,
          endLine,
          parameters,
          returnType,
          isMethod: !!className,
          isStatic: modifiers.includes('static'),
          isExported: true,
          isConstructor: name === className || name === fullName.split('::').pop(),
          isAsync: false,
          ...(className ? { className } : {}),
          decorators: [],
        })
      );
    }

    return functions;
  }

  /**
   * Find closing brace for a block starting at given line
   */
  private findClosingBraceLine(lines: string[], startLine: number): number {
    let depth = 0;
    let foundOpen = false;

    for (let i = startLine; i < lines.length; i++) {
      const line = lines[i]!;

      for (const char of line) {
        if (char === '{') {
          depth++;
          foundOpen = true;
        } else if (char === '}') {
          depth--;
          if (foundOpen && depth === 0) {
            return i + 1;
          }
        }
      }
    }

    return startLine + 1;
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
    const lines = originalSource.split('\n');

    // Pattern for class/struct definitions
    const classPattern = /^\s*(template\s*<[^>]*>\s*)?(class|struct)\s+(\w+)(?:\s*:\s*([^{]+))?\s*\{/gm;

    let match;
    while ((match = classPattern.exec(cleanSource)) !== null) {
      const name = match[3]!;
      const baseClassesStr = match[4];

      const startLine = this.getLineNumber(originalSource, match.index);
      const endLine = this.findClosingBraceLine(lines, startLine - 1);

      const baseClasses: string[] = [];
      if (baseClassesStr) {
        // Parse base classes: "public Base1, private Base2"
        const bases = baseClassesStr.split(',');
        for (const base of bases) {
          const baseMatch = base.trim().match(/(?:public|protected|private|virtual)?\s*(\w+)/);
          if (baseMatch) {
            baseClasses.push(baseMatch[1]!);
          }
        }
      }

      // Extract methods from class body
      const methods = this.extractMethodsFromClass(lines, startLine - 1, endLine);

      classes.push(
        this.createClass({
          name,
          startLine,
          endLine,
          baseClasses,
          methods,
          isExported: true,
        })
      );
    }

    return classes;
  }

  /**
   * Extract method names from a class body
   */
  private extractMethodsFromClass(lines: string[], startLine: number, endLine: number): string[] {
    const methods: string[] = [];
    const methodPattern = /(?:virtual|static|inline|constexpr|explicit)?\s*\w[\w:<>*&\s]*?\s+(\w+)\s*\([^)]*\)/;

    for (let i = startLine; i < endLine && i < lines.length; i++) {
      const line = lines[i]!;
      const match = line.match(methodPattern);
      if (match?.[1] && !['if', 'while', 'for', 'switch'].includes(match[1])) {
        methods.push(match[1]);
      }
    }

    return methods;
  }

  // ==========================================================================
  // Import Extraction
  // ==========================================================================

  protected extractImports(
    cleanSource: string,
    originalSource: string,
    _filePath: string
  ): ImportExtraction[] {
    const imports: ImportExtraction[] = [];
    const includePattern = /^\s*#include\s*([<"])([^>"]+)[>"]/gm;

    let match;
    while ((match = includePattern.exec(cleanSource)) !== null) {
      const isSystem = match[1] === '<';
      const path = match[2]!;
      const line = this.getLineNumber(originalSource, match.index);

      imports.push(
        this.createImport({
          source: path,
          names: [{
            imported: path,
            local: path,
            isDefault: false,
            isNamespace: false,
          }],
          line,
          isTypeOnly: isSystem,
        })
      );
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

    // In C++, public class members and non-static functions in headers are "exports"
    // For simplicity, we'll mark public functions and classes as exports

    // Pattern: public functions (not in class)
    const funcPattern = /^\s*(?:extern\s+)?(\w[\w:<>*&\s]*?)\s+(\w+)\s*\([^)]*\)\s*[{;]/gm;

    let match;
    while ((match = funcPattern.exec(cleanSource)) !== null) {
      const name = match[2]!;
      const line = this.getLineNumber(originalSource, match.index);

      // Skip control structures
      if (['if', 'while', 'for', 'switch', 'catch'].includes(name)) {continue;}

      exports.push(
        this.createExport({
          name,
          line,
          isDefault: false,
          isReExport: false,
        })
      );
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

    // C++ keywords to skip
    const keywords = new Set([
      'if', 'else', 'while', 'for', 'switch', 'catch', 'return', 'sizeof',
      'typeof', 'decltype', 'static_cast', 'dynamic_cast', 'const_cast',
      'reinterpret_cast', 'new', 'delete', 'throw', 'try', 'namespace',
      'class', 'struct', 'enum', 'union', 'template', 'typename',
      'public', 'private', 'protected', 'virtual', 'override', 'final',
    ]);

    // Pattern for function calls: name(args) or obj.method(args) or obj->method(args)
    const callPattern = /(\w+(?:::\w+)*)\s*\(/g;
    const methodCallPattern = /(\w+)\s*(?:\.|->)\s*(\w+)\s*\(/g;

    // Extract regular function calls
    let match;
    while ((match = callPattern.exec(cleanSource)) !== null) {
      const calleeName = match[1]!;
      const line = this.getLineNumber(originalSource, match.index);
      const key = `${calleeName}:${line}`;

      if (seen.has(key)) {continue;}
      if (keywords.has(calleeName)) {continue;}
      seen.add(key);

      const column = this.getColumnNumber(originalSource, match.index);
      const argsStart = match.index + match[0].length - 1;
      const argumentCount = this.countArguments(cleanSource, argsStart);

      calls.push(
        this.createCall({
          calleeName,
          fullExpression: match[0],
          line,
          column,
          argumentCount,
          isMethodCall: calleeName.includes('::'),
          isConstructorCall: /^[A-Z]/.test(calleeName) && !calleeName.includes('::'),
        })
      );
    }

    // Extract method calls (obj.method or obj->method)
    while ((match = methodCallPattern.exec(cleanSource)) !== null) {
      const receiver = match[1]!;
      const calleeName = match[2]!;
      const line = this.getLineNumber(originalSource, match.index);
      const key = `${receiver}.${calleeName}:${line}`;

      if (seen.has(key)) {continue;}
      if (keywords.has(calleeName)) {continue;}
      seen.add(key);

      const column = this.getColumnNumber(originalSource, match.index);
      const argsStart = match.index + match[0].length - 1;
      const argumentCount = this.countArguments(cleanSource, argsStart);

      calls.push(
        this.createCall({
          calleeName,
          receiver,
          fullExpression: match[0],
          line,
          column,
          argumentCount,
          isMethodCall: true,
          isConstructorCall: false,
        })
      );
    }

    return calls;
  }

  /**
   * Count arguments in a function call
   */
  private countArguments(source: string, startIndex: number): number {
    let depth = 1;
    let count = 0;
    let hasContent = false;

    for (let i = startIndex + 1; i < source.length && depth > 0; i++) {
      const char = source[i]!;

      if (char === '(' || char === '[' || char === '{' || char === '<') {
        depth++;
        hasContent = true;
      } else if (char === ')' || char === ']' || char === '}' || char === '>') {
        depth--;
      } else if (char === ',' && depth === 1) {
        count++;
        hasContent = true;
      } else if (!/\s/.test(char)) {
        hasContent = true;
      }
    }

    return hasContent ? count + 1 : 0;
  }
}

/**
 * Create a C++ regex extractor instance
 */
export function createCppRegexExtractor(): CppRegexExtractor {
  return new CppRegexExtractor();
}
