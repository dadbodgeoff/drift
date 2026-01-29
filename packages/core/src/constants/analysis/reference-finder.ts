/**
 * Constant Reference Finder
 *
 * Finds all usages of constants across the codebase.
 * Supports cross-file reference tracking.
 */

import type {
  ConstantExtraction,
  EnumExtraction,
  ConstantReference,
} from '../types.js';

/**
 * Configuration for reference finding
 */
export interface ReferenceFindConfig {
  /** Maximum files to scan */
  maxFiles?: number;
  /** Include test files */
  includeTests?: boolean;
  /** File patterns to exclude */
  excludePatterns?: string[];
  /** Track reference context (containing function) */
  trackContext?: boolean;
}

/**
 * Default reference find config
 */
export const DEFAULT_REFERENCE_FIND_CONFIG: Required<ReferenceFindConfig> = {
  maxFiles: 10000,
  includeTests: true,
  excludePatterns: ['node_modules', 'dist', 'build', '.git'],
  trackContext: true,
};

/**
 * Result of finding references for a constant
 */
export interface ReferenceResult {
  /** The constant being referenced */
  constant: ConstantExtraction | EnumExtraction;
  /** All references found */
  references: ConstantReference[];
  /** Total count */
  totalCount: number;
  /** Files containing references */
  filesWithReferences: string[];
  /** Search time in ms */
  searchTimeMs: number;
}

/**
 * Reference finder for constants
 */
export class ConstantReferenceFinder {
  private config: Required<ReferenceFindConfig>;

  constructor(config: ReferenceFindConfig = {}) {
    this.config = { ...DEFAULT_REFERENCE_FIND_CONFIG, ...config };
  }

  /**
   * Find all references to a constant in the given files
   */
  findReferences(
    constant: ConstantExtraction | EnumExtraction,
    files: Map<string, string>
  ): ReferenceResult {
    const startTime = performance.now();
    const references: ConstantReference[] = [];
    const filesWithReferences = new Set<string>();

    // Build search patterns for this constant
    const patterns = this.buildSearchPatterns(constant);

    for (const [filePath, content] of files) {
      // Skip excluded patterns
      if (this.shouldExcludeFile(filePath)) {
        continue;
      }

      // Skip the definition file for the same line
      const isDefinitionFile = filePath === constant.file;

      // Search for references
      const fileRefs = this.findInFile(
        constant,
        patterns,
        filePath,
        content,
        isDefinitionFile
      );

      if (fileRefs.length > 0) {
        references.push(...fileRefs);
        filesWithReferences.add(filePath);
      }
    }

    return {
      constant,
      references,
      totalCount: references.length,
      filesWithReferences: Array.from(filesWithReferences),
      searchTimeMs: performance.now() - startTime,
    };
  }

  /**
   * Find references in a single file
   */
  private findInFile(
    constant: ConstantExtraction | EnumExtraction,
    patterns: RegExp[],
    filePath: string,
    content: string,
    isDefinitionFile: boolean
  ): ConstantReference[] {
    const references: ConstantReference[] = [];
    const lines = content.split('\n');

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      const line = lines[lineIndex];
      if (!line) {continue;}
      const lineNumber = lineIndex + 1;

      // Skip the definition line
      if (isDefinitionFile && lineNumber === constant.line) {
        continue;
      }

      for (const pattern of patterns) {
        pattern.lastIndex = 0; // Reset regex state
        let match: RegExpExecArray | null;

        while ((match = pattern.exec(line)) !== null) {
          const column = match.index + 1;

          // Determine reference type
          const referenceType = this.inferReferenceType(line, match.index);

          // Get containing function if tracking context
          const containingFunction = this.config.trackContext
            ? this.findContainingFunction(lines, lineIndex)
            : undefined;

          // Get containing class
          const containingClass = this.config.trackContext
            ? this.findContainingClass(lines, lineIndex)
            : undefined;

          references.push({
            constantId: constant.id,
            constantName: constant.name,
            file: filePath,
            line: lineNumber,
            column,
            context: this.extractContext(lines, lineIndex),
            ...(containingFunction ? { containingFunction } : {}),
            ...(containingClass ? { containingClass } : {}),
            referenceType,
          });
        }
      }
    }

