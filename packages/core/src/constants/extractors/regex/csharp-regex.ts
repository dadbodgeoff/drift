/**
 * C# Constant Regex Extractor
 *
 * Regex-based extraction for C# constants and enums.
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
 * C# constant regex extractor
 */
export class CSharpConstantRegexExtractor extends BaseConstantRegexExtractor {
  readonly language = 'csharp' as const;

  /**
   * Extract constants from C# source
   */
  protected extractConstants(source: string, filePath: string): ConstantExtraction[] {
    const constants: ConstantExtraction[] = [];
    let match: RegExpExecArray | null;

    // Pattern 1: const fields
    // public const int MaxRetries = 3;
    // private const string ApiUrl = "https://api.example.com";
    const constPattern = 
      /(public|private|protected|internal)?\s*(const)\s+(\w+(?:<[^>]+>)?)\s+(\w+)\s*=\s*([^;]+);/g;

    while ((match = constPattern.exec(source)) !== null) {
      const visibility = match[1] ?? 'private';
      const type = match[3];
      const name = match[4];
      if (!name || !type) {continue;}
      const rawValue = match[5]?.trim();
      if (!rawValue) {continue;}

      // Skip if name doesn't look like a constant (PascalCase or UPPER_CASE)
      if (!/^[A-Z]/.test(name)) {continue;}

      const line = this.getLineNumber(source, match.index);
      const column = this.getColumnNumber(source, match.index);
      const className = this.findContainingClass(source, match.index);
      const docComment = this.extractDocComment(source, line);

      const kind = this.inferCSharpKind(rawValue, type);
      const value = this.extractCSharpValue(rawValue, kind);

      constants.push({
        id: this.generateId(filePath, className ? `${className}.${name}` : name, line),
        name,
        qualifiedName: className ? `${className}.${name}` : name,
        file: filePath,
        line,
        column,
        endLine: line,
        language: this.language,
        kind: 'class_constant',
        category: 'uncategorized',
        value,
        rawValue: this.truncateValue(rawValue),
        type,
        isExported: visibility === 'public',
        ...(className ? { parentName: className } : {}),
        parentType: 'class',
        decorators: [],
        modifiers: ['const'],
        confidence: 0.75,
        ...(docComment ? { docComment } : {}),
      });
    }

    // Pattern 2: static readonly fields
    // public static readonly TimeSpan Timeout = TimeSpan.FromSeconds(30);
    const staticReadonlyPattern = 
      /(public|private|protected|internal)?\s*(static)\s+(readonly)\s+(\w+(?:<[^>]+>)?)\s+(\w+)\s*=\s*([^;]+);/g;

    while ((match = staticReadonlyPattern.exec(source)) !== null) {
      const visibility = match[1] ?? 'private';
      const type = match[4];
      const name = match[5];
      if (!name || !type) {continue;}
      const rawValue = match[6]?.trim();
      if (!rawValue) {continue;}

      // Skip if name doesn't look like a constant
      if (!/^[A-Z]/.test(name)) {continue;}

      const line = this.getLineNumber(source, match.index);
      const column = this.getColumnNumber(source, match.index);
      const className = this.findContainingClass(source, match.index);
      const docComment = this.extractDocComment(source, line);

      // Skip if already captured as const
      if (constants.some(c => c.name === name && c.line === line)) {
        continue;
      }

      const kind = this.inferCSharpKind(rawValue, type);
      const value = this.extractCSharpValue(rawValue, kind);

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
        modifiers: ['static', 'readonly'],
        confidence: 0.7,
        ...(docComment ? { docComment } : {}),
      });
    }

    return constants;
  }


  /**
   * Extract enums from C# source
   */
  protected extractEnums(source: string, filePath: string): EnumExtraction[] {
    const enums: EnumExtraction[] = [];
    
    // Pattern: [Flags]? public enum EnumName : type? { ... }
    const enumPattern = /(\[Flags\]\s*)?(public|private|protected|internal)?\s*enum\s+(\w+)\s*(?::\s*(\w+))?\s*\{([^}]*)\}/gs;

    let match: RegExpExecArray | null;
    while ((match = enumPattern.exec(source)) !== null) {
      const isFlags = !!match[1];
      const visibility = match[2] ?? 'internal';
      const name = match[3];
      if (!name) {continue;}
      const backingType = match[4] ?? 'int';
      const body = match[5];
      if (!body) {continue;}
      const line = this.getLineNumber(source, match.index);
      const endLine = this.getLineNumber(source, match.index + match[0].length);
      const docComment = this.extractDocComment(source, line);

      const members = this.parseCSharpEnumMembers(body, line, isFlags);

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
        isFlags,
        isStringEnum: false,
        backingType,
        decorators: isFlags ? ['Flags'] : [],
        modifiers: visibility !== 'internal' ? [visibility] : [],
        confidence: 0.8,
        ...(docComment ? { docComment } : {}),
      });
    }

    return enums;
  }

  /**
   * Parse C# enum members
   */
  private parseCSharpEnumMembers(body: string, startLine: number, isFlags: boolean): EnumMember[] {
    const members: EnumMember[] = [];
    const lines = body.split('\n');
    let currentLine = startLine;
    let autoValue = isFlags ? 1 : 0;

    for (const line of lines) {
      currentLine++;
      const trimmed = line.trim();

      // Skip empty lines and comments
      if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('/*')) {
        continue;
      }

      // Match enum member: Name = value, or just Name,
      const memberMatch = trimmed.match(/^(\w+)\s*(?:=\s*([^,]+))?\s*,?\s*(?:\/\/.*)?$/);
      if (memberMatch) {
        const memberName = memberMatch[1];
        if (!memberName) {continue;}
        const rawValue = memberMatch[2]?.trim();

        let value: number | undefined;
        let isAutoValue = false;

        if (rawValue) {
          // Handle hex values
          if (rawValue.startsWith('0x') || rawValue.startsWith('0X')) {
            value = parseInt(rawValue, 16);
          } else if (/^-?\d+$/.test(rawValue)) {
            value = parseInt(rawValue, 10);
          } else {
            // Expression like 1 << 2
            value = undefined;
          }
          if (value !== undefined) {
            autoValue = isFlags ? value * 2 : value + 1;
          }
        } else {
          value = autoValue;
          autoValue = isFlags ? autoValue * 2 : autoValue + 1;
          isAutoValue = true;
        }

        members.push({
          name: memberName,
          ...(value !== undefined ? { value } : {}),
          line: currentLine,
          isAutoValue,
        });
      }
    }

    return members;
  }


  /**
   * Infer kind from C# value and type
   */
  private inferCSharpKind(value: string, type: string): ConstantKind {
    const trimmed = value.trim();
    
    // Array initializer
    if (trimmed.startsWith('{') || trimmed.startsWith('new ') && trimmed.includes('[')) {
      return 'array';
    }
    // Object creation
    if (trimmed.startsWith('new ')) {
      return 'object';
    }
    // String (including verbatim and interpolated)
    if (trimmed.startsWith('"') || trimmed.startsWith('@"') || trimmed.startsWith('$"')) {
      return 'primitive';
    }
    // Character
    if (trimmed.startsWith("'")) {
      return 'primitive';
    }
    // Number
    if (/^-?\d+(\.\d+)?[MmFfDdLlUu]*$/.test(trimmed)) {
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
    if (['int', 'long', 'short', 'byte', 'float', 'double', 'decimal', 'bool', 'char', 'string', 'String'].includes(type)) {
      return 'primitive';
    }
    
    return 'computed';
  }

  /**
   * Extract value from C# literal
   */
  private extractCSharpValue(
    rawValue: string,
    kind: ConstantKind
  ): string | number | boolean | null {
    if (kind === 'object' || kind === 'array' || kind === 'computed') {
      return null;
    }

    const trimmed = rawValue.trim();

    // Verbatim string literal
    if (trimmed.startsWith('@"') && trimmed.endsWith('"')) {
      return trimmed.slice(2, -1);
    }

    // Interpolated string
    if (trimmed.startsWith('$"') && trimmed.endsWith('"')) {
      return trimmed.slice(2, -1);
    }

    // Regular string literal
    if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
      return trimmed.slice(1, -1);
    }

    // Character literal
    if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
      return trimmed.slice(1, -1);
    }

    // Decimal literal
    if (/^-?\d+(\.\d+)?[Mm]$/.test(trimmed)) {
      return parseFloat(trimmed.slice(0, -1));
    }

    // Long/ULong literal
    if (/^-?\d+[LlUu]+$/.test(trimmed)) {
      return parseInt(trimmed.replace(/[LlUu]+$/, ''), 10);
    }

    // Float/Double literal
    if (/^-?\d+(\.\d+)?[FfDd]$/.test(trimmed)) {
      return parseFloat(trimmed.slice(0, -1));
    }

    // Integer
    if (/^-?\d+$/.test(trimmed)) {
      return parseInt(trimmed, 10);
    }

    // Decimal number
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
   * Find the containing class/struct name
   */
  private findContainingClass(source: string, position: number): string | null {
    const beforePosition = source.slice(0, position);
    const classMatch = beforePosition.match(/(class|struct|record)\s+(\w+)(?:<[^>]+>)?(?:\s*:\s*[\w,\s<>]+)?\s*\{[^}]*$/);

    if (classMatch?.[2]) {
      return classMatch[2];
    }

    return null;
  }
}
