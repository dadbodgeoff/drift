/**
 * Java Constant Regex Extractor
 *
 * Regex-based extraction for Java constants and enums.
 * Used as fallback when tree-sitter is unavailable.
 */

import { BaseConstantRegexExtractor } from './base-regex.js';

import type {
  ConstantExtraction,
  EnumExtraction,
  EnumMember,
  ConstantKind,
} from '../../types.js';

/**
 * Java constant regex extractor
 */
export class JavaConstantRegexExtractor extends BaseConstantRegexExtractor {
  readonly language = 'java' as const;

  /**
   * Extract constants from Java source
   */
  protected extractConstants(source: string, filePath: string): ConstantExtraction[] {
    const constants: ConstantExtraction[] = [];
    let match: RegExpExecArray | null;

    // Pattern 1: static final fields
    // public static final int MAX_SIZE = 1000;
    // private static final String API_KEY = "key";
    const staticFinalPattern = 
      /(public|private|protected)?\s*(static)\s+(final)\s+(\w+(?:<[^>]+>)?)\s+([A-Z][A-Z0-9_]*)\s*=\s*([^;]+);/g;

    while ((match = staticFinalPattern.exec(source)) !== null) {
      const visibility = match[1] ?? 'package';
      const type = match[4];
      const name = match[5];
      if (!name || !type) {continue;}
      const rawValue = match[6]?.trim();
      if (!rawValue) {continue;}

      const line = this.getLineNumber(source, match.index);
      const column = this.getColumnNumber(source, match.index);
      const className = this.findContainingClass(source, match.index);
      const docComment = this.extractDocComment(source, line);

      const kind = this.inferJavaKind(rawValue, type);
      const value = this.extractJavaValue(rawValue, kind);

      constants.push({
        id: this.generateId(filePath, className ? `${className}.${name}` : name, line),
        name,
        qualifiedName: className ? `${className}.${name}` : name,
        file: filePath,
        line,
        column,
        endLine: line,
        language: this.language,
        kind: kind === 'primitive' ? 'class_constant' : kind,
        category: 'uncategorized',
        value,
        rawValue: this.truncateValue(rawValue),
        type,
        isExported: visibility === 'public',
        ...(className ? { parentName: className } : {}),
        parentType: 'class',
        decorators: [],
        modifiers: ['static', 'final'],
        confidence: 0.75,
        ...(docComment ? { docComment } : {}),
      });
    }

    // Pattern 2: Interface constants (implicitly public static final)
    // String VERSION = "1.0.0";
    const interfaceConstPattern = 
      /interface\s+(\w+)\s*(?:extends\s+[\w,\s<>]+)?\s*\{([^}]*)\}/gs;

    while ((match = interfaceConstPattern.exec(source)) !== null) {
      const interfaceName = match[1];
      if (!interfaceName) {continue;}
      const body = match[2];
      if (!body) {continue;}
      const interfaceLine = this.getLineNumber(source, match.index);

      // Find constants in interface body
      const constPattern = /(\w+(?:<[^>]+>)?)\s+([A-Z][A-Z0-9_]*)\s*=\s*([^;]+);/g;
      let constMatch: RegExpExecArray | null;

      while ((constMatch = constPattern.exec(body)) !== null) {
        const type = constMatch[1];
        const name = constMatch[2];
        if (!name || !type) {continue;}
        const rawValue = constMatch[3]?.trim();
        if (!rawValue) {continue;}

        const line = interfaceLine + this.countNewlines(body.slice(0, constMatch.index));
        const kind = this.inferJavaKind(rawValue, type);
        const value = this.extractJavaValue(rawValue, kind);

        constants.push({
          id: this.generateId(filePath, `${interfaceName}.${name}`, line),
          name,
          qualifiedName: `${interfaceName}.${name}`,
          file: filePath,
          line,
          column: 1,
          endLine: line,
          language: this.language,
          kind: 'interface_constant',
          category: 'uncategorized',
          value,
          rawValue: this.truncateValue(rawValue),
          type,
          isExported: true,
          parentName: interfaceName,
          parentType: 'interface',
          decorators: [],
          modifiers: ['public', 'static', 'final'],
          confidence: 0.75,
        });
      }
    }

