/**
 * C# Regex Extractor
 *
 * Regex-based fallback extractor for C# when tree-sitter is unavailable.
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
 * C# regex patterns
 */
const CSHARP_PATTERNS: LanguagePatterns = {
  language: 'csharp',
  functions: [],
  classes: [],
  imports: [],
  exports: [],
  calls: [],
};

/**
 * C# regex-based extractor
 */
export class CSharpRegexExtractor extends BaseRegexExtractor {
  readonly language: CallGraphLanguage = 'csharp';
  readonly extensions: string[] = ['.cs'];
  protected readonly patterns = CSHARP_PATTERNS;

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

    // Pattern: method declarations
    // [attributes] [modifiers] returnType MethodName(params) [where ...] {
    const methodPattern = /(?:\[[^\]]+\]\s*)*(?:public|private|protected|internal|static|virtual|override|abstract|async|sealed|partial|\s)*(?:<[^>]+>\s+)?(\w+(?:<[^>]+>)?(?:\[\])?(?:\?)?)\s+(\w+)\s*\(([^)]*)\)\s*(?:where\s+[^{]+)?\s*\{/g;
    let match;

    while ((match = methodPattern.exec(cleanSource)) !== null) {
      const returnType = match[1]!;
      const name = match[2]!;
      const paramsStr = match[3] || '';
      const startLine = this.getLineNumber(originalSource, match.index);
      const key = `${name}:${startLine}`;
      
      if (seen.has(key)) {continue;}
      seen.add(key);

      // Skip if this looks like a control structure
      if (['if', 'for', 'foreach', 'while', 'switch', 'catch', 'try', 'using', 'lock'].includes(name)) {continue;}

      const endIndex = this.findBlockEnd(cleanSource, match.index);
      const endLine = this.getLineNumber(originalSource, endIndex);

      const isStatic = match[0].includes('static');
      const isPublic = match[0].includes('public');
      const isAsync = match[0].includes('async');

      const params = this.parseCSharpParameters(paramsStr);
      const decorators = this.getAttributesAbove(cleanSource, match.index);

      functions.push(this.createFunction({
        name,
        startLine,
        endLine,
        parameters: params,
        returnType,
        isMethod: true,
        isStatic,
        isExported: isPublic,
        isConstructor: false,
        isAsync,
        decorators,
      }));
    }

    // Pattern: Constructors - ClassName(params) { or ClassName(params) : base/this {
    const ctorPattern = /(?:\[[^\]]+\]\s*)*(?:public|private|protected|internal|static|\s)*(\w+)\s*\(([^)]*)\)\s*(?::\s*(?:base|this)\s*\([^)]*\))?\s*\{/g;

    while ((match = ctorPattern.exec(cleanSource)) !== null) {
      const name = match[1]!;
      const paramsStr = match[2] || '';
      const startLine = this.getLineNumber(originalSource, match.index);
      const key = `ctor:${name}:${startLine}`;
      
      if (seen.has(key)) {continue;}
      
      // Check if this is actually a constructor (class name should be PascalCase and match a class)
      if (!/^[A-Z]/.test(name)) {continue;}
      if (['if', 'for', 'foreach', 'while', 'switch', 'catch', 'try', 'using', 'lock'].includes(name)) {continue;}

      seen.add(key);

      const endIndex = this.findBlockEnd(cleanSource, match.index);
      const endLine = this.getLineNumber(originalSource, endIndex);

      const isPublic = match[0].includes('public');
      const params = this.parseCSharpParameters(paramsStr);

      functions.push(this.createFunction({
        name,
        startLine,
        endLine,
        parameters: params,
        isMethod: true,
        isStatic: false,
        isExported: isPublic,
        isConstructor: true,
        className: name,
      }));
    }

    return functions;
  }

  /**
   * Get attributes above a method
   */
  private getAttributesAbove(source: string, methodIndex: number): string[] {
    const attributes: string[] = [];
    const beforeMethod = source.slice(0, methodIndex);
    const lines = beforeMethod.split('\n');

    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i]!.trim();
      if (line.startsWith('[') && line.includes(']')) {
        attributes.unshift(line);
      } else if (line && !line.startsWith('//') && !line.startsWith('*')) {
        break;
      }
    }

    return attributes;
  }

  /**
   * Parse C# parameters
   */
  private parseCSharpParameters(paramsStr: string): FunctionExtraction['parameters'] {
    if (!paramsStr.trim()) {return [];}

    const params: FunctionExtraction['parameters'] = [];
    
    // Split by comma, but be careful of generics
    const parts: string[] = [];
    let current = '';
    let depth = 0;

    for (const char of paramsStr) {
      if (char === '<') {depth++;}
      else if (char === '>') {depth--;}
      else if (char === ',' && depth === 0) {
        parts.push(current.trim());
        current = '';
        continue;
      }
      current += char;
    }
    if (current.trim()) {parts.push(current.trim());}

    for (const part of parts) {
      let trimmed = part.trim();
      if (!trimmed) {continue;}

      // Handle params keyword (varargs)
      const isRest = trimmed.startsWith('params ');
      if (isRest) {trimmed = trimmed.slice(7);}

      // Handle ref, out, in keywords
      trimmed = trimmed.replace(/^(ref|out|in)\s+/, '');

      // Handle default values
      let hasDefault = false;
      if (trimmed.includes('=')) {
        hasDefault = true;
        trimmed = trimmed.split('=')[0]!.trim();
      }

      // Pattern: Type name or Type? name
      const paramMatch = trimmed.match(/(\w+(?:<[^>]+>)?(?:\[\])?(?:\?)?)\s+(\w+)/);
      if (paramMatch) {
        const type = paramMatch[1]!;
        const name = paramMatch[2]!;
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

    // Pattern: class Name<T> : Base, IInterface where T : constraint {
    const classPattern = /(?:public|private|protected|internal|abstract|sealed|static|partial|\s)*class\s+(\w+)(?:<[^>]+>)?(?:\s*:\s*([^{]+))?\s*(?:where\s+[^{]+)?\s*\{/g;
    let match;

    while ((match = classPattern.exec(cleanSource)) !== null) {
      const name = match[1]!;
      const startLine = this.getLineNumber(originalSource, match.index);
      const endIndex = this.findBlockEnd(cleanSource, match.index);
      const endLine = this.getLineNumber(originalSource, endIndex);

      const baseClasses: string[] = [];
      if (match[2]) {
        const bases = match[2].split(',').map(b => b.trim().replace(/<[^>]+>/, '')).filter(b => b);
        baseClasses.push(...bases);
      }

      const classBody = cleanSource.slice(match.index, endIndex);
      const methods = this.extractMethodNames(classBody);

      const isPublic = match[0].includes('public');

      classes.push(this.createClass({
        name,
        startLine,
        endLine,
        baseClasses,
        methods,
        isExported: isPublic,
      }));
    }

    // Also extract interfaces
    const interfacePattern = /(?:public|private|protected|internal|\s)*interface\s+(\w+)(?:<[^>]+>)?(?:\s*:\s*([^{]+))?\s*\{/g;

    while ((match = interfacePattern.exec(cleanSource)) !== null) {
      const name = match[1]!;
      const startLine = this.getLineNumber(originalSource, match.index);
      const endIndex = this.findBlockEnd(cleanSource, match.index);
      const endLine = this.getLineNumber(originalSource, endIndex);

      const baseClasses = match[2] 
        ? match[2].split(',').map(i => i.trim().replace(/<[^>]+>/, '')).filter(i => i)
        : [];

      classes.push(this.createClass({
        name,
        startLine,
        endLine,
        baseClasses,
        methods: [],
        isExported: match[0].includes('public'),
      }));
    }

    // Also extract structs
    const structPattern = /(?:public|private|protected|internal|readonly|\s)*struct\s+(\w+)(?:<[^>]+>)?(?:\s*:\s*([^{]+))?\s*\{/g;

    while ((match = structPattern.exec(cleanSource)) !== null) {
      const name = match[1]!;
      const startLine = this.getLineNumber(originalSource, match.index);
      const endIndex = this.findBlockEnd(cleanSource, match.index);
      const endLine = this.getLineNumber(originalSource, endIndex);

      const classBody = cleanSource.slice(match.index, endIndex);
      const methods = this.extractMethodNames(classBody);

      classes.push(this.createClass({
        name,
        startLine,
        endLine,
        baseClasses: [],
        methods,
        isExported: match[0].includes('public'),
      }));
    }

    // Also extract records
    const recordPattern = /(?:public|private|protected|internal|sealed|\s)*record\s+(?:class|struct)?\s*(\w+)(?:<[^>]+>)?(?:\s*\([^)]*\))?(?:\s*:\s*([^{;]+))?\s*[{;]/g;

    while ((match = recordPattern.exec(cleanSource)) !== null) {
      const name = match[1]!;
      const startLine = this.getLineNumber(originalSource, match.index);
      
      // Records can be single-line or have a body
      let endLine = startLine;
      if (match[0].endsWith('{')) {
        const endIndex = this.findBlockEnd(cleanSource, match.index);
        endLine = this.getLineNumber(originalSource, endIndex);
      }

      classes.push(this.createClass({
        name,
        startLine,
        endLine,
        baseClasses: [],
        methods: [],
        isExported: match[0].includes('public'),
      }));
    }

    return classes;
  }

  /**
   * Extract method names from a class body
   */
  private extractMethodNames(classBody: string): string[] {
    const methods: string[] = [];
    const methodPattern = /(?:public|private|protected|internal|static|virtual|override|abstract|async|sealed|\s)*(?:<[^>]+>\s+)?(\w+(?:<[^>]+>)?(?:\[\])?(?:\?)?)\s+(\w+)\s*\([^)]*\)\s*(?:where\s+[^{]+)?\s*\{/g;
    let match;

    while ((match = methodPattern.exec(classBody)) !== null) {
      const name = match[2]!;
      if (!['if', 'for', 'foreach', 'while', 'switch', 'catch', 'try', 'using', 'lock'].includes(name)) {
        methods.push(name);
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

    // Pattern: using Namespace; or using Alias = Namespace;
    const usingPattern = /using\s+(?:static\s+)?(?:(\w+)\s*=\s*)?([^;]+);/g;
    let match;

    while ((match = usingPattern.exec(cleanSource)) !== null) {
      const alias = match[1];
      const source = match[2]!.trim();
      const line = this.getLineNumber(originalSource, match.index);
      const isStatic = match[0].includes('static');

      const className = alias || source.split('.').pop()!;

      imports.push(this.createImport({
        source,
        names: [{ imported: source, local: className, isDefault: false, isNamespace: !isStatic }],
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

    // C# doesn't have explicit exports, but we can detect namespace declarations
    const namespacePattern = /namespace\s+([^{;]+)/g;
    let match;

    while ((match = namespacePattern.exec(cleanSource)) !== null) {
      const name = match[1]!.trim();
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

    // Pattern 1: Method calls - obj.Method(...)
    const methodCallPattern = /(\w+)\.(\w+)\s*\(/g;
    let match;

    while ((match = methodCallPattern.exec(cleanSource)) !== null) {
      const receiver = match[1]!;
      const calleeName = match[2]!;
      const line = this.getLineNumber(originalSource, match.index);
      const key = `${receiver}.${calleeName}:${line}`;
      
      if (seen.has(key)) {continue;}
      seen.add(key);

      // Skip this.Method calls for now
      if (receiver === 'this' || receiver === 'base') {continue;}

      calls.push(this.createCall({
        calleeName,
        receiver,
        fullExpression: `${receiver}.${calleeName}`,
        line,
        isMethodCall: true,
      }));
    }

    // Pattern 2: Direct method calls (within same class) - Method(...)
    const funcCallPattern = /(?<![.\w])(\w+)\s*\(/g;

    while ((match = funcCallPattern.exec(cleanSource)) !== null) {
      const calleeName = match[1]!;
      const line = this.getLineNumber(originalSource, match.index);
      const key = `${calleeName}:${line}`;
      
      if (seen.has(key)) {continue;}
      seen.add(key);

      // Skip keywords
      if (['if', 'for', 'foreach', 'while', 'switch', 'catch', 'try', 'return', 'throw', 'new', 'class', 'interface', 'struct', 'enum', 'using', 'lock', 'typeof', 'sizeof', 'nameof', 'default', 'checked', 'unchecked'].includes(calleeName)) {continue;}

      calls.push(this.createCall({
        calleeName,
        fullExpression: calleeName,
        line,
      }));
    }

    // Pattern 3: Constructor calls - new Class(...)
    const newPattern = /new\s+(\w+)(?:<[^>]*>)?\s*\(/g;

    while ((match = newPattern.exec(cleanSource)) !== null) {
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

    // Pattern 4: LINQ method calls - .Where(...), .Select(...), etc.
    const linqPattern = /\.(?:Where|Select|OrderBy|OrderByDescending|GroupBy|Join|Any|All|First|FirstOrDefault|Single|SingleOrDefault|Count|Sum|Average|Min|Max|Take|Skip|Distinct|ToList|ToArray|ToDictionary)\s*\(/g;

    while ((match = linqPattern.exec(cleanSource)) !== null) {
      const fullMatch = match[0];
      const calleeName = fullMatch.slice(1, fullMatch.indexOf('('));
      const line = this.getLineNumber(originalSource, match.index);
      const key = `linq:${calleeName}:${line}`;
      
      if (seen.has(key)) {continue;}
      seen.add(key);

      calls.push(this.createCall({
        calleeName,
        fullExpression: calleeName,
        line,
        isMethodCall: true,
      }));
    }

    return calls;
  }
}
