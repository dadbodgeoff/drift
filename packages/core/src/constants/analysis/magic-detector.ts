/**
 * Magic Value Detector
 *
 * Detects hardcoded "magic" values (numbers and strings) that should
 * be extracted into named constants.
 */

import { inferCategory } from './categorizer.js';

import type {
  MagicValue,
  MagicValueOccurrence,
  ConstantCategory,
  IssueSeverity,
  ConstantLanguage,
} from '../types.js';

/**
 * Configuration for magic value detection
 */
export interface MagicDetectorConfig {
  /** Minimum occurrences to flag as magic */
  minOccurrences: number;
  /** Values to ignore (common acceptable values) */
  ignoreValues: (string | number)[];
  /** File patterns to ignore */
  ignorePatterns: string[];
  /** Include string literals */
  includeStrings: boolean;
  /** Include numeric literals */
  includeNumbers: boolean;
  /** Minimum string length to consider */
  minStringLength: number;
  /** Maximum string length to consider */
  maxStringLength: number;
}

/**
 * Default magic detector config
 */
export const DEFAULT_MAGIC_DETECTOR_CONFIG: MagicDetectorConfig = {
  minOccurrences: 2,
  ignoreValues: [
    // Common acceptable numbers
    0, 1, -1, 2, 10, 100, 1000,
    // Common acceptable strings
    '', ' ', '\n', '\t', '\r\n',
    'true', 'false', 'null', 'undefined', 'none', 'nil',
    // Common format strings
    '%s', '%d', '%f', '{}',
  ],
  ignorePatterns: [
    'test', 'spec', 'mock', '__tests__', '__mocks__',
    'node_modules', 'dist', 'build',
  ],
  includeStrings: true,
  includeNumbers: true,
  minStringLength: 3,
  maxStringLength: 200,
};

/**
 * Result of magic value detection
 */
export interface MagicDetectionResult {
  /** All magic values found */
  magicValues: MagicValue[];
  /** Total occurrences across all magic values */
  totalOccurrences: number;
  /** Files with magic values */
  filesAffected: number;
  /** Detection time in ms */
  detectionTimeMs: number;
}

/**
 * Magic value detector
 */
export class MagicValueDetector {
  private config: MagicDetectorConfig;
  private ignoreSet: Set<string>;

  constructor(config: Partial<MagicDetectorConfig> = {}) {
    this.config = { ...DEFAULT_MAGIC_DETECTOR_CONFIG, ...config };
    this.ignoreSet = new Set(this.config.ignoreValues.map(v => String(v)));
  }

  /**
   * Detect magic values in the given files
   */
  detect(files: Map<string, string>): MagicDetectionResult {
    const startTime = performance.now();
    const valueMap = new Map<string, MagicValueOccurrence[]>();

    for (const [filePath, content] of files) {
      // Skip excluded files
      if (this.shouldExcludeFile(filePath)) {
        continue;
      }

      const language = this.inferLanguage(filePath);
      this.extractLiterals(filePath, content, language, valueMap);
    }

    // Filter to magic values (multiple occurrences)
    const magicValues = this.buildMagicValues(valueMap);

    // Count affected files
    const affectedFiles = new Set<string>();
    for (const mv of magicValues) {
      for (const occ of mv.occurrences) {
        affectedFiles.add(occ.file);
      }
    }

    return {
      magicValues,
      totalOccurrences: magicValues.reduce((sum, mv) => sum + mv.occurrences.length, 0),
      filesAffected: affectedFiles.size,
      detectionTimeMs: performance.now() - startTime,
    };
  }