    return references;
  }

  /**
   * Build search patterns for a constant
   */
  private buildSearchPatterns(constant: ConstantExtraction | EnumExtraction): RegExp[] {
    const patterns: RegExp[] = [];
    const name = constant.name;

    // Direct name reference (word boundary)
    patterns.push(new RegExp(`\\b${this.escapeRegex(name)}\\b`, 'g'));

    // Qualified name if different
    if (constant.qualifiedName !== name) {
      patterns.push(new RegExp(`\\b${this.escapeRegex(constant.qualifiedName)}\\b`, 'g'));
    }

    // For enums, also search for member access
    if ('members' in constant) {
      for (const member of constant.members) {
        // EnumName.MemberName
        patterns.push(
          new RegExp(`\\b${this.escapeRegex(name)}\\.${this.escapeRegex(member.name)}\\b`, 'g')
        );
        // EnumName::MemberName (PHP)
        patterns.push(
          new RegExp(`\\b${this.escapeRegex(name)}::${this.escapeRegex(member.name)}\\b`, 'g')
        );
      }
    }

    // Class constant access patterns
    if ('parentName' in constant && constant.parentName) {
      // ClassName.CONSTANT (Java, C#)
      patterns.push(
        new RegExp(`\\b${this.escapeRegex(constant.parentName)}\\.${this.escapeRegex(name)}\\b`, 'g')
      );
      // ClassName::CONSTANT (PHP)
      patterns.push(
        new RegExp(`\\b${this.escapeRegex(constant.parentName)}::${this.escapeRegex(name)}\\b`, 'g')
      );
    }

    return patterns;
  }

  /**
   * Infer the type of reference from context
   */
  private inferReferenceType(
    line: string,
    matchIndex: number
  ): 'read' | 'assignment' | 'parameter' | 'comparison' {
    const beforeMatch = line.slice(0, matchIndex).trim();
    const afterMatch = line.slice(matchIndex).trim();

    // Check for assignment (constant on left side)
    if (beforeMatch.endsWith('=') && !beforeMatch.endsWith('==') && !beforeMatch.endsWith('!=')) {
      return 'assignment';
    }

    // Check for comparison
    if (
      afterMatch.startsWith('==') ||
      afterMatch.startsWith('===') ||
      afterMatch.startsWith('!=') ||
      afterMatch.startsWith('!==') ||
      beforeMatch.endsWith('==') ||
      beforeMatch.endsWith('===') ||
      beforeMatch.endsWith('!=') ||
      beforeMatch.endsWith('!==')
    ) {
      return 'comparison';
    }

    // Check for function parameter (inside parentheses)
    if (beforeMatch.includes('(') && !beforeMatch.includes(')')) {
      return 'parameter';
    }

    return 'read';
  }

  /**
   * Find the containing function for a line
   */
  private findContainingFunction(lines: string[], lineIndex: number): string | undefined {
    // Search backwards for function definition
    for (let i = lineIndex - 1; i >= 0; i--) {
      const line = lines[i];
      if (!line) {continue;}

      // TypeScript/JavaScript function patterns
      const tsMatch = line.match(/(?:async\s+)?(?:function\s+(\w+)|(\w+)\s*(?:=|:)\s*(?:async\s+)?(?:\([^)]*\)|[^=]+)\s*=>|(\w+)\s*\([^)]*\)\s*\{)/);
      if (tsMatch) {
        return tsMatch[1] || tsMatch[2] || tsMatch[3];
      }

      // Python function pattern
      const pyMatch = line.match(/def\s+(\w+)\s*\(/);
      if (pyMatch) {
        return pyMatch[1];
      }

      // Java/C# method pattern
      const javaMatch = line.match(/(?:public|private|protected|static|async|override|virtual)?\s*(?:\w+(?:<[^>]+>)?)\s+(\w+)\s*\([^)]*\)\s*(?:\{|=>|:)/);
      if (javaMatch) {
        return javaMatch[1];
      }

      // PHP function pattern
      const phpMatch = line.match(/(?:public|private|protected|static)?\s*function\s+(\w+)\s*\(/);
      if (phpMatch) {
        return phpMatch[1];
      }

      // Go function pattern
      const goMatch = line.match(/func\s+(?:\([^)]+\)\s+)?(\w+)\s*\(/);
      if (goMatch) {
        return goMatch[1];
      }

      // Stop at class/module boundary
      if (line.match(/^(?:class|interface|struct|enum|module|namespace)\s+/)) {
        break;
      }
    }

    return undefined;
  }

  /**
   * Find the containing class for a line
   */
  private findContainingClass(lines: string[], lineIndex: number): string | undefined {
    // Search backwards for class definition
    for (let i = lineIndex - 1; i >= 0; i--) {
      const line = lines[i];
      if (!line) {continue;}

      const classMatch = line.match(/(?:class|interface|struct|enum)\s+(\w+)/);
      if (classMatch) {
        return classMatch[1];
      }
    }

    return undefined;
  }

  /**
   * Extract context snippet around a line
   */
  private extractContext(lines: string[], lineIndex: number): string {
    const line = lines[lineIndex];
    if (!line) {return '';}

    // Return trimmed line, max 100 chars
    const trimmed = line.trim();
    if (trimmed.length <= 100) {
      return trimmed;
    }
    return trimmed.slice(0, 97) + '...';
  }

  /**
   * Check if a file should be excluded
   */
  private shouldExcludeFile(filePath: string): boolean {
    // Check exclude patterns
    for (const pattern of this.config.excludePatterns) {
      if (filePath.includes(pattern)) {
        return true;
      }
    }

    // Check test files if not including tests
    if (!this.config.includeTests) {
      if (
        filePath.includes('.test.') ||
        filePath.includes('.spec.') ||
        filePath.includes('__tests__') ||
        filePath.includes('__mocks__')
      ) {
        return true;
      }
    }

    return false;
  }

  /**
   * Escape special regex characters
   */
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}

/**
 * Batch find references for multiple constants
 */
export function findAllReferences(
  constants: (ConstantExtraction | EnumExtraction)[],
  files: Map<string, string>,
  config?: ReferenceFindConfig
): Map<string, ReferenceResult> {
  const finder = new ConstantReferenceFinder(config);
  const results = new Map<string, ReferenceResult>();

  for (const constant of constants) {
    const result = finder.findReferences(constant, files);
    results.set(constant.id, result);
  }

  return results;
}
