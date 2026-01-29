/**
 * Go Constant Regex Extractor
 *
 * Regex-based extraction for Go constants.
 * Used as fallback when tree-sitter is unavailable.
 */

import { BaseConstantRegexExtractor } from './base-regex.js';

import type {
  ConstantExtraction,
  EnumExtraction,
  ConstantKind,
} from '../../types.js';

/**
 * Go constant regex extractor
 */
export class GoConstantRegexExtractor extends BaseConstantRegexExtractor {
  readonly language = 'go' as const;

  /**
   * Extract constants from Go source
   */
  protected extractConstants(source: string, filePath: string): ConstantExtraction[] {
    const constants: ConstantExtraction[] = [];
    let match: RegExpExecArray | null;

    // Pattern 1: Single const declaration
    // const MaxRetries = 3
    // const ApiUrl string = "https://api.example.com"
    const singleConstPattern = /^const\s+(\w+)\s*(?:(\w+)\s*)?=\s*(.+?)$/gm;

    while ((match = singleConstPattern.exec(source)) !== null) {
      const name = match[1];
      if (!name) {continue;}
      const type = match[2];
      const rawValue = match[3]?.trim();
      if (!rawValue) {continue;}

      // Skip if inside a const block (will be handled separately)
      const beforeMatch = source.slice(0, match.index);
      if (this.isInsideConstBlock(beforeMatch)) {
        continue;
      }

      const line = this.getLineNumber(source, match.index);
      const column = this.getColumnNumber(source, match.index);
      const docComment = this.extractDocComment(source, line);
      const isExported = /^[A-Z]/.test(name);

      const kind = this.inferGoKind(rawValue);
      const value = this.extractGoValue(rawValue, kind);

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

    // Pattern 2: Const block
    // const (
    //   StatusPending = iota
    //   StatusActive
    //   StatusCompleted
    // )
    const constBlockPattern = /const\s*\(\s*([\s\S]*?)\s*\)/g;

    while ((match = constBlockPattern.exec(source)) !== null) {
      const blockContent = match[1];
      if (!blockContent) {continue;}
      const blockStartLine = this.getLineNumber(source, match.index);
      
      this.parseConstBlock(blockContent, blockStartLine, filePath, constants);
    }

    // Pattern 3: Package-level var (exported, effectively constant)
    // var DefaultConfig = Config{Timeout: 30}
    const varPattern = /^var\s+([A-Z]\w*)\s*(?:(\w+)\s*)?=\s*(.+?)$/gm;

    while ((match = varPattern.exec(source)) !== null) {
      const name = match[1];
      if (!name) {continue;}
      const type = match[2];
      const rawValue = match[3]?.trim();
      if (!rawValue) {continue;}

      const line = this.getLineNumber(source, match.index);
      const column = this.getColumnNumber(source, match.index);
      const docComment = this.extractDocComment(source, line);

      const kind = this.inferGoKind(rawValue);
      const value = this.extractGoValue(rawValue, kind);

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
        isExported: true,
        decorators: [],
        modifiers: ['var'],
        confidence: 0.6, // Lower confidence for var
        ...(type ? { type } : {}),
        ...(docComment ? { docComment } : {}),
      });
    }

