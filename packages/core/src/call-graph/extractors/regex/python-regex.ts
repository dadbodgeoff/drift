/**
 * Python Regex Extractor
 *
 * Regex-based fallback extractor for Python when tree-sitter is unavailable.
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
 * Python regex patterns
 */
const PYTHON_PATTERNS: LanguagePatterns = {
  language: 'python',
  functions: [],
  classes: [],
  imports: [],
  exports: [],
  calls: [],
};

/**
 * Python regex-based extractor
 */
export class PythonRegexExtractor extends BaseRegexExtractor {
  readonly language: CallGraphLanguage = 'python';
  readonly extensions: string[] = ['.py', '.pyw', '.pyi'];
  protected readonly patterns = PYTHON_PATTERNS;

  /**
   * Override preprocessSource for Python-specific handling
   */
  protected override preprocessSource(source: string): string {
    // Remove multi-line strings (docstrings)
    let clean = source.replace(/'''[\s\S]*?'''/g, (match) => ' '.repeat(match.length));
    clean = clean.replace(/"""[\s\S]*?"""/g, (match) => ' '.repeat(match.length));

    // Remove single-line comments
    clean = clean.replace(/#.*$/gm, (match) => ' '.repeat(match.length));

    // Remove strings
    clean = clean.replace(/"(?:[^"\\]|\\.)*"/g, (match) => '"' + ' '.repeat(match.length - 2) + '"');
    clean = clean.replace(/'(?:[^'\\]|\\.)*'/g, (match) => "'" + ' '.repeat(match.length - 2) + "'");

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

