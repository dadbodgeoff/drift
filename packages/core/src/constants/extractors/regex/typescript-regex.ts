/**
 * TypeScript/JavaScript Constant Regex Extractor
 *
 * Regex-based extraction for TypeScript and JavaScript constants.
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
 * TypeScript/JavaScript constant regex extractor
 */
export class TypeScriptConstantRegexExtractor extends BaseConstantRegexExtractor {
  readonly language = 'typescript' as const;

  /**
   * Extract constants from TypeScript/JavaScript source
   */
  protected extractConstants(source: string, filePath: string): ConstantExtraction[] {
    const constants: ConstantExtraction[] = [];
    let match: RegExpExecArray | null;

    // Pattern 1: as const objects
    const asConstPattern =
      /(export\s+)?const\s+([A-Z][A-Z0-9_]*)\s*=\s*(\{[^}]*\})\s*as\s+const/g;

    while ((match = asConstPattern.exec(source)) !== null) {
      const isExported = !!match[1];
      const name = match[2];
      if (!name) {continue;}
      const rawValue = match[3];
      if (!rawValue) {continue;}
      const line = this.getLineNumber(source, match.index);
      const column = this.getColumnNumber(source, match.index);
      const docComment = this.extractDocComment(source, line);

      constants.push({
        id: this.generateId(filePath, name, line),
        name,
        qualifiedName: name,
        file: filePath,
        line,
        column,
        endLine: line,
        language: this.language,
        kind: 'object',
        category: 'uncategorized',
        rawValue: this.truncateValue(rawValue),
        isExported,
        decorators: [],
        modifiers: ['const', 'as_const'],
        confidence: 0.75,
        ...(docComment ? { docComment } : {}),
      });
    }

    // Pattern 2: Object.freeze({ ... })
    const freezePattern =
      /^[ \t]*(export\s+)?const\s+([A-Z][A-Z0-9_]*)\s*=\s*Object\.freeze\s*\(\s*(\{[\s\S]*?\})\s*\)/gm;

    while ((match = freezePattern.exec(source)) !== null) {
      const isExported = !!match[1];
      const name = match[2];
      if (!name) {continue;}
      const rawValue = match[3];
      if (!rawValue) {continue;}
      const line = this.getLineNumber(source, match.index);
      const column = this.getColumnNumber(source, match.index);
      const docComment = this.extractDocComment(source, line);

      // Skip if already captured
      if (constants.some((c) => c.name === name && c.line === line)) {
        continue;
      }

      constants.push({
        id: this.generateId(filePath, name, line),
        name,
        qualifiedName: name,
        file: filePath,
        line,
        column,
        endLine: line,
        language: this.language,
        kind: 'object',
        category: 'uncategorized',
        rawValue: this.truncateValue(rawValue),
        isExported,
        decorators: [],
        modifiers: ['const', 'frozen'],
        confidence: 0.75,
        ...(docComment ? { docComment } : {}),
      });
    }

    // Pattern 3: Basic const - export const NAME = value
    const constPattern =
      /^[ \t]*(export\s+)?const\s+([A-Z][A-Z0-9_]*)\s*(?::\s*([^=]+?))?\s*=\s*(.+?)(?:;|$)/gm;

    while ((match = constPattern.exec(source)) !== null) {
      const isExported = !!match[1];
      const name = match[2];
      if (!name) {continue;}
      const type = match[3]?.trim();
      const rawValue = match[4]?.trim();
      if (!rawValue) {continue;}
      const line = this.getLineNumber(source, match.index);
      const column = this.getColumnNumber(source, match.index);

      // Skip if already captured
      if (constants.some((c) => c.name === name && c.line === line)) {
        continue;
      }

      // Skip if inside a function/class (check indentation)
      const lineStart = source.lastIndexOf('\n', match.index) + 1;
      const indent = match.index - lineStart;
      if (indent > 2) {
        continue;
      }

      // Skip Object.freeze patterns
      if (rawValue.startsWith('Object.freeze')) {
        continue;
      }

      // Skip incomplete object literals
      if (rawValue === '{' || (rawValue.startsWith('{') && !rawValue.includes('}'))) {
        continue;
      }

      const kind = this.inferKind(rawValue);
      const value = this.extractValue(rawValue, kind);
      const docComment = this.extractDocComment(source, line);

      constants.push({
        id: this.generateId(filePath, name, line),
        name,
        qualifiedName: name,
        file: filePath,
        line,
        column,
        endLine: line,
        language: this.language,
        kind,
        category: 'uncategorized',
        value,
        rawValue: this.truncateValue(rawValue),
        isExported,
        decorators: [],
        modifiers: ['const'],
        confidence: 0.75,
        ...(type ? { type } : {}),
        ...(docComment ? { docComment } : {}),
      });
    }

