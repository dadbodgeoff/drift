/**
 * Java Regex Extractor
 *
 * Regex-based fallback extractor for Java when tree-sitter is unavailable.
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
 * Java regex patterns
 */
const JAVA_PATTERNS: LanguagePatterns = {
  language: 'java',
  functions: [],
  classes: [],
  imports: [],
  exports: [],
  calls: [],
};

/**
 * Java regex-based extractor
 */
export class JavaRegexExtractor extends BaseRegexExtractor {
  readonly language: CallGraphLanguage = 'java';
  readonly extensions: string[] = ['.java'];
  protected readonly patterns = JAVA_PATTERNS;

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
    // [modifiers] [<generics>] returnType methodName(params) [throws ...] {
    const methodPattern = /(?:@\w+(?:\([^)]*\))?\s*)*(?:public|private|protected|static|final|abstract|synchronized|native|\s)*(?:<[^>]+>\s+)?(\w+(?:<[^>]+>)?)\s+(\w+)\s*\(([^)]*)\)\s*(?:throws\s+[^{]+)?\s*\{/g;
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
      if (['if', 'for', 'while', 'switch', 'catch', 'try'].includes(name)) {continue;}

      const endIndex = this.findBlockEnd(cleanSource, match.index);
      const endLine = this.getLineNumber(originalSource, endIndex);

      const isStatic = match[0].includes('static');
      const isPublic = match[0].includes('public');
      const isConstructor = returnType === name; // Constructor has same name as return type

      const params = this.parseJavaParameters(paramsStr);
      const decorators = this.getAnnotationsAbove(cleanSource, match.index);

      const funcOpts: Parameters<typeof this.createFunction>[0] = {
        name,
        startLine,
        endLine,
        parameters: params,
        isMethod: true,
        isStatic,
        isExported: isPublic,
        isConstructor,
        decorators,
      };
      if (!isConstructor) {funcOpts.returnType = returnType;}

      functions.push(this.createFunction(funcOpts));
    }

    return functions;
  }

  /**
   * Get annotations above a method
   */
  private getAnnotationsAbove(source: string, methodIndex: number): string[] {
    const annotations: string[] = [];
    const beforeMethod = source.slice(0, methodIndex);
    const lines = beforeMethod.split('\n');

    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i]!.trim();
      if (line.startsWith('@')) {
        annotations.unshift(line);
      } else if (line && !line.startsWith('//') && !line.startsWith('*')) {
        break;
      }
    }

    return annotations;
  }

  /**
   * Parse Java parameters
   */
  private parseJavaParameters(paramsStr: string): FunctionExtraction['parameters'] {
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
      const trimmed = part.trim();
      if (!trimmed) {continue;}

      // Handle varargs
      const isRest = trimmed.includes('...');
      
      // Pattern: [final] Type name or Type... name
      const paramMatch = trimmed.match(/(?:final\s+)?(\w+(?:<[^>]+>)?(?:\[\])?(?:\.\.\.)?)\s+(\w+)/);
      if (paramMatch) {
        const type = paramMatch[1]!.replace('...', '');
        const name = paramMatch[2]!;
        params.push({ name, type, hasDefault: false, isRest });
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

    // Pattern: class Name<T> extends Base implements Interface1, Interface2 {
    const classPattern = /(?:public|private|protected|abstract|final|static|\s)*class\s+(\w+)(?:<[^>]+>)?(?:\s+extends\s+(\w+(?:<[^>]+>)?))?(?:\s+implements\s+([^{]+))?\s*\{/g;
    let match;

    while ((match = classPattern.exec(cleanSource)) !== null) {
      const name = match[1]!;
      const startLine = this.getLineNumber(originalSource, match.index);
      const endIndex = this.findBlockEnd(cleanSource, match.index);
      const endLine = this.getLineNumber(originalSource, endIndex);

      const baseClasses: string[] = [];
      if (match[2]) {baseClasses.push(match[2].replace(/<[^>]+>/, ''));}
      if (match[3]) {
        const interfaces = match[3].split(',').map(i => i.trim().replace(/<[^>]+>/, '')).filter(i => i);
        baseClasses.push(...interfaces);
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
    const interfacePattern = /(?:public\s+)?interface\s+(\w+)(?:<[^>]+>)?(?:\s+extends\s+([^{]+))?\s*\{/g;

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

    // Also extract enums
    const enumPattern = /(?:public\s+)?enum\s+(\w+)(?:\s+implements\s+([^{]+))?\s*\{/g;

    while ((match = enumPattern.exec(cleanSource)) !== null) {
      const name = match[1]!;
      const startLine = this.getLineNumber(originalSource, match.index);
      const endIndex = this.findBlockEnd(cleanSource, match.index);
      const endLine = this.getLineNumber(originalSource, endIndex);

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
    const methodPattern = /(?:public|private|protected|static|final|abstract|synchronized|\s)*(?:<[^>]+>\s+)?(\w+(?:<[^>]+>)?)\s+(\w+)\s*\([^)]*\)\s*(?:throws\s+[^{]+)?\s*\{/g;
    let match;

    while ((match = methodPattern.exec(classBody)) !== null) {
      const name = match[2]!;
      if (!['if', 'for', 'while', 'switch', 'catch', 'try'].includes(name)) {
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

    // Pattern: import [static] package.Class;
    const importPattern = /import\s+(?:static\s+)?([^;]+);/g;
    let match;

    while ((match = importPattern.exec(cleanSource)) !== null) {
      const source = match[1]!.trim();
      const line = this.getLineNumber(originalSource, match.index);
      const isStatic = match[0].includes('static');

      // Handle wildcard imports
      if (source.endsWith('.*')) {
        imports.push(this.createImport({
          source: source.slice(0, -2),
          names: [{ imported: '*', local: '*', isNamespace: true }],
          line,
        }));
        continue;
      }

      const className = source.split('.').pop()!;

      imports.push(this.createImport({
        source,
        names: [{ imported: className, local: className, isDefault: false, isNamespace: false }],
        line,
        isTypeOnly: !isStatic,
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

    // Java doesn't have explicit exports, but we can detect package declarations
    const packagePattern = /package\s+([^;]+);/g;
    let match;

    while ((match = packagePattern.exec(cleanSource)) !== null) {
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

      // Skip this.method calls for now
      if (receiver === 'this' || receiver === 'super') {continue;}

      calls.push(this.createCall({
        calleeName,
        receiver,
        fullExpression: `${receiver}.${calleeName}`,
        line,
        isMethodCall: true,
      }));
    }

    // Pattern 2: Static method calls - Class.method(...)
    // Already covered by pattern 1

    // Pattern 3: Direct method calls (within same class) - method(...)
    const funcCallPattern = /(?<![.\w])(\w+)\s*\(/g;

    while ((match = funcCallPattern.exec(cleanSource)) !== null) {
      const calleeName = match[1]!;
      const line = this.getLineNumber(originalSource, match.index);
      const key = `${calleeName}:${line}`;
      
      if (seen.has(key)) {continue;}
      seen.add(key);

      // Skip keywords
      if (['if', 'for', 'while', 'switch', 'catch', 'try', 'return', 'throw', 'new', 'class', 'interface', 'enum', 'synchronized', 'assert'].includes(calleeName)) {continue;}

      calls.push(this.createCall({
        calleeName,
        fullExpression: calleeName,
        line,
      }));
    }

    // Pattern 4: Constructor calls - new Class(...)
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

    return calls;
  }
}
