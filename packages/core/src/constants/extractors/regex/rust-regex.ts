/**
 * Rust Constant Regex Extractor
 *
 * Regex-based extraction for Rust constants.
 * Used as fallback when tree-sitter is unavailable.
 */

import { BaseConstantRegexExtractor } from './base-regex.js';

import type {
  ConstantExtraction,
  EnumExtraction,
  EnumMember,
  ConstantKind,
  ConstantLanguage,
} from '../../types.js';

/**
 * Rust constant regex extractor
 */
export class RustConstantRegexExtractor extends BaseConstantRegexExtractor {
  // Use 'go' as a proxy since 'rust' isn't in ConstantLanguage yet
  readonly language: ConstantLanguage = 'go';

  /**
   * Extract constants from Rust source
   */
  protected extractConstants(source: string, filePath: string): ConstantExtraction[] {
    const constants: ConstantExtraction[] = [];
    let match: RegExpExecArray | null;

    // Pattern 1: const NAME: Type = value;
    const constPattern =
      /^[ \t]*(pub(?:\s*\([^)]*\))?\s+)?const\s+([A-Z][A-Z0-9_]*)\s*:\s*([^=]+?)\s*=\s*(.+?);/gm;

    while ((match = constPattern.exec(source)) !== null) {
      const isExported = !!match[1];
      const name = match[2];
      if (!name) {continue;}
      const type = match[3]?.trim();
      const rawValue = match[4]?.trim();
      if (!rawValue) {continue;}
      const line = this.getLineNumber(source, match.index);
      const column = this.getColumnNumber(source, match.index);
      const docComment = this.extractDocComment(source, line);

      const kind = this.inferKind(rawValue);
      const value = this.extractValue(rawValue, kind);

      constants.push({
        id: this.generateId(filePath, name, line),
        name,
        qualifiedName: name,
        file: filePath,
        line,
        column,
        endLine: line,
        language: this.language as any,
        kind,
        category: 'uncategorized',
        value,
        rawValue: this.truncateValue(rawValue),
        isExported,
        decorators: [],
        modifiers: ['const'],
        confidence: 0.8,
        ...(type ? { type } : {}),
        ...(docComment ? { docComment } : {}),
      });
    }

