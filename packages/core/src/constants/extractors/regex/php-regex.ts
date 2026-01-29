/**
 * PHP Constant Regex Extractor
 *
 * Regex-based extraction for PHP constants and enums.
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
 * PHP constant regex extractor
 */
export class PhpConstantRegexExtractor extends BaseConstantRegexExtractor {
  readonly language = 'php' as const;

  /**
   * Extract constants from PHP source
   */
  protected extractConstants(source: string, filePath: string): ConstantExtraction[] {
    const constants: ConstantExtraction[] = [];
    let match: RegExpExecArray | null;

    // Pattern 1: Class constants
    // public const MAX_RETRIES = 3;
    // private const API_KEY = 'secret';
    const classConstPattern = 
      /(public|private|protected)?\s*(const)\s+([A-Z][A-Z0-9_]*)\s*=\s*([^;]+);/g;

    while ((match = classConstPattern.exec(source)) !== null) {
      const visibility = match[1] ?? 'public';
      const name = match[3];
      if (!name) {continue;}
      const rawValue = match[4]?.trim();
      if (!rawValue) {continue;}

      const line = this.getLineNumber(source, match.index);
      const column = this.getColumnNumber(source, match.index);
      const className = this.findContainingClass(source, match.index);
      const docComment = this.extractDocComment(source, line);

      const kind = this.inferPhpKind(rawValue);
      const value = this.extractPhpValue(rawValue, kind);

      constants.push({
        id: this.generateId(filePath, className ? `${className}::${name}` : name, line),
        name,
        qualifiedName: className ? `${className}::${name}` : name,
        file: filePath,
        line,
        column,
        endLine: line,
        language: this.language,
        kind: 'class_constant',
        category: 'uncategorized',
        value,
        rawValue: this.truncateValue(rawValue),
        isExported: visibility === 'public',
        ...(className ? { parentName: className } : {}),
        parentType: 'class',
        decorators: [],
        modifiers: ['const', visibility],
        confidence: 0.75,
        ...(docComment ? { docComment } : {}),
      });
    }

    // Pattern 2: define() constants
    // define('APP_VERSION', '1.0.0');
    // define("MAX_SIZE", 1000);
    const definePattern = /define\s*\(\s*(['"])([A-Z][A-Z0-9_]*)\1\s*,\s*([^)]+)\)/g;

    while ((match = definePattern.exec(source)) !== null) {
      const name = match[2];
      if (!name) {continue;}
      const rawValue = match[3]?.trim();
      if (!rawValue) {continue;}

      const line = this.getLineNumber(source, match.index);
      const column = this.getColumnNumber(source, match.index);
      const docComment = this.extractDocComment(source, line);

      const kind = this.inferPhpKind(rawValue);
      const value = this.extractPhpValue(rawValue, kind);

      constants.push({
        id: this.generateId(filePath, name, line),
        name,
        qualifiedName: name,
        file: filePath,
        line,
        column,
        endLine: line,
        language: this.language,
        kind: kind === 'primitive' ? 'primitive' : kind,
        category: 'uncategorized',
        value,
        rawValue: this.truncateValue(rawValue),
        isExported: true, // define() constants are global
        decorators: [],
        modifiers: ['define'],
        confidence: 0.75,
        ...(docComment ? { docComment } : {}),
      });
    }

    return constants;
  }


  /**
   * Extract enums from PHP source (PHP 8.1+)
   */
  protected extractEnums(source: string, filePath: string): EnumExtraction[] {
    const enums: EnumExtraction[] = [];
    
    // Pattern: enum EnumName: string|int { ... }
    const enumPattern = /enum\s+(\w+)\s*(?::\s*(string|int))?\s*\{([^}]*)\}/gs;

    let match: RegExpExecArray | null;
    while ((match = enumPattern.exec(source)) !== null) {
      const name = match[1];
      if (!name) {continue;}
      const backingType = match[2] ?? 'int';
      const body = match[3];
      if (!body) {continue;}
      const line = this.getLineNumber(source, match.index);
      const endLine = this.getLineNumber(source, match.index + match[0].length);
      const docComment = this.extractDocComment(source, line);

      const isStringEnum = backingType === 'string';
      const members = this.parsePhpEnumMembers(body, line, isStringEnum);

      enums.push({
        id: this.generateId(filePath, name, line),
        name,
        qualifiedName: name,
        file: filePath,
        line,
        endLine,
        language: this.language,
        isExported: true,
        members,
        isFlags: false,
        isStringEnum,
        backingType,
        decorators: [],
        modifiers: [],
        confidence: 0.8,
        ...(docComment ? { docComment } : {}),
      });
    }

    return enums;
  }

  /**
   * Parse PHP enum members
   */
  private parsePhpEnumMembers(body: string, startLine: number, _isStringEnum: boolean): EnumMember[] {
    const members: EnumMember[] = [];
    const lines = body.split('\n');
    let currentLine = startLine;
    let autoValue = 0;

    for (const line of lines) {
      currentLine++;
      const trimmed = line.trim();

      // Skip empty lines and comments
      if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('#')) {
        continue;
      }

      // Skip methods
      if (trimmed.includes('function ')) {
        continue;
      }

      // Match enum case: case Name = 'value'; or case Name;
      const memberMatch = trimmed.match(/^case\s+(\w+)\s*(?:=\s*([^;]+))?\s*;/);
      if (memberMatch) {
        const memberName = memberMatch[1];
        if (!memberName) {continue;}
        const rawValue = memberMatch[2]?.trim();

        let value: string | number | undefined;
        let isAutoValue = false;

        if (rawValue) {
          if (rawValue.startsWith("'") || rawValue.startsWith('"')) {
            value = rawValue.slice(1, -1);
          } else if (/^-?\d+$/.test(rawValue)) {
            value = parseInt(rawValue, 10);
            autoValue = value + 1;
          } else {
            value = rawValue;
          }
        } else {
          value = autoValue;
          autoValue++;
          isAutoValue = true;
        }

        members.push({
          name: memberName,
          value,
          line: currentLine,
          isAutoValue,
        });
      }
    }

    return members;
  }


  /**
   * Infer kind from PHP value
   */
  private inferPhpKind(value: string): ConstantKind {
    const trimmed = value.trim();
    
    // Array
    if (trimmed.startsWith('[') || trimmed.startsWith('array(')) {
      return 'array';
    }
    // Object/new instance
    if (trimmed.startsWith('new ')) {
      return 'object';
    }
    // String
    if (trimmed.startsWith("'") || trimmed.startsWith('"')) {
      return 'primitive';
    }
    // Number
    if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
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
    
    return 'computed';
  }

  /**
   * Extract value from PHP literal
   */
  private extractPhpValue(
    rawValue: string,
    kind: ConstantKind
  ): string | number | boolean | null {
    if (kind === 'object' || kind === 'array' || kind === 'computed') {
      return null;
    }

    const trimmed = rawValue.trim();

    // Single-quoted string
    if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
      return trimmed.slice(1, -1);
    }

    // Double-quoted string
    if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
      return trimmed.slice(1, -1);
    }

    // Integer
    if (/^-?\d+$/.test(trimmed)) {
      return parseInt(trimmed, 10);
    }

    // Float
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
    const classMatch = beforePosition.match(/class\s+(\w+)(?:\s+extends\s+\w+)?(?:\s+implements\s+[\w,\s\\]+)?\s*\{[^}]*$/);

    if (classMatch?.[1]) {
      return classMatch[1];
    }

    return null;
  }
}