    // Pattern 4: Class static readonly properties
    const staticReadonlyPattern =
      /static\s+(?:readonly\s+)?([A-Z][A-Z0-9_]*)\s*(?::\s*([^=]+?))?\s*=\s*(.+?)(?:;|$)/gm;

    while ((match = staticReadonlyPattern.exec(source)) !== null) {
      const name = match[1];
      if (!name) {continue;}
      const type = match[2]?.trim();
      const rawValue = match[3]?.trim();
      if (!rawValue) {continue;}
      const line = this.getLineNumber(source, match.index);
      const column = this.getColumnNumber(source, match.index);

      const className = this.findContainingClass(source, match.index);
      if (!className) {
        continue;
      }

      const kind = this.inferKind(rawValue);
      const value = this.extractValue(rawValue, kind);
      const docComment = this.extractDocComment(source, line);

      constants.push({
        id: this.generateId(filePath, `${className}.${name}`, line),
        name,
        qualifiedName: `${className}.${name}`,
        file: filePath,
        line,
        column,
        endLine: line,
        language: this.language,
        kind: kind === 'primitive' ? 'class_constant' : kind,
        category: 'uncategorized',
        value,
        rawValue: this.truncateValue(rawValue),
        isExported: true,
        parentName: className,
        parentType: 'class',
        decorators: [],
        modifiers: ['static', 'readonly'],
        confidence: 0.7,
        ...(type ? { type } : {}),
        ...(docComment ? { docComment } : {}),
      });
    }

    return constants;
  }

  /**
   * Extract enums from TypeScript source
   */
  protected extractEnums(source: string, filePath: string): EnumExtraction[] {
    const enums: EnumExtraction[] = [];
    const enumPattern = /^[ \t]*(export\s+)?(const\s+)?enum\s+(\w+)\s*\{([\s\S]*?)\}/gm;

    let match: RegExpExecArray | null;
    while ((match = enumPattern.exec(source)) !== null) {
      const isExported = !!match[1];
      const isConst = !!match[2];
      const name = match[3];
      if (!name) {continue;}
      const body = match[4];
      if (!body) {continue;}
      const line = this.getLineNumber(source, match.index);
      const endLine = this.getLineNumber(source, match.index + match[0].length);
      const docComment = this.extractDocComment(source, line);

      const members = this.parseEnumMembers(body, line);
      const isStringEnum = members.some(
        (m) => typeof m.value === 'string' && m.value.startsWith('"')
      );

      enums.push({
        id: this.generateId(filePath, name, line),
        name,
        qualifiedName: name,
        file: filePath,
        line,
        endLine,
        language: this.language,
        isExported,
        members,
        isFlags: false,
        isStringEnum,
        backingType: isStringEnum ? 'string' : 'number',
        decorators: [],
        modifiers: isConst ? ['const'] : [],
        confidence: 0.8,
        ...(docComment ? { docComment } : {}),
      });
    }

    return enums;
  }

  /**
   * Parse enum members from body
   */
  private parseEnumMembers(body: string, startLine: number): EnumMember[] {
    const members: EnumMember[] = [];
    const lines = body.split('\n');
    let currentLine = startLine;
    let autoValue = 0;

    for (const line of lines) {
      currentLine++;
      const trimmed = line.trim();

      if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('/*')) {
        continue;
      }

      const memberMatch = trimmed.match(/^(\w+)\s*(?:=\s*(.+?))?[,}]?\s*(?:\/\/.*)?$/);
      if (memberMatch) {
        const name = memberMatch[1];
        if (!name) {continue;}
        const rawValue = memberMatch[2]?.trim();

        let value: string | number | undefined;
        let isAutoValue = false;

        if (rawValue) {
          if (rawValue.startsWith('"') || rawValue.startsWith("'")) {
            value = rawValue;
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
          name,
          value,
          line: currentLine,
          isAutoValue,
        });
      }
    }

    return members;
  }

  /**
   * Extract value based on kind
   */
  private extractValue(
    rawValue: string,
    kind: ConstantKind
  ): string | number | boolean | null {
    if (kind === 'object' || kind === 'array' || kind === 'computed') {
      return null;
    }

    if (rawValue.startsWith('"') || rawValue.startsWith("'") || rawValue.startsWith('`')) {
      return this.extractStringValue(rawValue);
    }

    const num = this.extractNumericValue(rawValue);
    if (num !== null) {
      return num;
    }

    if (rawValue === 'true') {return true;}
    if (rawValue === 'false') {return false;}
    if (rawValue === 'null') {return null;}
    if (rawValue === 'undefined') {return null;}

    return null;
  }

  /**
   * Find the containing class name for a position
   */
  private findContainingClass(source: string, position: number): string | null {
    const beforePosition = source.slice(0, position);
    const classMatch = beforePosition.match(/class\s+(\w+)(?:\s+extends\s+\w+)?(?:\s+implements\s+[\w,\s]+)?\s*\{[^}]*$/);

    if (classMatch?.[1]) {
      return classMatch[1];
    }

    return null;
  }
}
