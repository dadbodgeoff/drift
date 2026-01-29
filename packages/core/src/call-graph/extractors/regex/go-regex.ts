/**
 * Go Regex Extractor
 *
 * Regex-based fallback extractor for Go when tree-sitter is unavailable.
 * Provides reasonable extraction coverage using pattern matching.
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

const GO_PATTERNS: LanguagePatterns = {
  language: 'go',
  functions: [],
  classes: [],
  imports: [],
  exports: [],
  calls: [],
};

/**
 * Go regex-based extractor
 */
export class GoRegexExtractor extends BaseRegexExtractor {
  readonly language: CallGraphLanguage = 'go';
  readonly extensions: string[] = ['.go'];
  protected readonly patterns = GO_PATTERNS;

  // ==========================================================================
  // Source Preprocessing
  // ==========================================================================

  /**
   * Preprocess Go source to remove comments and strings
   */
  protected override preprocessSource(source: string): string {
    // Remove multi-line comments
    let clean = source.replace(/\/\*[\s\S]*?\*\//g, (match) => ' '.repeat(match.length));

    // Remove single-line comments (but preserve line structure)
    clean = clean.replace(/\/\/.*$/gm, (match) => ' '.repeat(match.length));

    // Remove strings (but preserve line structure)
    clean = clean.replace(/"(?:[^"\\]|\\.)*"/g, (match) => '"' + ' '.repeat(match.length - 2) + '"');

    // Remove raw strings
    clean = clean.replace(/`[^`]*`/g, (match) => '`' + ' '.repeat(match.length - 2) + '`');

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

    // Pattern 1: Regular function declarations
    // func FunctionName(params) returnType {
    const funcPattern = /^func\s+([A-Za-z_]\w*)\s*\(([^)]*)\)\s*([^{]*?)\s*\{/gm;
    let match;

    while ((match = funcPattern.exec(cleanSource)) !== null) {
      const name = match[1]!;
      const paramsStr = match[2] ?? '';
      const returnStr = (match[3] ?? '').trim();
      const startLine = this.getLineNumber(originalSource, match.index);
      const key = `${name}:${startLine}`;

      if (seen.has(key)) {continue;}
      seen.add(key);

      const endIndex = this.findBlockEnd(cleanSource, match.index);
      const endLine = this.getLineNumber(originalSource, endIndex);
      const isExported = /^[A-Z]/.test(name);

      functions.push(
        this.createFunction({
          name,
          qualifiedName: name,
          startLine,
          endLine,
          parameters: this.parseGoParameters(paramsStr),
          ...(returnStr ? { returnType: returnStr } : {}),
          isMethod: false,
          isStatic: true,
          isExported,
          isConstructor: name === 'New' || name.startsWith('New'),
          decorators: [],
        })
      );
    }

    // Pattern 2: Method declarations
    // func (r *Receiver) MethodName(params) returnType {
    const methodPattern =
      /^func\s+\((\w+)\s+\*?(\w+)\)\s+([A-Za-z_]\w*)\s*\(([^)]*)\)\s*([^{]*?)\s*\{/gm;

    while ((match = methodPattern.exec(cleanSource)) !== null) {
      const receiverType = match[2]!;
      const name = match[3]!;
      const paramsStr = match[4] ?? '';
      const returnStr = (match[5] ?? '').trim();
      const startLine = this.getLineNumber(originalSource, match.index);
      const key = `${receiverType}.${name}:${startLine}`;

      if (seen.has(key)) {continue;}
      seen.add(key);

      const endIndex = this.findBlockEnd(cleanSource, match.index);
      const endLine = this.getLineNumber(originalSource, endIndex);
      const isExported = /^[A-Z]/.test(name);

      functions.push(
        this.createFunction({
          name,
          qualifiedName: `${receiverType}.${name}`,
          startLine,
          endLine,
          parameters: this.parseGoParameters(paramsStr),
          ...(returnStr ? { returnType: returnStr } : {}),
          isMethod: true,
          isStatic: false,
          isExported,
          isConstructor: false,
          className: receiverType,
          decorators: [],
        })
      );
    }

    return functions;
  }

  /**
   * Parse Go parameter string
   */
  private parseGoParameters(paramsStr: string): FunctionExtraction['parameters'] {
    if (!paramsStr.trim()) {return [];}

    const params: FunctionExtraction['parameters'] = [];
    const parts = this.splitGoParams(paramsStr);

    for (const part of parts) {
      const trimmed = part.trim();
      if (!trimmed) {continue;}

      // Handle variadic: name ...type
      const isVariadic = trimmed.includes('...');

      // Pattern: name type or name, name2 type
      const paramMatch = trimmed.match(/^(\w+(?:\s*,\s*\w+)*)\s+(.+)$/);
      if (paramMatch) {
        const names = paramMatch[1]!.split(',').map((n) => n.trim());
        const type = paramMatch[2]!.replace('...', '').trim();

        for (const name of names) {
          params.push({ name, type, hasDefault: false, isRest: isVariadic });
        }
      } else {
        // Unnamed parameter (just type)
        params.push({ name: '_', type: trimmed.replace('...', ''), hasDefault: false, isRest: isVariadic });
      }
    }

    return params;
  }

  /**
   * Split Go parameters respecting nested brackets
   */
  private splitGoParams(paramsStr: string): string[] {
    const parts: string[] = [];
    let current = '';
    let depth = 0;

    for (const char of paramsStr) {
      if (char === '(' || char === '[' || char === '{' || char === '<') {depth++;}
      else if (char === ')' || char === ']' || char === '}' || char === '>') {depth--;}
      else if (char === ',' && depth === 0) {
        parts.push(current.trim());
        current = '';
        continue;
      }
      current += char;
    }
    if (current.trim()) {parts.push(current.trim());}

    return parts;
  }

  // ==========================================================================
  // Class (Struct/Interface) Extraction
  // ==========================================================================

  protected extractClasses(
    cleanSource: string,
    originalSource: string,
    _filePath: string
  ): ClassExtraction[] {
    const classes: ClassExtraction[] = [];

    // Pattern 1: Struct declarations
    // type StructName struct {
    const structPattern = /type\s+(\w+)\s+struct\s*\{/g;
    let match;

    while ((match = structPattern.exec(cleanSource)) !== null) {
      const name = match[1]!;
      const startLine = this.getLineNumber(originalSource, match.index);
      const endIndex = this.findBlockEnd(cleanSource, match.index);
      const endLine = this.getLineNumber(originalSource, endIndex);
      const isExported = /^[A-Z]/.test(name);

      // Extract embedded types from struct body
      const structBody = cleanSource.slice(match.index, endIndex);
      const embeddedTypes = this.extractEmbeddedTypes(structBody);

      classes.push(
        this.createClass({
          name,
          startLine,
          endLine,
          baseClasses: embeddedTypes,
          methods: [],
          isExported,
        })
      );
    }

    // Pattern 2: Interface declarations
    // type InterfaceName interface {
    const interfacePattern = /type\s+(\w+)\s+interface\s*\{/g;

    while ((match = interfacePattern.exec(cleanSource)) !== null) {
      const name = match[1]!;
      const startLine = this.getLineNumber(originalSource, match.index);
      const endIndex = this.findBlockEnd(cleanSource, match.index);
      const endLine = this.getLineNumber(originalSource, endIndex);
      const isExported = /^[A-Z]/.test(name);

      // Extract interface methods and embedded interfaces
      const interfaceBody = cleanSource.slice(match.index, endIndex);
      const methods = this.extractInterfaceMethods(interfaceBody);
      const embeddedInterfaces = this.extractEmbeddedInterfaces(interfaceBody);

      classes.push(
        this.createClass({
          name,
          startLine,
          endLine,
          baseClasses: embeddedInterfaces,
          methods,
          isExported,
        })
      );
    }

    return classes;
  }

  /**
   * Extract embedded types from struct body
   */
  private extractEmbeddedTypes(structBody: string): string[] {
    const embedded: string[] = [];
    const lines = structBody.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      // Embedded type: just *TypeName or TypeName (no field name before it)
      const embeddedMatch = trimmed.match(/^\*?([A-Z]\w*)$/);
      if (embeddedMatch) {
        embedded.push(embeddedMatch[1]!);
      }
    }

    return embedded;
  }

  /**
   * Extract method signatures from interface body
   */
  private extractInterfaceMethods(interfaceBody: string): string[] {
    const methods: string[] = [];
    // Look for method signatures: MethodName(params) returnType
    const methodPattern = /^\s*([A-Z]\w*)\s*\(/gm;
    let match;

    while ((match = methodPattern.exec(interfaceBody)) !== null) {
      methods.push(match[1]!);
    }

    return methods;
  }

  /**
   * Extract embedded interfaces from interface body
   */
  private extractEmbeddedInterfaces(interfaceBody: string): string[] {
    const embedded: string[] = [];
    const lines = interfaceBody.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      // Embedded interface: just InterfaceName (no parentheses)
      if (/^[A-Z]\w*$/.test(trimmed) && !trimmed.includes('(')) {
        embedded.push(trimmed);
      }
    }

    return embedded;
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

    // Pattern 1: Single import
    // import "package/path"
    // import alias "package/path"
    const singleImportPattern = /import\s+(?:(\w+|\.)\s+)?"([^"]+)"/g;
    let match;

    while ((match = singleImportPattern.exec(cleanSource)) !== null) {
      const alias = match[1];
      const path = match[2]!;
      const line = this.getLineNumber(originalSource, match.index);
      const packageName = path.split('/').pop() ?? path;

      imports.push(
        this.createImport({
          source: path,
          names: [
            {
              imported: packageName,
              local: alias ?? packageName,
              isDefault: false,
              isNamespace: alias === '.',
            },
          ],
          line,
        })
      );
    }

    // Pattern 2: Import block
    // import (
    //   "package1"
    //   alias "package2"
    // )
    const importBlockPattern = /import\s*\(\s*([\s\S]*?)\s*\)/g;

    while ((match = importBlockPattern.exec(cleanSource)) !== null) {
      const blockContent = match[1]!;
      const blockStart = match.index;
      const importLines = blockContent.split('\n');

      for (const importLine of importLines) {
        const trimmed = importLine.trim();
        if (!trimmed || trimmed.startsWith('//')) {continue;}

        const lineMatch = trimmed.match(/^(?:(\w+|\.)\s+)?"([^"]+)"$/);
        if (lineMatch) {
          const alias = lineMatch[1];
          const path = lineMatch[2]!;
          const packageName = path.split('/').pop() ?? path;

          imports.push(
            this.createImport({
              source: path,
              names: [
                {
                  imported: packageName,
                  local: alias ?? packageName,
                  isDefault: false,
                  isNamespace: alias === '.',
                },
              ],
              line: this.getLineNumber(originalSource, blockStart),
            })
          );
        }
      }
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

    // Package declaration
    const packagePattern = /package\s+(\w+)/;
    const match = cleanSource.match(packagePattern);

    if (match) {
      exports.push(
        this.createExport({
          name: match[1]!,
          line: this.getLineNumber(originalSource, match.index ?? 0),
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

    // Go keywords to skip
    const keywords = new Set([
      'if',
      'for',
      'switch',
      'select',
      'go',
      'defer',
      'return',
      'func',
      'type',
      'struct',
      'interface',
      'map',
      'chan',
      'range',
      'make',
      'new',
      'append',
      'len',
      'cap',
      'close',
      'delete',
      'copy',
      'panic',
      'recover',
      'print',
      'println',
      'true',
      'false',
      'nil',
      'iota',
      'const',
      'var',
      'package',
      'import',
      'break',
      'continue',
      'fallthrough',
      'goto',
      'case',
      'default',
      'else',
    ]);

    // Pattern 1: Method/package calls - obj.Method() or pkg.Function()
    const methodCallPattern = /(\w+)\.(\w+)\s*\(/g;
    let match;

    while ((match = methodCallPattern.exec(cleanSource)) !== null) {
      const receiver = match[1]!;
      const calleeName = match[2]!;
      const line = this.getLineNumber(originalSource, match.index);
      const key = `${receiver}.${calleeName}:${line}`;

      if (seen.has(key)) {continue;}
      if (keywords.has(receiver) || keywords.has(calleeName)) {continue;}
      seen.add(key);

      calls.push(
        this.createCall({
          calleeName,
          receiver,
          fullExpression: `${receiver}.${calleeName}`,
          line,
          isMethodCall: true,
        })
      );
    }

    // Pattern 2: Direct function calls - FunctionName()
    const funcCallPattern = /(?<![.\w])([A-Za-z_]\w*)\s*\(/g;

    while ((match = funcCallPattern.exec(cleanSource)) !== null) {
      const calleeName = match[1]!;
      const line = this.getLineNumber(originalSource, match.index);
      const key = `${calleeName}:${line}`;

      if (seen.has(key)) {continue;}
      if (keywords.has(calleeName)) {continue;}
      seen.add(key);

      calls.push(
        this.createCall({
          calleeName,
          fullExpression: calleeName,
          line,
          isConstructorCall: calleeName === 'New' || calleeName.startsWith('New'),
        })
      );
    }

    return calls;
  }
}

/**
 * Create a Go regex extractor instance
 */
export function createGoRegexExtractor(): GoRegexExtractor {
  return new GoRegexExtractor();
}