  /**
   * Extract literals from a file
   */
  private extractLiterals(
    filePath: string,
    content: string,
    language: ConstantLanguage,
    valueMap: Map<string, MagicValueOccurrence[]>
  ): void {
    const lines = content.split('\n');

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      const line = lines[lineIndex];
      if (!line) {continue;}
      const lineNumber = lineIndex + 1;

      // Skip comment lines
      if (this.isCommentLine(line, language)) {
        continue;
      }

      // Skip constant definitions (we want usages, not definitions)
      if (this.isConstantDefinition(line, language)) {
        continue;
      }

      // Extract string literals
      if (this.config.includeStrings) {
        this.extractStringLiterals(filePath, line, lineNumber, lines, lineIndex, valueMap);
      }

      // Extract numeric literals
      if (this.config.includeNumbers) {
        this.extractNumericLiterals(filePath, line, lineNumber, lines, lineIndex, valueMap);
      }
    }
  }

  /**
   * Extract string literals from a line
   */
  private extractStringLiterals(
    filePath: string,
    line: string,
    lineNumber: number,
    lines: string[],
    lineIndex: number,
    valueMap: Map<string, MagicValueOccurrence[]>
  ): void {
    // Match double-quoted strings
    const doubleQuotePattern = /"([^"\\]|\\.)*"/g;
    let match: RegExpExecArray | null;

    while ((match = doubleQuotePattern.exec(line)) !== null) {
      const value = match[0].slice(1, -1); // Remove quotes
      this.addOccurrence(filePath, value, 'string', lineNumber, match.index, lines, lineIndex, valueMap);
    }

    // Match single-quoted strings
    const singleQuotePattern = /'([^'\\]|\\.)*'/g;
    while ((match = singleQuotePattern.exec(line)) !== null) {
      const value = match[0].slice(1, -1);
      this.addOccurrence(filePath, value, 'string', lineNumber, match.index, lines, lineIndex, valueMap);
    }

    // Match template literals (backticks) - only simple ones
    const templatePattern = /`([^`\\]|\\.)*`/g;
    while ((match = templatePattern.exec(line)) !== null) {
      const value = match[0].slice(1, -1);
      // Skip if contains interpolation
      if (!value.includes('${')) {
        this.addOccurrence(filePath, value, 'string', lineNumber, match.index, lines, lineIndex, valueMap);
      }
    }
  }

  /**
   * Extract numeric literals from a line
   */
  private extractNumericLiterals(
    filePath: string,
    line: string,
    lineNumber: number,
    lines: string[],
    lineIndex: number,
    valueMap: Map<string, MagicValueOccurrence[]>
  ): void {
    // Match numbers (integers and floats)
    // Avoid matching numbers in identifiers or version strings
    const numberPattern = /(?<![.\w])(-?\d+\.?\d*(?:[eE][+-]?\d+)?)\b(?![.\d])/g;
    let match: RegExpExecArray | null;

    while ((match = numberPattern.exec(line)) !== null) {
      const value = match[1];
      if (!value) {continue;}

      // Skip if it looks like part of a version string
      const beforeMatch = line.slice(Math.max(0, match.index - 5), match.index);
      if (beforeMatch.match(/\d\./)) {
        continue;
      }

      this.addOccurrence(filePath, value, 'number', lineNumber, match.index, lines, lineIndex, valueMap);
    }
  }

  /**
   * Add an occurrence to the value map
   */
  private addOccurrence(
    filePath: string,
    value: string,
    type: 'string' | 'number',
    lineNumber: number,
    column: number,
    lines: string[],
    lineIndex: number,
    valueMap: Map<string, MagicValueOccurrence[]>
  ): void {
    // Check if should ignore
    if (this.shouldIgnoreValue(value, type)) {
      return;
    }

    const key = `${type}:${value}`;
    const occurrences = valueMap.get(key) || [];

    const containingFunction = this.findContainingFunction(lines, lineIndex);

    occurrences.push({
      file: filePath,
      line: lineNumber,
      column: column + 1,
      context: this.extractContext(lines, lineIndex),
      ...(containingFunction ? { containingFunction } : {}),
    });

    valueMap.set(key, occurrences);
  }

  /**
   * Check if a value should be ignored
   */
  private shouldIgnoreValue(value: string, type: 'string' | 'number'): boolean {
    // Check ignore set
    if (this.ignoreSet.has(value)) {
      return true;
    }

    if (type === 'string') {
      // Check length constraints
      if (value.length < this.config.minStringLength || value.length > this.config.maxStringLength) {
        return true;
      }

      // Ignore URLs (they're often unique)
      if (value.match(/^https?:\/\//)) {
        return true;
      }

      // Ignore file paths
      if (value.match(/^[./\\]/) && value.includes('/')) {
        return true;
      }

      // Ignore CSS classes and selectors
      if (value.match(/^[.#][\w-]+$/)) {
        return true;
      }

      // Ignore HTML tags
      if (value.match(/^<\/?[\w-]+/)) {
        return true;
      }

      // Ignore regex patterns
      if (value.match(/^\^.*\$$/)) {
        return true;
      }
    }

    if (type === 'number') {
      const num = parseFloat(value);

      // Ignore common acceptable numbers
      if ([0, 1, -1, 2, 10, 100, 1000].includes(num)) {
        return true;
      }

      // Ignore very large numbers (likely IDs or timestamps)
      if (Math.abs(num) > 1000000000) {
        return true;
      }
    }

    return false;
  }

  /**
   * Build magic values from occurrence map
   */
  private buildMagicValues(valueMap: Map<string, MagicValueOccurrence[]>): MagicValue[] {
    const magicValues: MagicValue[] = [];

    for (const [key, occurrences] of valueMap) {
      // Only include if meets minimum occurrences
      if (occurrences.length < this.config.minOccurrences) {
        continue;
      }

      const [type, ...valueParts] = key.split(':');
      const value = valueParts.join(':'); // Rejoin in case value contained ':'

      const parsedValue = type === 'number' ? parseFloat(value) : value;
      const suggestedName = this.suggestConstantName(value, type as 'string' | 'number');
      const suggestedCategory = this.suggestCategory(value, type as 'string' | 'number');
      const severity = this.calculateSeverity(occurrences.length, type as 'string' | 'number', value);

      magicValues.push({
        value: parsedValue,
        type: type as 'string' | 'number',
        occurrences,
        suggestedName,
        suggestedCategory,
        severity,
      });
    }

    // Sort by occurrence count (most frequent first)
    magicValues.sort((a, b) => b.occurrences.length - a.occurrences.length);

    return magicValues;
  }

  /**
   * Suggest a constant name for a magic value
   */
  private suggestConstantName(value: string, type: 'string' | 'number'): string {
    if (type === 'number') {
      const num = parseFloat(value);

      // Common patterns
      if (num === 60) {return 'SECONDS_PER_MINUTE';}
      if (num === 3600) {return 'SECONDS_PER_HOUR';}
      if (num === 86400) {return 'SECONDS_PER_DAY';}
      if (num === 1024) {return 'BYTES_PER_KB';}
      if (num === 1048576) {return 'BYTES_PER_MB';}

      // Generic number name
      if (Number.isInteger(num)) {
        return `VALUE_${Math.abs(num)}`;
      }
      return `VALUE_${value.replace('.', '_').replace('-', 'NEG_')}`;
    }

    // String value - convert to UPPER_SNAKE_CASE
    let name = value
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 30);

    if (!name || /^\d/.test(name)) {
      name = 'STRING_' + name;
    }

    return name || 'UNNAMED_CONSTANT';
  }

  /**
   * Suggest a category for a magic value
   */
  private suggestCategory(value: string, type: 'string' | 'number'): ConstantCategory {
    // Use the categorizer with a mock constant
    const mockConstant = {
      id: '',
      name: this.suggestConstantName(value, type),
      qualifiedName: '',
      file: '',
      line: 0,
      column: 0,
      endLine: 0,
      language: 'typescript' as ConstantLanguage,
      kind: 'primitive' as const,
      category: 'uncategorized' as ConstantCategory,
      value: type === 'number' ? parseFloat(value) : value,
      isExported: false,
      decorators: [],
      modifiers: [],
      confidence: 1,
    };

    return inferCategory(mockConstant);
  }

  /**
   * Calculate severity based on occurrences and value type
   */
  private calculateSeverity(
    occurrenceCount: number,
    type: 'string' | 'number',
    _value: string
  ): IssueSeverity {
    // High severity for potential secrets
    if (type === 'string') {
      // Note: value-based checks removed - use security scanner for secrets
    }

    // Severity based on occurrence count
    if (occurrenceCount >= 10) {return 'high';}
    if (occurrenceCount >= 5) {return 'medium';}
    if (occurrenceCount >= 3) {return 'low';}
    return 'info';
  }

  /**
   * Check if a line is a comment
   */
  private isCommentLine(line: string, _language: ConstantLanguage): boolean {
    const trimmed = line.trim();

    // Single-line comments
    if (trimmed.startsWith('//') || trimmed.startsWith('#') || trimmed.startsWith('*')) {
      return true;
    }

    // Block comment markers
    if (trimmed.startsWith('/*') || trimmed.startsWith('*/')) {
      return true;
    }

    // Python docstrings
    if (trimmed.startsWith('"""') || trimmed.startsWith("'''")) {
      return true;
    }

    return false;
  }

  /**
   * Check if a line is a constant definition
   */
  private isConstantDefinition(line: string, _language: ConstantLanguage): boolean {
    const trimmed = line.trim();

    // TypeScript/JavaScript const
    if (trimmed.match(/^(?:export\s+)?const\s+[A-Z][A-Z0-9_]*\s*=/)) {
      return true;
    }

    // Python UPPER_CASE assignment
    if (trimmed.match(/^[A-Z][A-Z0-9_]*\s*=/)) {
      return true;
    }

    // Java/C# static final/const
    if (trimmed.match(/(?:static\s+final|const)\s+\w+\s+[A-Z][A-Z0-9_]*\s*=/)) {
      return true;
    }

    // PHP class constant
    if (trimmed.match(/(?:public|private|protected)?\s*const\s+[A-Z][A-Z0-9_]*\s*=/)) {
      return true;
    }

    // Go const
    if (trimmed.match(/^const\s+\w+\s*=/)) {
      return true;
    }

    return false;
  }

  /**
   * Check if a file should be excluded
   */
  private shouldExcludeFile(filePath: string): boolean {
    for (const pattern of this.config.ignorePatterns) {
      if (filePath.includes(pattern)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Infer language from file path
   */
  private inferLanguage(filePath: string): ConstantLanguage {
    if (filePath.endsWith('.ts') || filePath.endsWith('.tsx')) {return 'typescript';}
    if (filePath.endsWith('.js') || filePath.endsWith('.jsx')) {return 'javascript';}
    if (filePath.endsWith('.py')) {return 'python';}
    if (filePath.endsWith('.java')) {return 'java';}
    if (filePath.endsWith('.cs')) {return 'csharp';}
    if (filePath.endsWith('.php')) {return 'php';}
    if (filePath.endsWith('.go')) {return 'go';}
    return 'typescript'; // Default
  }

  /**
   * Extract context snippet
   */
  private extractContext(lines: string[], lineIndex: number): string {
    const line = lines[lineIndex];
    if (!line) {return '';}
    const trimmed = line.trim();
    return trimmed.length <= 100 ? trimmed : trimmed.slice(0, 97) + '...';
  }

  /**
   * Find containing function
   */
  private findContainingFunction(lines: string[], lineIndex: number): string | undefined {
    for (let i = lineIndex - 1; i >= 0; i--) {
      const line = lines[i];
      if (!line) {continue;}

      // Function patterns
      const match = line.match(
        /(?:function\s+(\w+)|(\w+)\s*(?:=|:)\s*(?:async\s+)?(?:\([^)]*\)|[^=]+)\s*=>|def\s+(\w+)|func\s+(?:\([^)]+\)\s+)?(\w+))/
      );
      if (match) {
        return match[1] || match[2] || match[3] || match[4];
      }

      // Stop at class boundary
      if (line.match(/^(?:class|interface|struct)\s+/)) {
        break;
      }
    }
    return undefined;
  }
}