    // Pattern 2: static NAME: Type = value;
    const staticPattern =
      /^[ \t]*(pub(?:\s*\([^)]*\))?\s+)?static\s+(mut\s+)?([A-Z][A-Z0-9_]*)\s*:\s*([^=]+?)\s*=\s*(.+?);/gm;

    while ((match = staticPattern.exec(source)) !== null) {
      const isExported = !!match[1];
      const isMut = !!match[2];
      const name = match[3];
      if (!name) {continue;}
      const type = match[4]?.trim();
      const rawValue = match[5]?.trim();
      if (!rawValue) {continue;}
      const line = this.getLineNumber(source, match.index);
      const column = this.getColumnNumber(source, match.index);

      // Skip if already captured
      if (constants.some((c) => c.name === name && c.line === line)) {
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
        language: this.language as any,
        kind,
        category: 'uncategorized',
        value,
        rawValue: this.truncateValue(rawValue),
        isExported,
        decorators: [],
        modifiers: isMut ? ['static', 'mut'] : ['static'],
        confidence: 0.75,
        ...(type ? { type } : {}),
        ...(docComment ? { docComment } : {}),
      });
    }

    // Pattern 3: lazy_static! { static ref NAME: Type = value; }
    const lazyStaticPattern =
      /lazy_static!\s*\{[\s\S]*?static\s+ref\s+([A-Z][A-Z0-9_]*)\s*:\s*([^=]+?)\s*=\s*([\s\S]+?);[\s\S]*?\}/g;

    while ((match = lazyStaticPattern.exec(source)) !== null) {
      const name = match[1];
      if (!name) {continue;}
      const type = match[2]?.trim();
      const rawValue = match[3]?.trim();
      if (!rawValue) {continue;}
      const line = this.getLineNumber(source, match.index);
      const column = this.getColumnNumber(source, match.index);

      // Skip if already captured
      if (constants.some((c) => c.name === name && c.line === line)) {
        continue;
      }

      const kind = this.inferKind(rawValue);
      const docComment = this.extractDocComment(source, line);

      constants.push({
        id: this.generateId(filePath, name, line),
        name,
        qualifiedName: name,
        file: filePath,
        line,
        column,
        endLine: line,
        language: this.language as any,
        kind,
        category: 'uncategorized',
        rawValue: this.truncateValue(rawValue),
        isExported: true, // lazy_static is typically pub
        decorators: ['lazy_static'],
        modifiers: ['static', 'ref'],
        confidence: 0.7,
        ...(type ? { type } : {}),
        ...(docComment ? { docComment } : {}),
      });
    }

    // Pattern 4: once_cell::sync::Lazy<Type>
    const onceCellPattern =
      /^[ \t]*(pub(?:\s*\([^)]*\))?\s+)?static\s+([A-Z][A-Z0-9_]*)\s*:\s*(?:once_cell::sync::)?Lazy<([^>]+)>\s*=\s*Lazy::new\s*\(\s*\|\s*\|\s*([\s\S]+?)\s*\);/gm;

    while ((match = onceCellPattern.exec(source)) !== null) {
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

      const kind = this.inferKind(rawValue);
      const docComment = this.extractDocComment(source, line);

      constants.push({
        id: this.generateId(filePath, name, line),
        name,
        qualifiedName: name,
        file: filePath,
        line,
        column,
        endLine: line,
        language: this.language as any,
        kind,
        category: 'uncategorized',
        rawValue: this.truncateValue(rawValue),
        isExported,
        decorators: ['once_cell'],
        modifiers: ['static', 'lazy'],
        confidence: 0.7,
        ...(type ? { type } : {}),
        ...(docComment ? { docComment } : {}),
      });
    }

    return constants;
  }

  /**
   * Extract enums from Rust source
   */
  protected extractEnums(source: string, filePath: string): EnumExtraction[] {
    const enums: EnumExtraction[] = [];
    
    // Pattern: enum Name { ... } or pub enum Name { ... }
    const enumPattern = /^[ \t]*(#\[[^\]]+\]\s*)*(pub(?:\s*\([^)]*\))?\s+)?enum\s+(\w+)(?:<[^>]+>)?\s*\{([\s\S]*?)\n\}/gm;

    let match: RegExpExecArray | null;
    while ((match = enumPattern.exec(source)) !== null) {
      const attributes = match[1]?.trim() ?? '';
      const isExported = !!match[2];
      const name = match[3];
      if (!name) {continue;}
      const body = match[4];
      if (!body) {continue;}
      const line = this.getLineNumber(source, match.index);
      const endLine = this.getLineNumber(source, match.index + match[0].length);
      const docComment = this.extractDocComment(source, line);

      const members = this.parseEnumMembers(body, line);
      const isStringEnum = this.hasStringRepr(attributes);
      const isFlags = false; // Rust doesn't have flags enums like C#

      // Detect derive macros
      const decorators: string[] = [];
      const deriveMatch = attributes.match(/#\[derive\(([^)]+)\)\]/);
      if (deriveMatch) {
        decorators.push(...deriveMatch[1]!.split(',').map(d => d.trim()));
      }

      enums.push({
        id: this.generateId(filePath, name, line),
        name,
        qualifiedName: name,
        file: filePath,
        line,
        endLine,
        language: this.language as any,
        isExported,
        members,
        isFlags,
        isStringEnum,
        decorators,
        modifiers: [],
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

    for (const line of lines) {
      currentLine++;
      const trimmed = line.trim();

      if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('/*')) {
        continue;
      }

      // Simple variant: Name,
      const simpleMatch = trimmed.match(/^(\w+)\s*,?\s*(?:\/\/.*)?$/);
      if (simpleMatch?.[1]) {
        members.push({
          name: simpleMatch[1],
          line: currentLine,
          isAutoValue: true,
        });
        continue;
      }

      // Variant with value: Name = value,
      const valueMatch = trimmed.match(/^(\w+)\s*=\s*(.+?)\s*,?\s*(?:\/\/.*)?$/);
      if (valueMatch?.[1]) {
        const name = valueMatch[1];
        const rawValue = valueMatch[2]?.trim();

        let value: string | number | undefined;
        if (rawValue) {
          if (/^-?\d+$/.test(rawValue)) {
            value = parseInt(rawValue, 10);
          } else if (rawValue.startsWith('"') || rawValue.startsWith("'")) {
            value = rawValue;
          } else {
            value = rawValue;
          }
        }

        const member: EnumMember = {
          name,
          line: currentLine,
          isAutoValue: false,
        };
        if (value !== undefined) {
          member.value = value;
        }
        members.push(member);
        continue;
      }

      // Tuple variant: Name(Type),
      const tupleMatch = trimmed.match(/^(\w+)\s*\([^)]*\)\s*,?\s*(?:\/\/.*)?$/);
      if (tupleMatch?.[1]) {
        members.push({
          name: tupleMatch[1],
          line: currentLine,
          isAutoValue: true,
        });
        continue;
      }

      // Struct variant: Name { ... },
      const structMatch = trimmed.match(/^(\w+)\s*\{/);
      if (structMatch?.[1]) {
        members.push({
          name: structMatch[1],
          line: currentLine,
          isAutoValue: true,
        });
        continue;
      }
    }

    return members;
  }

  /**
   * Check if enum has string representation
   */
  private hasStringRepr(attributes: string): boolean {
    return attributes.includes('repr(') && 
           (attributes.includes('strum') || attributes.includes('Display'));
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

    // String literal
    if (rawValue.startsWith('"')) {
      return this.extractStringValue(rawValue);
    }

    // Raw string literal r#"..."#
    const rawStringMatch = rawValue.match(/^r#*"([\s\S]*?)"#*$/);
    if (rawStringMatch) {
      return rawStringMatch[1] ?? null;
    }

    // Numeric
    const num = this.extractNumericValue(rawValue);
    if (num !== null) {
      return num;
    }

    // Boolean
    if (rawValue === 'true') {return true;}
    if (rawValue === 'false') {return false;}

    return null;
  }

  /**
   * Override inferKind for Rust-specific patterns
   */
  protected override inferKind(value: string): ConstantKind {
    // Check for struct/object literal
    if (value.includes('{') && value.includes('}')) {
      return 'object';
    }
    // Check for array/vec literal
    if (value.startsWith('[') || value.startsWith('vec!') || value.startsWith('Vec::')) {
      return 'array';
    }
    // Check for string
    if (value.startsWith('"') || value.startsWith('r#"') || value.startsWith("'")) {
      return 'primitive';
    }
    // Check for number
    if (/^-?\d+(?:\.\d+)?(?:_\d+)*(?:i\d+|u\d+|f\d+)?$/.test(value.trim())) {
      return 'primitive';
    }
    // Check for boolean
    if (value === 'true' || value === 'false') {
      return 'primitive';
    }
    // Otherwise it's computed
    return 'computed';
  }
}

/**
 * Create a Rust constant regex extractor
 */
export function createRustConstantRegexExtractor(): RustConstantRegexExtractor {
  return new RustConstantRegexExtractor();
}
