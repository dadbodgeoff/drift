/**
 * Rust Regex Extractor
 *
 * Regex-based fallback extractor for Rust when tree-sitter is unavailable.
 * Provides reasonable extraction coverage using pattern matching.
 *
 * @requirements Rust Language Support
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

const RUST_PATTERNS: LanguagePatterns = {
  language: 'rust',
  functions: [],
  classes: [],
  imports: [],
  exports: [],
  calls: [],
};

/**
 * Rust regex-based extractor
 */
export class RustRegexExtractor extends BaseRegexExtractor {
  readonly language: CallGraphLanguage = 'rust';
  readonly extensions: string[] = ['.rs'];
  protected readonly patterns = RUST_PATTERNS;

  // ==========================================================================
  // Source Preprocessing
  // ==========================================================================

  /**
   * Preprocess Rust source to remove comments and strings
   */
  protected override preprocessSource(source: string): string {
    // Remove multi-line comments
    let clean = source.replace(/\/\*[\s\S]*?\*\//g, (match) => ' '.repeat(match.length));

    // Remove single-line comments (but preserve line structure)
    clean = clean.replace(/\/\/.*$/gm, (match) => ' '.repeat(match.length));

    // Remove doc comments
    clean = clean.replace(/\/\/\/.*$/gm, (match) => ' '.repeat(match.length));
    clean = clean.replace(/\/\/!.*$/gm, (match) => ' '.repeat(match.length));

    // Remove strings (but preserve line structure)
    clean = clean.replace(/"(?:[^"\\]|\\.)*"/g, (match) => '"' + ' '.repeat(match.length - 2) + '"');

    // Remove raw strings
    clean = clean.replace(/r#*"[\s\S]*?"#*/g, (match) => 'r"' + ' '.repeat(match.length - 3) + '"');

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

    // Pattern 1: Regular function declarations
    // pub fn function_name(params) -> ReturnType {
    // fn function_name(params) {
    // async fn function_name(params) -> ReturnType {
    // pub async fn function_name(params) -> ReturnType {
    const funcPattern = /^(\s*)(pub\s+)?(async\s+)?fn\s+([a-zA-Z_]\w*)\s*(?:<[^>]*>)?\s*\(([^)]*)\)\s*(?:->\s*([^{]+?))?\s*\{/gm;
    let match;

    while ((match = funcPattern.exec(cleanSource)) !== null) {
      const isPublic = !!match[2];
      const isAsync = !!match[3];
      const name = match[4]!;
      const paramsStr = match[5] ?? '';
      const returnType = match[6]?.trim();
      const startLine = this.getLineNumber(originalSource, match.index);
      const key = `${name}:${startLine}`;

      if (seen.has(key)) {continue;}
      seen.add(key);

      const endIndex = this.findBlockEnd(cleanSource, match.index);
      const endLine = this.getLineNumber(originalSource, endIndex);

      functions.push(
        this.createFunction({
          name,
          qualifiedName: name,
          startLine,
          endLine,
          parameters: this.parseRustParameters(paramsStr),
          ...(returnType ? { returnType } : {}),
          isMethod: paramsStr.includes('self'),
          isStatic: !paramsStr.includes('self'),
          isExported: isPublic,
          isConstructor: name === 'new' || name === 'default',
          isAsync,
          decorators: [],
        })
      );
    }

    // Pattern 2: Methods in impl blocks
    // impl Type { fn method(&self) { } }
    const implPattern = /impl\s+(?:<[^>]*>\s*)?([A-Za-z_]\w*(?:<[^>]*>)?)\s*(?:for\s+([A-Za-z_]\w*(?:<[^>]*>)?))?\s*\{/g;

    while ((match = implPattern.exec(cleanSource)) !== null) {
      const implType = match[2] ?? match[1]!;
      const implStart = match.index;
      const implEnd = this.findBlockEnd(cleanSource, implStart);
      const implBody = cleanSource.slice(implStart, implEnd);

      // Find methods within impl block
      const methodPattern = /^\s*(pub\s+)?(async\s+)?fn\s+([a-zA-Z_]\w*)\s*(?:<[^>]*>)?\s*\(([^)]*)\)\s*(?:->\s*([^{]+?))?\s*\{/gm;
      let methodMatch;

      while ((methodMatch = methodPattern.exec(implBody)) !== null) {
        const isPublic = !!methodMatch[1];
        const isAsync = !!methodMatch[2];
        const methodName = methodMatch[3]!;
        const paramsStr = methodMatch[4] ?? '';
        const returnType = methodMatch[5]?.trim();
        const methodStartLine = this.getLineNumber(originalSource, implStart + methodMatch.index);
        const key = `${implType}.${methodName}:${methodStartLine}`;

        if (seen.has(key)) {continue;}
        seen.add(key);

        const methodEndIndex = this.findBlockEnd(implBody, methodMatch.index);
        const methodEndLine = this.getLineNumber(originalSource, implStart + methodEndIndex);

        functions.push(
          this.createFunction({
            name: methodName,
            qualifiedName: `${implType}::${methodName}`,
            startLine: methodStartLine,
            endLine: methodEndLine,
            parameters: this.parseRustParameters(paramsStr),
            ...(returnType ? { returnType } : {}),
            isMethod: true,
            isStatic: !paramsStr.includes('self'),
            isExported: isPublic,
            isConstructor: methodName === 'new' || methodName === 'default',
            isAsync,
            className: implType,
            decorators: [],
          })
        );
      }
    }

    return functions;
  }

  /**
   * Parse Rust parameter string
   */
  private parseRustParameters(paramsStr: string): FunctionExtraction['parameters'] {
    if (!paramsStr.trim()) {return [];}

    const params: FunctionExtraction['parameters'] = [];
    const parts = this.splitRustParams(paramsStr);

    for (const part of parts) {
      const trimmed = part.trim();
      if (!trimmed) {continue;}

      // Handle self parameters
      if (trimmed === 'self' || trimmed === '&self' || trimmed === '&mut self' || trimmed === 'mut self') {
        params.push({ name: 'self', type: trimmed, hasDefault: false, isRest: false });
        continue;
      }

      // Pattern: name: Type or mut name: Type
      const paramMatch = trimmed.match(/^(mut\s+)?([a-zA-Z_]\w*)\s*:\s*(.+)$/);
      if (paramMatch) {
        const name = paramMatch[2]!;
        const type = paramMatch[3]!.trim();
        params.push({ name, type, hasDefault: false, isRest: false });
      }
    }

    return params;
  }

  /**
   * Split Rust parameters respecting nested brackets
   */
  private splitRustParams(paramsStr: string): string[] {
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
  // Class (Struct/Trait/Enum) Extraction
  // ==========================================================================

  protected extractClasses(
    cleanSource: string,
    originalSource: string,
    _filePath: string
  ): ClassExtraction[] {
    const classes: ClassExtraction[] = [];

    // Pattern 1: Struct declarations
    const structPattern = /(pub\s+)?struct\s+([A-Za-z_]\w*)(?:<[^>]*>)?\s*(?:\{|;|\()/g;
    let match;

    while ((match = structPattern.exec(cleanSource)) !== null) {
      const isPublic = !!match[1];
      const name = match[2]!;
      const startLine = this.getLineNumber(originalSource, match.index);
      
      let endLine = startLine;
      if (cleanSource[match.index + match[0].length - 1] === '{') {
        const endIndex = this.findBlockEnd(cleanSource, match.index);
        endLine = this.getLineNumber(originalSource, endIndex);
      }

      classes.push(
        this.createClass({
          name,
          startLine,
          endLine,
          baseClasses: [],
          methods: [],
          isExported: isPublic,
        })
      );
    }

    // Pattern 2: Trait declarations
    const traitPattern = /(pub\s+)?trait\s+([A-Za-z_]\w*)(?:<[^>]*>)?(?:\s*:\s*([^{]+))?\s*\{/g;

    while ((match = traitPattern.exec(cleanSource)) !== null) {
      const isPublic = !!match[1];
      const name = match[2]!;
      const boundsStr = match[3] ?? '';
      const startLine = this.getLineNumber(originalSource, match.index);
      const endIndex = this.findBlockEnd(cleanSource, match.index);
      const endLine = this.getLineNumber(originalSource, endIndex);

      // Extract super traits
      const baseClasses = boundsStr
        .split('+')
        .map(b => b.trim())
        .filter(Boolean);

      // Extract method signatures
      const traitBody = cleanSource.slice(match.index, endIndex);
      const methods = this.extractTraitMethods(traitBody);

      classes.push(
        this.createClass({
          name,
          startLine,
          endLine,
          baseClasses,
          methods,
          isExported: isPublic,
        })
      );
    }

    // Pattern 3: Enum declarations
    const enumPattern = /(pub\s+)?enum\s+([A-Za-z_]\w*)(?:<[^>]*>)?\s*\{/g;

    while ((match = enumPattern.exec(cleanSource)) !== null) {
      const isPublic = !!match[1];
      const name = match[2]!;
      const startLine = this.getLineNumber(originalSource, match.index);
      const endIndex = this.findBlockEnd(cleanSource, match.index);
      const endLine = this.getLineNumber(originalSource, endIndex);

      classes.push(
        this.createClass({
          name,
          startLine,
          endLine,
          baseClasses: [],
          methods: [],
          isExported: isPublic,
        })
      );
    }

    return classes;
  }

  /**
   * Extract method signatures from trait body
   */
  private extractTraitMethods(traitBody: string): string[] {
    const methods: string[] = [];
    const methodPattern = /fn\s+([a-zA-Z_]\w*)\s*(?:<[^>]*>)?\s*\(/g;
    let match;

    while ((match = methodPattern.exec(traitBody)) !== null) {
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

    // Pattern 1: Simple use statements
    // use std::collections::HashMap;
    // use crate::module::Type;
    const simpleUsePattern = /use\s+([a-zA-Z_][\w:]*(?:::\*)?)\s*;/g;
    let match;

    while ((match = simpleUsePattern.exec(cleanSource)) !== null) {
      const path = match[1]!;
      const line = this.getLineNumber(originalSource, match.index);
      const parts = path.split('::');
      const name = parts[parts.length - 1] ?? path;
      const isGlob = name === '*';

      imports.push(
        this.createImport({
          source: path,
          names: [{
            imported: isGlob ? '*' : name,
            local: isGlob ? '*' : name,
            isDefault: false,
            isNamespace: isGlob,
          }],
          line,
        })
      );
    }

    // Pattern 2: Use with alias
    // use std::collections::HashMap as Map;
    const aliasUsePattern = /use\s+([a-zA-Z_][\w:]*)\s+as\s+([a-zA-Z_]\w*)\s*;/g;

    while ((match = aliasUsePattern.exec(cleanSource)) !== null) {
      const path = match[1]!;
      const alias = match[2]!;
      const line = this.getLineNumber(originalSource, match.index);
      const parts = path.split('::');
      const name = parts[parts.length - 1] ?? path;

      imports.push(
        this.createImport({
          source: path,
          names: [{
            imported: name,
            local: alias,
            isDefault: false,
            isNamespace: false,
          }],
          line,
        })
      );
    }

    // Pattern 3: Use with braces
    // use std::collections::{HashMap, HashSet};
    const braceUsePattern = /use\s+([a-zA-Z_][\w:]*)::\{([^}]+)\}\s*;/g;

    while ((match = braceUsePattern.exec(cleanSource)) !== null) {
      const basePath = match[1]!;
      const itemsStr = match[2]!;
      const line = this.getLineNumber(originalSource, match.index);

      const items = itemsStr.split(',').map(i => i.trim()).filter(Boolean);
      
      for (const item of items) {
        // Handle alias: Item as Alias
        const aliasMatch = item.match(/^([a-zA-Z_]\w*)\s+as\s+([a-zA-Z_]\w*)$/);
        if (aliasMatch) {
          imports.push(
            this.createImport({
              source: `${basePath}::${aliasMatch[1]}`,
              names: [{
                imported: aliasMatch[1]!,
                local: aliasMatch[2]!,
                isDefault: false,
                isNamespace: false,
              }],
              line,
            })
          );
        } else if (item === 'self') {
          const selfName = basePath.split('::').pop() ?? basePath;
          imports.push(
            this.createImport({
              source: basePath,
              names: [{
                imported: selfName,
                local: selfName,
                isDefault: false,
                isNamespace: false,
              }],
              line,
            })
          );
        } else if (item === '*') {
          imports.push(
            this.createImport({
              source: `${basePath}::*`,
              names: [{
                imported: '*',
                local: '*',
                isDefault: false,
                isNamespace: true,
              }],
              line,
            })
          );
        } else {
          imports.push(
            this.createImport({
              source: `${basePath}::${item}`,
              names: [{
                imported: item,
                local: item,
                isDefault: false,
                isNamespace: false,
              }],
              line,
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

    // In Rust, pub items are exports
    // pub fn, pub struct, pub enum, pub trait, pub const, pub static, pub type, pub mod

    // Pattern: pub fn name
    const pubFnPattern = /pub\s+(?:async\s+)?fn\s+([a-zA-Z_]\w*)/g;
    let match;

    while ((match = pubFnPattern.exec(cleanSource)) !== null) {
      exports.push(
        this.createExport({
          name: match[1]!,
          line: this.getLineNumber(originalSource, match.index),
        })
      );
    }

    // Pattern: pub struct/enum/trait name
    const pubTypePattern = /pub\s+(?:struct|enum|trait)\s+([A-Za-z_]\w*)/g;

    while ((match = pubTypePattern.exec(cleanSource)) !== null) {
      exports.push(
        this.createExport({
          name: match[1]!,
          line: this.getLineNumber(originalSource, match.index),
        })
      );
    }

    // Pattern: pub const/static name
    const pubConstPattern = /pub\s+(?:const|static)\s+([A-Z_][A-Z0-9_]*)/g;

    while ((match = pubConstPattern.exec(cleanSource)) !== null) {
      exports.push(
        this.createExport({
          name: match[1]!,
          line: this.getLineNumber(originalSource, match.index),
        })
      );
    }

    // Pattern: pub mod name
    const pubModPattern = /pub\s+mod\s+([a-zA-Z_]\w*)/g;

    while ((match = pubModPattern.exec(cleanSource)) !== null) {
      exports.push(
        this.createExport({
          name: match[1]!,
          line: this.getLineNumber(originalSource, match.index),
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

    // Rust keywords to skip
    const keywords = new Set([
      'if', 'else', 'while', 'for', 'loop', 'match', 'return', 'break', 'continue',
      'fn', 'let', 'mut', 'const', 'static', 'struct', 'enum', 'trait', 'impl',
      'pub', 'mod', 'use', 'as', 'where', 'type', 'unsafe', 'async', 'await',
      'move', 'ref', 'self', 'Self', 'super', 'crate', 'dyn', 'extern',
      'true', 'false', 'Some', 'None', 'Ok', 'Err',
    ]);

    // Pattern 1: Method calls - obj.method()
    const methodCallPattern = /(\w+)\.([a-zA-Z_]\w*)\s*\(/g;
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
          isConstructorCall: calleeName === 'new' || calleeName === 'default',
        })
      );
    }

    // Pattern 2: Path calls - Path::to::function()
    const pathCallPattern = /([A-Za-z_][\w:]*)::\s*([a-zA-Z_]\w*)\s*\(/g;

    while ((match = pathCallPattern.exec(cleanSource)) !== null) {
      const path = match[1]!;
      const calleeName = match[2]!;
      const line = this.getLineNumber(originalSource, match.index);
      const key = `${path}::${calleeName}:${line}`;

      if (seen.has(key)) {continue;}
      if (keywords.has(calleeName)) {continue;}
      seen.add(key);

      calls.push(
        this.createCall({
          calleeName,
          receiver: path,
          fullExpression: `${path}::${calleeName}`,
          line,
          isMethodCall: false,
          isConstructorCall: calleeName === 'new' || calleeName === 'default',
        })
      );
    }

    // Pattern 3: Direct function calls - function_name()
    const funcCallPattern = /(?<![.:])([a-z_][a-z0-9_]*)\s*\(/g;

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
          isConstructorCall: false,
        })
      );
    }

    // Pattern 4: Macro invocations - macro_name!()
    const macroCallPattern = /([a-z_][a-z0-9_]*)!\s*[\(\[\{]/g;

    while ((match = macroCallPattern.exec(cleanSource)) !== null) {
      const calleeName = match[1]! + '!';
      const line = this.getLineNumber(originalSource, match.index);
      const key = `${calleeName}:${line}`;

      if (seen.has(key)) {continue;}
      seen.add(key);

      calls.push(
        this.createCall({
          calleeName,
          fullExpression: calleeName,
          line,
          isConstructorCall: false,
        })
      );
    }

    return calls;
  }
}

/**
 * Create a Rust regex extractor instance
 */
export function createRustRegexExtractor(): RustRegexExtractor {
  return new RustRegexExtractor();
}
