/**
 * Python Constant Regex Extractor
 *
 * Regex-based extraction for Python constants and enums.
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
 * Python constant regex extractor
 */
export class PythonConstantRegexExtractor extends BaseConstantRegexExtractor {
  readonly language = 'python' as const;

  /**
   * Extract constants from Python source
   */
  protected extractConstants(source: string, filePath: string): ConstantExtraction[] {
    const constants: ConstantExtraction[] = [];
    let match: RegExpExecArray | null;

    // Pattern 1: Module-level UPPER_CASE assignments
    // MAX_RETRIES = 3
    // API_URL = "https://api.example.com"
    const moduleConstPattern = /^([A-Z][A-Z0-9_]*)\s*(?::\s*([^=]+?))?\s*=\s*(.+?)$/gm;

    while ((match = moduleConstPattern.exec(source)) !== null) {
      const name = match[1];
      if (!name) {continue;}
      const typeHint = match[2]?.trim();
      const rawValue = match[3]?.trim();
      if (!rawValue) {continue;}

      const line = this.getLineNumber(source, match.index);
      const column = this.getColumnNumber(source, match.index);

      // Skip if inside a class or function (check indentation)
      const lineStart = source.lastIndexOf('\n', match.index) + 1;
      const indent = match.index - lineStart;
      if (indent > 0) {
        continue;
      }

      // Skip if it's a type alias or complex expression
      if (rawValue.includes('TypeVar') || rawValue.includes('Generic')) {
        continue;
      }

      const kind = this.inferKind(rawValue);
      const value = this.extractPythonValue(rawValue, kind);
      const docComment = this.extractDocComment(source, line);

      // Check for Final type hint
      const isFinal = typeHint?.includes('Final') ?? false;

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
        isExported: true, // Python module-level is always "exported"
        decorators: [],
        modifiers: isFinal ? ['final'] : [],
        confidence: 0.75,
        ...(typeHint ? { type: typeHint } : {}),
        ...(docComment ? { docComment } : {}),
      });
    }

    // Pattern 2: Class-level constants (inside class body)
    const classConstPattern = /^(\s{4}|\t)([A-Z][A-Z0-9_]*)\s*(?::\s*([^=]+?))?\s*=\s*(.+?)$/gm;

    while ((match = classConstPattern.exec(source)) !== null) {
      const name = match[2];
      if (!name) {continue;}
      const typeHint = match[3]?.trim();
      const rawValue = match[4]?.trim();
      if (!rawValue) {continue;}

      const line = this.getLineNumber(source, match.index);
      const column = this.getColumnNumber(source, match.index);

      // Find containing class
      const className = this.findContainingClass(source, match.index);
      if (!className) {
        continue;
      }

      const kind = this.inferKind(rawValue);
      const value = this.extractPythonValue(rawValue, kind);
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
        modifiers: [],
        confidence: 0.7,
        ...(typeHint ? { type: typeHint } : {}),
        ...(docComment ? { docComment } : {}),
      });
    }

    return constants;
  }


  /**
   * Extract enums from Python source
   */
  protected extractEnums(source: string, filePath: string): EnumExtraction[] {
    const enums: EnumExtraction[] = [];
    
    // Pattern: class EnumName(Enum): or class EnumName(IntEnum): etc.
    const enumPattern = /^class\s+(\w+)\s*\(\s*(Enum|IntEnum|StrEnum|Flag|IntFlag)\s*\)\s*:/gm;

    let match: RegExpExecArray | null;
    while ((match = enumPattern.exec(source)) !== null) {
      const name = match[1];
      if (!name) {continue;}
      const baseType = match[2];
      const line = this.getLineNumber(source, match.index);
      const docComment = this.extractDocComment(source, line);

      // Find the enum body
      const bodyStart = match.index + match[0].length;
      const members = this.parsePythonEnumMembers(source, bodyStart, line);
      const lastMember = members[members.length - 1];
      const endLine = lastMember ? lastMember.line : line;

      const isStringEnum = baseType === 'StrEnum' || 
        members.some(m => typeof m.value === 'string' && m.value.startsWith('"'));
      const isFlags = baseType === 'Flag' || baseType === 'IntFlag';

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
        isFlags,
        isStringEnum,
        backingType: isStringEnum ? 'str' : 'int',
        decorators: [],
        modifiers: [],
        confidence: 0.8,
        ...(docComment ? { docComment } : {}),
      });
    }

    return enums;
  }

  /**
   * Parse Python enum members
   */
  private parsePythonEnumMembers(source: string, startIndex: number, startLine: number): EnumMember[] {
    const members: EnumMember[] = [];
    const lines = source.slice(startIndex).split('\n');
    let currentLine = startLine;
    let autoValue = 0;

    for (const line of lines) {
      currentLine++;
      const trimmed = line.trim();

      // Stop at next class or function definition or unindented line
      if (trimmed.startsWith('class ') || trimmed.startsWith('def ') || 
          (trimmed.length > 0 && !line.startsWith(' ') && !line.startsWith('\t'))) {
        break;
      }

      // Skip empty lines, comments, docstrings
      if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('"""') || trimmed.startsWith("'''")) {
        continue;
      }

      // Match enum member: NAME = value or NAME = auto()
      const memberMatch = trimmed.match(/^([A-Z][A-Z0-9_]*)\s*=\s*(.+?)(?:\s*#.*)?$/);
      if (memberMatch) {
        const memberName = memberMatch[1];
        if (!memberName) {continue;}
        const rawValue = memberMatch[2]?.trim();

        let value: string | number | undefined;
        let isAutoValue = false;

        if (rawValue === 'auto()') {
          value = autoValue;
          autoValue++;
          isAutoValue = true;
        } else if (rawValue?.startsWith('"') || rawValue?.startsWith("'")) {
          value = rawValue;
        } else if (rawValue && /^-?\d+$/.test(rawValue)) {
          value = parseInt(rawValue, 10);
          autoValue = value + 1;
        } else {
          value = rawValue;
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
   * Extract value from Python literal
   */
  private extractPythonValue(
    rawValue: string,
    kind: ConstantKind
  ): string | number | boolean | null {
    if (kind === 'object' || kind === 'array' || kind === 'computed') {
      return null;
    }

    // String literals
    if (rawValue.startsWith('"""') || rawValue.startsWith("'''")) {
      return rawValue.slice(3, -3);
    }
    if (rawValue.startsWith('"') || rawValue.startsWith("'")) {
      return this.extractStringValue(rawValue);
    }
    if (rawValue.startsWith('f"') || rawValue.startsWith("f'")) {
      return rawValue.slice(2, -1); // f-string
    }

    // Numbers
    const num = this.extractNumericValue(rawValue);
    if (num !== null) {
      return num;
    }

    // Booleans
    if (rawValue === 'True') {return true;}
    if (rawValue === 'False') {return false;}
    if (rawValue === 'None') {return null;}

    return null;
  }

  /**
   * Override kind inference for Python
   */
  protected override inferKind(value: string): ConstantKind {
    const trimmed = value.trim();
    
    // Dict literal
    if (trimmed.startsWith('{') && !trimmed.startsWith('{%')) {
      return 'object';
    }
    // List or tuple
    if (trimmed.startsWith('[') || trimmed.startsWith('(')) {
      return 'array';
    }
    // String
    if (trimmed.startsWith('"') || trimmed.startsWith("'") || 
        trimmed.startsWith('"""') || trimmed.startsWith("'''") ||
        trimmed.startsWith('f"') || trimmed.startsWith("f'")) {
      return 'primitive';
    }
    // Number
    if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
      return 'primitive';
    }
    // Boolean/None
    if (trimmed === 'True' || trimmed === 'False' || trimmed === 'None') {
      return 'primitive';
    }
    // Function call or complex expression
    return 'computed';
  }

  /**
   * Find the containing class name for a position
   */
  private findContainingClass(source: string, position: number): string | null {
    const beforePosition = source.slice(0, position);
    const classMatches = [...beforePosition.matchAll(/^class\s+(\w+)/gm)];
    
    if (classMatches.length === 0) {
      return null;
    }

    // Get the last class definition before this position
    const lastMatch = classMatches[classMatches.length - 1];
    return lastMatch?.[1] ?? null;
  }
}