    return constants;
  }


  /**
   * Extract enums from Java source
   */
  protected extractEnums(source: string, filePath: string): EnumExtraction[] {
    const enums: EnumExtraction[] = [];
    
    // Pattern: public enum EnumName { ... }
    const enumPattern = /(public|private|protected)?\s*enum\s+(\w+)\s*(?:implements\s+[\w,\s<>]+)?\s*\{([^}]*)\}/gs;

    let match: RegExpExecArray | null;
    while ((match = enumPattern.exec(source)) !== null) {
      const visibility = match[1] ?? 'package';
      const name = match[2];
      if (!name) {continue;}
      const body = match[3];
      if (!body) {continue;}
      const line = this.getLineNumber(source, match.index);
      const endLine = this.getLineNumber(source, match.index + match[0].length);
      const docComment = this.extractDocComment(source, line);

      const members = this.parseJavaEnumMembers(body, line);

      enums.push({
        id: this.generateId(filePath, name, line),
        name,
        qualifiedName: name,
        file: filePath,
        line,
        endLine,
        language: this.language,
        isExported: visibility === 'public',
        members,
        isFlags: false,
        isStringEnum: false,
        backingType: 'int',
        decorators: [],
        modifiers: visibility !== 'package' ? [visibility] : [],
        confidence: 0.8,
        ...(docComment ? { docComment } : {}),
      });
    }

    return enums;
  }

  /**
   * Parse Java enum members
   */
  private parseJavaEnumMembers(body: string, startLine: number): EnumMember[] {
    const members: EnumMember[] = [];
    
    // Split by semicolon to separate enum constants from methods
    const constantsPart = body.split(';')[0] ?? body;
    
    // Match enum constants: NAME, NAME(args), NAME { ... }
    const memberPattern = /([A-Z][A-Z0-9_]*)\s*(?:\([^)]*\))?\s*(?:\{[^}]*\})?\s*,?/g;
    
    let match: RegExpExecArray | null;
    let index = 0;
    
    while ((match = memberPattern.exec(constantsPart)) !== null) {
      const name = match[1];
      if (!name) {continue;}
      
      const lineOffset = this.countNewlines(constantsPart.slice(0, match.index));
      
      members.push({
        name,
        value: index,
        line: startLine + lineOffset + 1,
        isAutoValue: true,
      });
      
      index++;
    }

    return members;
  }


  /**
   * Infer kind from Java value and type
   */
  private inferJavaKind(value: string, type: string): ConstantKind {
    const trimmed = value.trim();
    
    // Array initializer
    if (trimmed.startsWith('{') || trimmed.startsWith('new ') && trimmed.includes('[')) {
      return 'array';
    }
    // Object creation
    if (trimmed.startsWith('new ')) {
      return 'object';
    }
    // String
    if (trimmed.startsWith('"')) {
      return 'primitive';
    }
    // Character
    if (trimmed.startsWith("'")) {
      return 'primitive';
    }
    // Number
    if (/^-?\d+(\.\d+)?[LlFfDd]?$/.test(trimmed)) {
      return 'primitive';
    }
    // Boolean
    if (trimmed === 'true' || trimmed === 'false') {
      return 'primitive';
    }
    // null
    if (trimmed === 'null') {
      return 'primitive';
    }
    // Primitive types
    if (['int', 'long', 'short', 'byte', 'float', 'double', 'boolean', 'char', 'String'].includes(type)) {
      return 'primitive';
    }
    
    return 'computed';
  }

  /**
   * Extract value from Java literal
   */
  private extractJavaValue(
    rawValue: string,
    kind: ConstantKind
  ): string | number | boolean | null {
    if (kind === 'object' || kind === 'array' || kind === 'computed') {
      return null;
    }

    const trimmed = rawValue.trim();

    // String literal
    if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
      return trimmed.slice(1, -1);
    }

    // Character literal
    if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
      return trimmed.slice(1, -1);
    }

    // Long literal
    if (/^-?\d+[Ll]$/.test(trimmed)) {
      return parseInt(trimmed.slice(0, -1), 10);
    }

    // Float/Double literal
    if (/^-?\d+(\.\d+)?[FfDd]$/.test(trimmed)) {
      return parseFloat(trimmed.slice(0, -1));
    }

    // Integer
    if (/^-?\d+$/.test(trimmed)) {
      return parseInt(trimmed, 10);
    }

    // Decimal
    if (/^-?\d+\.\d+$/.test(trimmed)) {
      return parseFloat(trimmed);
    }

    // Boolean
    if (trimmed === 'true') {return true;}
    if (trimmed === 'false') {return false;}
    if (trimmed === 'null') {return null;}

    return null;
  }

  /**
   * Find the containing class name
   */
  private findContainingClass(source: string, position: number): string | null {
    const beforePosition = source.slice(0, position);
    const classMatch = beforePosition.match(/class\s+(\w+)(?:\s+extends\s+\w+)?(?:\s+implements\s+[\w,\s]+)?\s*\{[^}]*$/);

    if (classMatch?.[1]) {
      return classMatch[1];
    }

    return null;
  }

  /**
   * Count newlines in a string
   */
  private countNewlines(str: string): number {
    return (str.match(/\n/g) || []).length;
  }
}