    return constants;
  }


  /**
   * Parse a const block
   */
  private parseConstBlock(
    content: string,
    startLine: number,
    filePath: string,
    constants: ConstantExtraction[]
  ): void {
    const lines = content.split('\n');
    let currentLine = startLine;
    let iotaValue = 0;
    let lastType: string | undefined;

    for (const line of lines) {
      currentLine++;
      const trimmed = line.trim();

      // Skip empty lines and comments
      if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('/*')) {
        continue;
      }

      // Match: Name Type = value, Name = value, or just Name (iota continuation)
      const constMatch = trimmed.match(/^(\w+)\s*(?:(\w+)\s*)?(?:=\s*(.+?))?(?:\s*\/\/.*)?$/);
      if (!constMatch) {continue;}

      const name = constMatch[1];
      if (!name) {continue;}
      const type = constMatch[2] ?? lastType;
      const rawValue = constMatch[3]?.trim();

      if (type) {
        lastType = type;
      }

      const isExported = /^[A-Z]/.test(name);
      let value: string | number | boolean | null = null;
      let kind: ConstantKind = 'primitive';

      if (rawValue) {
        if (rawValue === 'iota') {
          value = iotaValue;
          iotaValue++;
        } else if (rawValue.includes('iota')) {
          // Expression with iota like 1 << iota
          value = iotaValue;
          iotaValue++;
          kind = 'computed';
        } else {
          kind = this.inferGoKind(rawValue);
          value = this.extractGoValue(rawValue, kind);
          // Reset iota if explicit value
          if (typeof value === 'number') {
            iotaValue = value + 1;
          }
        }
      } else {
        // Implicit iota continuation
        value = iotaValue;
        iotaValue++;
      }

      constants.push({
        id: this.generateId(filePath, name, currentLine),
        name,
        qualifiedName: name,
        file: filePath,
        line: currentLine,
        column: 1,
        endLine: currentLine,
        language: this.language,
        kind,
        category: 'uncategorized',
        value,
        rawValue: rawValue ?? String(value),
        isExported,
        decorators: [],
        modifiers: ['const'],
        confidence: 0.75,
        ...(type ? { type } : {}),
      });
    }
  }

  /**
   * Go doesn't have traditional enums, but we can detect iota-based const blocks
   * as pseudo-enums
   */
  protected extractEnums(_source: string, _filePath: string): EnumExtraction[] {
    // Go doesn't have enums - iota-based constants are handled in extractConstants
    return [];
  }


  /**
   * Check if position is inside a const block
   */
  private isInsideConstBlock(beforeText: string): boolean {
    const lastConstParen = beforeText.lastIndexOf('const (');
    const lastCloseParen = beforeText.lastIndexOf(')');
    
    return lastConstParen > lastCloseParen;
  }

  /**
   * Infer kind from Go value
   */
  private inferGoKind(value: string): ConstantKind {
    const trimmed = value.trim();
    
    // Struct literal
    if (trimmed.includes('{') && trimmed.includes('}')) {
      return 'object';
    }
    // Slice/array literal
    if (trimmed.startsWith('[]') || trimmed.match(/^\[\d*\]/)) {
      return 'array';
    }
    // Map literal
    if (trimmed.startsWith('map[')) {
      return 'object';
    }
    // String
    if (trimmed.startsWith('"') || trimmed.startsWith('`')) {
      return 'primitive';
    }
    // Rune (character)
    if (trimmed.startsWith("'")) {
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
    // nil
    if (trimmed === 'nil') {
      return 'primitive';
    }
    // iota
    if (trimmed === 'iota' || trimmed.includes('iota')) {
      return 'primitive';
    }
    
    return 'computed';
  }

  /**
   * Extract value from Go literal
   */
  private extractGoValue(
    rawValue: string,
    kind: ConstantKind
  ): string | number | boolean | null {
    if (kind === 'object' || kind === 'array' || kind === 'computed') {
      return null;
    }

    const trimmed = rawValue.trim();

    // Double-quoted string
    if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
      return trimmed.slice(1, -1);
    }

    // Raw string (backtick)
    if (trimmed.startsWith('`') && trimmed.endsWith('`')) {
      return trimmed.slice(1, -1);
    }

    // Rune (character)
    if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
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

    // Hex
    if (/^0x[0-9a-fA-F]+$/.test(trimmed)) {
      return parseInt(trimmed, 16);
    }

    // Boolean
    if (trimmed === 'true') {return true;}
    if (trimmed === 'false') {return false;}
    if (trimmed === 'nil') {return null;}

    // iota
    if (trimmed === 'iota') {
      return 0; // Will be adjusted by caller
    }

    return null;
  }
}