    // Pattern: def name(params): or async def name(params):
    // Captures indentation to determine scope
    const funcPattern = /^(\s*)(?:async\s+)?def\s+(\w+)\s*\(([^)]*)\)\s*(?:->\s*([^:]+))?:/gm;
    let match;

    while ((match = funcPattern.exec(cleanSource)) !== null) {
      const indent = match[1]!;
      const name = match[2]!;
      const paramsStr = match[3] || '';
      const returnType = match[4]?.trim();
      const startLine = this.getLineNumber(originalSource, match.index);
      const key = `${name}:${startLine}`;
      
      if (seen.has(key)) {continue;}
      seen.add(key);

      // Find end of function by looking for next line with same or less indentation
      const endLine = this.findPythonBlockEnd(cleanSource, match.index, indent.length);
      const isAsync = match[0].includes('async');
      const isMethod = indent.length >= 4; // Indented = likely a method
      const isPrivate = name.startsWith('_') && !name.startsWith('__');
      const isDunder = name.startsWith('__') && name.endsWith('__');

      // Parse parameters (skip self/cls)
      const params = this.parsePythonParameters(paramsStr);

      // Get decorators
      const decorators = this.getDecoratorsAbove(cleanSource, match.index);

      const funcOpts: Parameters<typeof this.createFunction>[0] = {
        name,
        startLine,
        endLine,
        parameters: params,
        isMethod,
        isStatic: decorators.some(d => d.includes('@staticmethod') || d.includes('@classmethod')),
        isExported: !isPrivate || isDunder,
        isConstructor: name === '__init__',
        isAsync,
        decorators,
      };
      if (returnType) {funcOpts.returnType = returnType;}

      functions.push(this.createFunction(funcOpts));
    }

    return functions;
  }

  /**
   * Find the end of a Python block based on indentation
   */
  private findPythonBlockEnd(source: string, startIndex: number, baseIndent: number): number {
    const lines = source.slice(startIndex).split('\n');
    let lineCount = 1;
    let foundBody = false;

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i]!;
      const trimmed = line.trim();
      
      // Skip empty lines and comments
      if (!trimmed || trimmed.startsWith('#')) {
        lineCount++;
        continue;
      }

      // Count leading spaces
      const indent = line.length - line.trimStart().length;

      // First non-empty line after def should be indented more
      if (!foundBody) {
        if (indent > baseIndent) {
          foundBody = true;
          lineCount++;
          continue;
        }
      }

      // If we found body and now see same or less indent, we're done
      if (foundBody && indent <= baseIndent) {
        break;
      }

      lineCount++;
    }

    const startLine = this.getLineNumber(source, startIndex);
    return startLine + lineCount - 1;
  }

  /**
   * Get decorators above a function definition
   */
  private getDecoratorsAbove(source: string, funcIndex: number): string[] {
    const decorators: string[] = [];
    const beforeFunc = source.slice(0, funcIndex);
    const lines = beforeFunc.split('\n');

    // Walk backwards from the function
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i]!.trim();
      if (line.startsWith('@')) {
        decorators.unshift(line);
      } else if (line && !line.startsWith('#')) {
        // Non-decorator, non-comment line - stop
        break;
      }
    }

    return decorators;
  }

  /**
   * Parse Python parameters
   */
  private parsePythonParameters(paramsStr: string): FunctionExtraction['parameters'] {
    if (!paramsStr.trim()) {return [];}

    const params: FunctionExtraction['parameters'] = [];
    const parts = paramsStr.split(',');

    for (const part of parts) {
      const trimmed = part.trim();
      if (!trimmed || trimmed === 'self' || trimmed === 'cls') {continue;}

      // Handle *args and **kwargs
      const isRest = trimmed.startsWith('*');
      let name = trimmed.replace(/^\*+/, '');
      let type: string | undefined;
      let hasDefault = false;

      // Handle default values
      if (name.includes('=')) {
        hasDefault = true;
        name = name.split('=')[0]!.trim();
      }

      // Handle type annotations
      if (name.includes(':')) {
        const [n, t] = name.split(':');
        name = n!.trim();
        type = t!.trim();
      }

      if (name) {
        params.push({ name, type, hasDefault, isRest });
      }
    }

    return params;
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

    // Pattern: class Name(Base1, Base2):
    const classPattern = /^(\s*)class\s+(\w+)(?:\(([^)]*)\))?\s*:/gm;
    let match;

    while ((match = classPattern.exec(cleanSource)) !== null) {
      const indent = match[1]!;
      const name = match[2]!;
      const basesStr = match[3] || '';
      const startLine = this.getLineNumber(originalSource, match.index);
      const endLine = this.findPythonBlockEnd(cleanSource, match.index, indent.length);

      // Parse base classes
      const baseClasses = basesStr
        .split(',')
        .map(b => b.trim())
        .filter(b => b && b !== 'object');

      // Extract method names from class body
      const classBody = cleanSource.slice(match.index, this.getIndexFromLine(cleanSource, endLine));
      const methods = this.extractMethodNames(classBody);

      const isPrivate = name.startsWith('_') && !name.startsWith('__');

      classes.push(this.createClass({
        name,
        startLine,
        endLine,
        baseClasses,
        methods,
        isExported: !isPrivate,
      }));
    }

    return classes;
  }

  /**
   * Get character index from line number
   */
  private getIndexFromLine(source: string, lineNum: number): number {
    const lines = source.split('\n');
    let index = 0;
    for (let i = 0; i < lineNum - 1 && i < lines.length; i++) {
      index += lines[i]!.length + 1;
    }
    return index;
  }

  /**
   * Extract method names from a class body
   */
  private extractMethodNames(classBody: string): string[] {
    const methods: string[] = [];
    const methodPattern = /^\s+(?:async\s+)?def\s+(\w+)\s*\(/gm;
    let match;

    while ((match = methodPattern.exec(classBody)) !== null) {
      methods.push(match[1]!);
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

    // Pattern 1: from module import name1, name2
    const fromImportPattern = /^from\s+(\S+)\s+import\s+(.+)$/gm;
    let match;

    while ((match = fromImportPattern.exec(cleanSource)) !== null) {
      const source = match[1]!;
      const namesStr = match[2]!;
      const line = this.getLineNumber(originalSource, match.index);

      // Handle wildcard import
      if (namesStr.trim() === '*') {
        imports.push(this.createImport({
          source,
          names: [{ imported: '*', local: '*', isNamespace: true }],
          line,
        }));
        continue;
      }

      // Handle parenthesized imports
      let cleanNames = namesStr;
      if (namesStr.includes('(')) {
        // Multi-line import - find closing paren
        const parenStart = cleanSource.indexOf('(', match.index);
        const parenEnd = cleanSource.indexOf(')', parenStart);
        if (parenEnd > parenStart) {
          cleanNames = cleanSource.slice(parenStart + 1, parenEnd);
        }
      }

      const names = cleanNames.split(',').map(n => {
        const parts = n.trim().split(/\s+as\s+/);
        const imported = parts[0]!.trim();
        const local = (parts[1] || parts[0])!.trim();
        return { imported, local, isDefault: false, isNamespace: false };
      }).filter(n => n.imported);

      imports.push(this.createImport({ source, names, line }));
    }

    // Pattern 2: import module or import module as alias
    const importPattern = /^import\s+(\S+)(?:\s+as\s+(\w+))?$/gm;

    while ((match = importPattern.exec(cleanSource)) !== null) {
      const source = match[1]!;
      const alias = match[2];
      const line = this.getLineNumber(originalSource, match.index);

      imports.push(this.createImport({
        source,
        names: [{
          imported: source,
          local: alias || source.split('.').pop()!,
          isDefault: false,
          isNamespace: false,
        }],
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

    // Python doesn't have explicit exports, but we can detect __all__
    const allPattern = /__all__\s*=\s*\[([^\]]+)\]/g;
    let match;

    while ((match = allPattern.exec(cleanSource)) !== null) {
      const namesStr = match[1]!;
      const line = this.getLineNumber(originalSource, match.index);

      const names = namesStr.split(',').map(n => {
        // Remove quotes
        return n.trim().replace(/['"]/g, '');
      }).filter(n => n);

      for (const name of names) {
        exports.push(this.createExport({ name, line }));
      }
    }

    // Also consider top-level public functions/classes as exports
    // (This is handled by the function/class extraction with isExported flag)

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

      // Skip self.method calls for now (they're internal)
      if (receiver === 'self' || receiver === 'cls') {continue;}

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

      // Skip keywords
      if (['if', 'for', 'while', 'with', 'except', 'def', 'class', 'return', 'yield', 'raise', 'assert', 'print', 'lambda'].includes(calleeName)) {continue;}

      // Check if it looks like a class instantiation (PascalCase)
      const isConstructorCall = /^[A-Z]/.test(calleeName);

      calls.push(this.createCall({
        calleeName,
        fullExpression: calleeName,
        line,
        isConstructorCall,
      }));
    }

    // Pattern 3: Decorator calls - @decorator(...)
    const decoratorCallPattern = /@(\w+)\s*\(/g;

    while ((match = decoratorCallPattern.exec(cleanSource)) !== null) {
      const calleeName = match[1]!;
      const line = this.getLineNumber(originalSource, match.index);
      const key = `@${calleeName}:${line}`;
      
      if (seen.has(key)) {continue;}
      seen.add(key);

      calls.push(this.createCall({
        calleeName,
        fullExpression: `@${calleeName}`,
        line,
      }));
    }

    return calls;
  }
}
