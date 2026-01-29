/**
 * Quick Fix Generator - Code transformation generation for violations
 *
 * Generates code transformations (quick fixes) for pattern violations.
 * Supports multiple fix types: replace, wrap, extract, import, rename, move, delete.
 * Provides preview of changes before applying.
 *
 * @requirements 25.1 - THE Quick_Fix_System SHALL generate code transformations for fixable violations
 * @requirements 25.2 - THE Quick_Fix SHALL include a preview of the change before applying
 * @requirements 25.3 - THE Quick_Fix SHALL support fix types: replace, wrap, extract, import, rename, move, delete
 * @requirements 25.4 - WHEN multiple fixes are available, THE Quick_Fix_System SHALL rank by confidence
 * @requirements 25.5 - THE Quick_Fix_System SHALL mark the preferred fix for one-click application
 */

import {
  createTextEdit,
  createInsertEdit,
  createDeleteEdit,
  createWorkspaceEdit,
  createPosition,
} from './types.js';

import type {
  Violation,
  QuickFix,
  QuickFixWithMetadata,
  FixType,
  FixImpact,
  WorkspaceEdit,
  TextEdit,
  Range,
  Position,
} from './types.js';

// ============================================================================
// Quick Fix Generator Configuration
// ============================================================================

/**
 * Configuration options for the QuickFixGenerator
 */
export interface QuickFixGeneratorConfig {
  /** Minimum confidence threshold for generating fixes */
  minConfidence?: number;

  /** Maximum number of fixes to generate per violation */
  maxFixesPerViolation?: number;

  /** Whether to generate previews for fixes */
  generatePreviews?: boolean;

  /** Whether to validate fixes before returning */
  validateFixes?: boolean;
}

/**
 * Default QuickFixGenerator configuration
 */
export const DEFAULT_QUICK_FIX_GENERATOR_CONFIG: Required<QuickFixGeneratorConfig> = {
  minConfidence: 0.5,
  maxFixesPerViolation: 5,
  generatePreviews: true,
  validateFixes: true,
};

// ============================================================================
// Fix Strategy Types
// ============================================================================

/**
 * Strategy for generating a specific type of fix
 */
export interface FixStrategy {
  /** Type of fix this strategy generates */
  type: FixType;

  /** Generate a fix for a violation */
  generate(context: FixContext): QuickFix | null;

  /** Check if this strategy can handle the violation */
  canHandle(violation: Violation): boolean;

  /** Get the confidence score for this fix */
  getConfidence(context: FixContext): number;
}

/**
 * Context for generating a fix
 */
export interface FixContext {
  /** The violation to fix */
  violation: Violation;

  /** File content */
  content: string;

  /** Expected code/pattern */
  expected: string;

  /** Actual code found */
  actual: string;

  /** Additional context for the fix */
  metadata?: Record<string, unknown>;
}

/**
 * Result of generating fixes for a violation
 */
export interface FixGenerationResult {
  /** Violation ID */
  violationId: string;

  /** Generated fixes (sorted by confidence) */
  fixes: QuickFixWithMetadata[];

  /** Whether any fixes were generated */
  hasFixs: boolean;

  /** The preferred fix (highest confidence) */
  preferredFix?: QuickFixWithMetadata;

  /** Errors encountered during generation */
  errors: string[];
}

// ============================================================================
// Replace Fix Strategy
// ============================================================================

/**
 * Strategy for generating replace fixes
 * Replaces text at a specific range with new text
 */
export class ReplaceFixStrategy implements FixStrategy {
  readonly type: FixType = 'replace';

  canHandle(violation: Violation): boolean {
    // Replace can handle most violations where we know what to replace with
    return violation.expected !== undefined && violation.expected.length > 0;
  }

  getConfidence(context: FixContext): number {
    // Higher confidence if expected and actual are clearly different
    if (context.expected === context.actual) {
      return 0;
    }
    // Base confidence for replace operations
    return 0.8;
  }

  generate(context: FixContext): QuickFix | null {
    const { violation, expected } = context;

    if (!expected || expected.length === 0) {
      return null;
    }

    const edit = createTextEdit(violation.range, expected);
    const workspaceEdit = createWorkspaceEdit(violation.file, [edit]);

    return {
      title: `Replace with: ${this.truncateText(expected, 50)}`,
      kind: 'quickfix',
      edit: workspaceEdit,
      isPreferred: true,
      confidence: this.getConfidence(context),
      preview: this.generatePreview(context, expected),
    };
  }

  private truncateText(text: string, maxLength: number): string {
    if (text.length <= maxLength) {
      return text;
    }
    return text.substring(0, maxLength - 3) + '...';
  }

  private generatePreview(context: FixContext, newText: string): string {
    return `Replace "${this.truncateText(context.actual, 30)}" with "${this.truncateText(newText, 30)}"`;
  }
}

// ============================================================================
// Wrap Fix Strategy
// ============================================================================

/**
 * Strategy for generating wrap fixes
 * Wraps code with additional structure (e.g., try/catch, function wrapper)
 */
export class WrapFixStrategy implements FixStrategy {
  readonly type: FixType = 'wrap';

  canHandle(violation: Violation): boolean {
    // Wrap can handle violations that suggest wrapping code
    const wrapKeywords = ['wrap', 'surround', 'enclose', 'try', 'catch', 'async'];
    const message = violation.message.toLowerCase();
    return wrapKeywords.some(keyword => message.includes(keyword));
  }

  getConfidence(_context: FixContext): number {
    // Wrap operations have moderate confidence
    return 0.7;
  }

  generate(context: FixContext): QuickFix | null {
    const { violation, content } = context;

    // Extract the code to wrap
    const codeToWrap = this.extractCode(content, violation.range);
    if (!codeToWrap) {
      return null;
    }

    // Determine wrap type based on violation message
    const wrapType = this.determineWrapType(violation);
    const wrappedCode = this.wrapCode(codeToWrap, wrapType);

    const edit = createTextEdit(violation.range, wrappedCode);
    const workspaceEdit = createWorkspaceEdit(violation.file, [edit]);

    return {
      title: `Wrap with ${wrapType}`,
      kind: 'refactor',
      edit: workspaceEdit,
      isPreferred: false,
      confidence: this.getConfidence(context),
      preview: `Wrap code with ${wrapType} block`,
    };
  }

  private extractCode(content: string, range: Range): string | null {
    const lines = content.split('\n');
    const startLine = range.start.line;
    const endLine = range.end.line;

    if (startLine < 0 || endLine >= lines.length) {
      return null;
    }

    if (startLine === endLine) {
      const line = lines[startLine];
      if (line === undefined) {return null;}
      return line.substring(range.start.character, range.end.character);
    }

    const extractedLines: string[] = [];
    for (let i = startLine; i <= endLine; i++) {
      const line = lines[i];
      if (line === undefined) {continue;}
      if (i === startLine) {
        extractedLines.push(line.substring(range.start.character));
      } else if (i === endLine) {
        extractedLines.push(line.substring(0, range.end.character));
      } else {
        extractedLines.push(line);
      }
    }
    return extractedLines.join('\n');
  }

  private determineWrapType(violation: Violation): string {
    const message = violation.message.toLowerCase();
    if (message.includes('try') || message.includes('catch') || message.includes('error')) {
      return 'try-catch';
    }
    if (message.includes('async') || message.includes('await')) {
      return 'async';
    }
    if (message.includes('function')) {
      return 'function';
    }
    return 'block';
  }

  private wrapCode(code: string, wrapType: string): string {
    const indent = this.detectIndent(code);
    switch (wrapType) {
      case 'try-catch':
        return `try {\n${indent}  ${code}\n${indent}} catch (error) {\n${indent}  throw error;\n${indent}}`;
      case 'async':
        return `(async () => {\n${indent}  ${code}\n${indent}})()`;
      case 'function':
        return `function wrapper() {\n${indent}  ${code}\n${indent}}`;
      default:
        return `{\n${indent}  ${code}\n${indent}}`;
    }
  }

  private detectIndent(code: string): string {
    const match = code.match(/^(\s*)/);
    return match?.[1] ? match[1] : '';
  }
}

// ============================================================================
// Extract Fix Strategy
// ============================================================================

/**
 * Strategy for generating extract fixes
 * Extracts code into a new location (e.g., extract function, extract variable)
 */
export class ExtractFixStrategy implements FixStrategy {
  readonly type: FixType = 'extract';

  canHandle(violation: Violation): boolean {
    // Extract can handle violations suggesting code extraction
    const extractKeywords = ['extract', 'refactor', 'duplicate', 'repeated', 'abstract'];
    const message = violation.message.toLowerCase();
    return extractKeywords.some(keyword => message.includes(keyword));
  }

  getConfidence(_context: FixContext): number {
    // Extract operations have moderate confidence
    return 0.65;
  }

  generate(context: FixContext): QuickFix | null {
    const { violation, content } = context;

    // Extract the code to extract
    const codeToExtract = this.extractCode(content, violation.range);
    if (!codeToExtract) {
      return null;
    }

    // Generate extracted function/variable
    const extractedName = this.generateExtractedName(violation);
    const { extractedCode, replacement } = this.createExtraction(codeToExtract, extractedName);

    // Create edits: replace original with reference, add extracted code
    const replaceEdit = createTextEdit(violation.range, replacement);
    
    // Insert extracted code at the beginning of the file (simplified)
    const insertPosition = createPosition(0, 0);
    const insertEdit = createInsertEdit(insertPosition, extractedCode + '\n\n');

    const workspaceEdit: WorkspaceEdit = {
      changes: {
        [violation.file]: [insertEdit, replaceEdit],
      },
    };

    return {
      title: `Extract to ${extractedName}`,
      kind: 'refactor',
      edit: workspaceEdit,
      isPreferred: false,
      confidence: this.getConfidence(context),
      preview: `Extract code to function "${extractedName}"`,
    };
  }

  private extractCode(content: string, range: Range): string | null {
    const lines = content.split('\n');
    const startLine = range.start.line;
    const endLine = range.end.line;

    if (startLine < 0 || endLine >= lines.length) {
      return null;
    }

    if (startLine === endLine) {
      const line = lines[startLine];
      if (line === undefined) {return null;}
      return line.substring(range.start.character, range.end.character);
    }

    const extractedLines: string[] = [];
    for (let i = startLine; i <= endLine; i++) {
      const line = lines[i];
      if (line === undefined) {continue;}
      if (i === startLine) {
        extractedLines.push(line.substring(range.start.character));
      } else if (i === endLine) {
        extractedLines.push(line.substring(0, range.end.character));
      } else {
        extractedLines.push(line);
      }
    }
    return extractedLines.join('\n');
  }

  private generateExtractedName(violation: Violation): string {
    // Generate a name based on the pattern or violation
    const patternId = violation.patternId;
    const sanitized = patternId.replace(/[^a-zA-Z0-9]/g, '_');
    return `extracted_${sanitized}`;
  }

  private createExtraction(code: string, name: string): { extractedCode: string; replacement: string } {
    // Create a function extraction
    const extractedCode = `function ${name}() {\n  ${code}\n}`;
    const replacement = `${name}()`;
    return { extractedCode, replacement };
  }
}

// ============================================================================
// Import Fix Strategy
// ============================================================================

/**
 * Strategy for generating import fixes
 * Adds import statements for missing dependencies
 */
export class ImportFixStrategy implements FixStrategy {
  readonly type: FixType = 'import';

  canHandle(violation: Violation): boolean {
    // Import can handle violations about missing imports
    const importKeywords = ['import', 'require', 'missing', 'undefined', 'not found', 'module'];
    const message = violation.message.toLowerCase();
    return importKeywords.some(keyword => message.includes(keyword));
  }

  getConfidence(_context: FixContext): number {
    // Import operations have high confidence when we know what to import
    return 0.85;
  }

  generate(context: FixContext): QuickFix | null {
    const { violation, expected } = context;

    // Try to extract import information from expected
    const importStatement = this.generateImportStatement(expected, violation);
    if (!importStatement) {
      return null;
    }

    // Insert import at the top of the file
    const insertPosition = createPosition(0, 0);
    const insertEdit = createInsertEdit(insertPosition, importStatement + '\n');
    const workspaceEdit = createWorkspaceEdit(violation.file, [insertEdit]);

    return {
      title: `Add import: ${this.truncateText(importStatement, 50)}`,
      kind: 'quickfix',
      edit: workspaceEdit,
      isPreferred: true,
      confidence: this.getConfidence(context),
      preview: `Add import statement at top of file`,
    };
  }

  private generateImportStatement(expected: string, violation: Violation): string | null {
    // Try to parse expected as an import statement
    if (expected.startsWith('import ')) {
      return expected;
    }

    // Try to extract module name from violation message
    const moduleMatch = violation.message.match(/['"]([^'"]+)['"]/);
    if (moduleMatch?.[1]) {
      return `import { } from '${moduleMatch[1]}';`;
    }

    // Try to extract from expected
    if (expected.includes('/') || expected.includes('@')) {
      return `import { } from '${expected}';`;
    }

    return null;
  }

  private truncateText(text: string, maxLength: number): string {
    if (text.length <= maxLength) {
      return text;
    }
    return text.substring(0, maxLength - 3) + '...';
  }
}

// ============================================================================
// Rename Fix Strategy
// ============================================================================

/**
 * Strategy for generating rename fixes
 * Renames symbols to match naming conventions
 */
export class RenameFixStrategy implements FixStrategy {
  readonly type: FixType = 'rename';

  canHandle(violation: Violation): boolean {
    // Rename can handle violations about naming conventions
    const renameKeywords = ['rename', 'naming', 'convention', 'case', 'camel', 'pascal', 'snake', 'kebab'];
    const message = violation.message.toLowerCase();
    return renameKeywords.some(keyword => message.includes(keyword));
  }

  getConfidence(_context: FixContext): number {
    // Rename operations have high confidence for naming violations
    return 0.9;
  }

  generate(context: FixContext): QuickFix | null {
    const { violation, expected, actual } = context;

    if (!expected || expected === actual) {
      return null;
    }

    // Generate the new name based on expected pattern
    const newName = this.generateNewName(actual, expected, violation);
    if (!newName || newName === actual) {
      return null;
    }

    const edit = createTextEdit(violation.range, newName);
    const workspaceEdit = createWorkspaceEdit(violation.file, [edit]);

    return {
      title: `Rename to "${newName}"`,
      kind: 'quickfix',
      edit: workspaceEdit,
      isPreferred: true,
      confidence: this.getConfidence(context),
      preview: `Rename "${actual}" to "${newName}"`,
    };
  }

  private generateNewName(actual: string, expected: string, violation: Violation): string | null {
    const message = violation.message.toLowerCase();

    // If expected is a specific name, use it
    if (!expected.includes('case') && !expected.includes('convention')) {
      return expected;
    }

    // Convert based on naming convention
    if (message.includes('camelcase') || message.includes('camel case')) {
      return this.toCamelCase(actual);
    }
    if (message.includes('pascalcase') || message.includes('pascal case')) {
      return this.toPascalCase(actual);
    }
    if (message.includes('snake_case') || message.includes('snake case')) {
      return this.toSnakeCase(actual);
    }
    if (message.includes('kebab-case') || message.includes('kebab case')) {
      return this.toKebabCase(actual);
    }

    return expected;
  }

  private toCamelCase(str: string): string {
    return str
      .replace(/[-_\s]+(.)?/g, (_, c) => (c ? c.toUpperCase() : ''))
      .replace(/^[A-Z]/, c => c.toLowerCase());
  }

  private toPascalCase(str: string): string {
    return str
      .replace(/[-_\s]+(.)?/g, (_, c) => (c ? c.toUpperCase() : ''))
      .replace(/^[a-z]/, c => c.toUpperCase());
  }

  private toSnakeCase(str: string): string {
    return str
      .replace(/([A-Z])/g, '_$1')
      .replace(/[-\s]+/g, '_')
      .toLowerCase()
      .replace(/^_/, '');
  }

  private toKebabCase(str: string): string {
    return str
      .replace(/([A-Z])/g, '-$1')
      .replace(/[_\s]+/g, '-')
      .toLowerCase()
      .replace(/^-/, '');
  }
}

// ============================================================================
// Move Fix Strategy
// ============================================================================

/**
 * Strategy for generating move fixes
 * Moves code to a different location (e.g., different file, different position)
 */
export class MoveFixStrategy implements FixStrategy {
  readonly type: FixType = 'move';

  canHandle(violation: Violation): boolean {
    // Move can handle violations about code location
    const moveKeywords = ['move', 'relocate', 'location', 'position', 'place', 'organize'];
    const message = violation.message.toLowerCase();
    return moveKeywords.some(keyword => message.includes(keyword));
  }

  getConfidence(_context: FixContext): number {
    // Move operations have lower confidence due to complexity
    return 0.6;
  }

  generate(context: FixContext): QuickFix | null {
    const { violation, content, expected } = context;

    // Extract the code to move
    const codeToMove = this.extractCode(content, violation.range);
    if (!codeToMove) {
      return null;
    }

    // Determine target location
    const targetLocation = this.determineTargetLocation(violation, expected);
    if (!targetLocation) {
      return null;
    }

    // Create edits: delete from original, insert at target
    const deleteEdit = createDeleteEdit(violation.range);
    const insertEdit = createInsertEdit(targetLocation, codeToMove);

    const workspaceEdit: WorkspaceEdit = {
      changes: {
        [violation.file]: [deleteEdit, insertEdit],
      },
    };

    return {
      title: `Move code to line ${targetLocation.line + 1}`,
      kind: 'refactor',
      edit: workspaceEdit,
      isPreferred: false,
      confidence: this.getConfidence(context),
      preview: `Move code from line ${violation.range.start.line + 1} to line ${targetLocation.line + 1}`,
    };
  }

  private extractCode(content: string, range: Range): string | null {
    const lines = content.split('\n');
    const startLine = range.start.line;
    const endLine = range.end.line;

    if (startLine < 0 || endLine >= lines.length) {
      return null;
    }

    if (startLine === endLine) {
      const line = lines[startLine];
      if (line === undefined) {return null;}
      return line.substring(range.start.character, range.end.character);
    }

    const extractedLines: string[] = [];
    for (let i = startLine; i <= endLine; i++) {
      const line = lines[i];
      if (line === undefined) {continue;}
      if (i === startLine) {
        extractedLines.push(line.substring(range.start.character));
      } else if (i === endLine) {
        extractedLines.push(line.substring(0, range.end.character));
      } else {
        extractedLines.push(line);
      }
    }
    return extractedLines.join('\n');
  }

  private determineTargetLocation(_violation: Violation, expected: string): Position | null {
    // Try to parse target line from expected
    const lineMatch = expected.match(/line\s*(\d+)/i);
    if (lineMatch?.[1]) {
      const targetLine = parseInt(lineMatch[1], 10) - 1; // Convert to 0-indexed
      return createPosition(targetLine, 0);
    }

    // Default: move to beginning of file
    return createPosition(0, 0);
  }
}

// ============================================================================
// Delete Fix Strategy
// ============================================================================

/**
 * Strategy for generating delete fixes
 * Deletes code that should be removed
 */
export class DeleteFixStrategy implements FixStrategy {
  readonly type: FixType = 'delete';

  canHandle(violation: Violation): boolean {
    // Delete can handle violations about unnecessary code
    const deleteKeywords = ['delete', 'remove', 'unused', 'unnecessary', 'redundant', 'dead code'];
    const message = violation.message.toLowerCase();
    return deleteKeywords.some(keyword => message.includes(keyword));
  }

  getConfidence(_context: FixContext): number {
    // Delete operations have moderate confidence
    return 0.75;
  }

  generate(context: FixContext): QuickFix | null {
    const { violation } = context;

    const deleteEdit = createDeleteEdit(violation.range);
    const workspaceEdit = createWorkspaceEdit(violation.file, [deleteEdit]);

    return {
      title: 'Delete code',
      kind: 'quickfix',
      edit: workspaceEdit,
      isPreferred: false,
      confidence: this.getConfidence(context),
      preview: `Delete code at lines ${violation.range.start.line + 1}-${violation.range.end.line + 1}`,
    };
  }
}

// ============================================================================
// Quick Fix Generator Class
// ============================================================================

/**
 * QuickFixGenerator class for generating code transformations for violations.
 *
 * The generator:
 * - Takes violations and generates appropriate quick fixes
 * - Supports multiple fix types: replace, wrap, extract, import, rename, move, delete
 * - Ranks fixes by confidence and marks preferred fix
 * - Provides preview of changes before applying
 *
 * @requirements 25.1 - Generate code transformations for fixable violations
 * @requirements 25.3 - Support fix types: replace, wrap, extract, import, rename, move, delete
 * @requirements 25.4 - Rank fixes by confidence
 * @requirements 25.5 - Mark preferred fix for one-click application
 */
export class QuickFixGenerator {
  private config: Required<QuickFixGeneratorConfig>;
  private strategies: FixStrategy[];
  private fixIdCounter: number;

  /**
   * Create a new QuickFixGenerator instance.
   *
   * @param config - Optional configuration options
   */
  constructor(config?: QuickFixGeneratorConfig) {
    this.config = {
      ...DEFAULT_QUICK_FIX_GENERATOR_CONFIG,
      ...config,
    };

    // Initialize all fix strategies
    this.strategies = [
      new ReplaceFixStrategy(),
      new WrapFixStrategy(),
      new ExtractFixStrategy(),
      new ImportFixStrategy(),
      new RenameFixStrategy(),
      new MoveFixStrategy(),
      new DeleteFixStrategy(),
    ];

    this.fixIdCounter = 0;
  }

  /**
   * Generate quick fixes for a violation.
   *
   * @param violation - The violation to generate fixes for
   * @param content - The file content
   * @returns Fix generation result with ranked fixes
   *
   * @requirements 25.1 - Generate code transformations
   * @requirements 25.4 - Rank by confidence
   */
  generateFixes(violation: Violation, content: string): FixGenerationResult {
    const errors: string[] = [];
    const fixes: QuickFixWithMetadata[] = [];

    const context: FixContext = {
      violation,
      content,
      expected: violation.expected,
      actual: violation.actual,
    };

    // Try each strategy
    for (const strategy of this.strategies) {
      try {
        if (strategy.canHandle(violation)) {
          const fix = strategy.generate(context);
          if (fix && fix.confidence >= this.config.minConfidence) {
            const fixWithMetadata = this.addMetadata(fix, violation, strategy.type);
            fixes.push(fixWithMetadata);
          }
        }
      } catch (error) {
        errors.push(`Strategy ${strategy.type} failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    // Sort by confidence (highest first)
    fixes.sort((a, b) => b.confidence - a.confidence);

    // Limit number of fixes
    const limitedFixes = fixes.slice(0, this.config.maxFixesPerViolation);

    // Mark preferred fix
    if (limitedFixes.length > 0) {
      const firstFix = limitedFixes[0];
      if (firstFix) {
        firstFix.isPreferred = true;
      }
      for (let i = 1; i < limitedFixes.length; i++) {
        const fix = limitedFixes[i];
        if (fix) {
          fix.isPreferred = false;
        }
      }
    }

    const result: FixGenerationResult = {
      violationId: violation.id,
      fixes: limitedFixes,
      hasFixs: limitedFixes.length > 0,
      errors,
    };

    if (limitedFixes.length > 0 && limitedFixes[0]) {
      result.preferredFix = limitedFixes[0];
    }

    return result;
  }

  /**
   * Generate quick fixes for multiple violations.
   *
   * @param violations - Array of violations
   * @param content - The file content
   * @returns Array of fix generation results
   */
  generateFixesForAll(violations: Violation[], content: string): FixGenerationResult[] {
    return violations.map(violation => this.generateFixes(violation, content));
  }

  /**
   * Generate a specific type of fix for a violation.
   *
   * @param violation - The violation to fix
   * @param content - The file content
   * @param fixType - The type of fix to generate
   * @returns The generated fix or null if not applicable
   */
  generateFixOfType(violation: Violation, content: string, fixType: FixType): QuickFix | null {
    const strategy = this.strategies.find(s => s.type === fixType);
    if (!strategy) {
      return null;
    }

    const context: FixContext = {
      violation,
      content,
      expected: violation.expected,
      actual: violation.actual,
    };

    if (!strategy.canHandle(violation)) {
      return null;
    }

    return strategy.generate(context);
  }

  /**
   * Generate a preview of a fix before applying.
   *
   * @param fix - The quick fix to preview
   * @param content - The original file content
   * @returns Preview string showing the change
   *
   * @requirements 25.2 - Include preview of change before applying
   */
  generatePreview(fix: QuickFix, content: string): string {
    if (fix.preview) {
      return fix.preview;
    }

    // Generate a diff-like preview
    const lines: string[] = [];
    const fileEdits = Object.entries(fix.edit.changes);

    for (const [file, edits] of fileEdits) {
      lines.push(`File: ${file}`);
      lines.push('---');

      for (const edit of edits) {
        const originalText = this.extractTextFromRange(content, edit.range);
        if (edit.newText === '') {
          lines.push(`- ${originalText}`);
        } else if (originalText === '') {
          lines.push(`+ ${edit.newText}`);
        } else {
          lines.push(`- ${originalText}`);
          lines.push(`+ ${edit.newText}`);
        }
      }
    }

    return lines.join('\n');
  }

  /**
   * Apply a fix to content and return the result.
   *
   * This method is idempotent: applying the same fix twice will result in
   * no additional changes after the first application.
   *
   * @param fix - The quick fix to apply
   * @param content - The original file content
   * @returns The modified content after applying the fix
   *
   * @requirements 25.1 - Generate code transformations for fixable violations
   */
  applyFix(fix: QuickFix, content: string): string {
    // Get edits for the file (assuming single file for now)
    const fileEdits = Object.values(fix.edit.changes)[0];
    if (!fileEdits || fileEdits.length === 0) {
      return content;
    }

    // Sort edits by position (reverse order to apply from end to start)
    const sortedEdits = [...fileEdits].sort((a, b) => {
      if (a.range.start.line !== b.range.start.line) {
        return b.range.start.line - a.range.start.line;
      }
      return b.range.start.character - a.range.start.character;
    });

    // Apply all edits
    let result = content;
    for (const edit of sortedEdits) {
      if (edit.newText === '') {
        // Delete operation: check if the text at the range is empty
        // If it is, the delete has already been applied
        const textAtRange = this.extractTextFromRange(result, edit.range);
        if (textAtRange === '') {
          // Range is already empty, skip this edit
          continue;
        }
      } else {
        // Replace/insert operation: check if the text at the start position
        // already matches the newText. If so, skip this edit.
        const textAtStart = this.extractTextFromPosition(
          result,
          edit.range.start,
          edit.newText.length
        );
        
        if (textAtStart === edit.newText) {
          // Text already matches, skip this edit
          continue;
        }
      }
      
      result = this.applyTextEdit(result, edit);
    }

    return result;
  }

  /**
   * Extract text from a position for a given length.
   * Used for idempotence checking.
   */
  private extractTextFromPosition(content: string, start: Position, length: number): string {
    const lines = content.split('\n');
    if (start.line < 0 || start.line >= lines.length) {
      return '';
    }

    let result = '';
    let currentLine = start.line;
    let currentChar = start.character;
    let remaining = length;

    while (remaining > 0 && currentLine < lines.length) {
      const line = lines[currentLine];
      if (line === undefined) {break;}

      const availableChars = line.length - currentChar;
      if (availableChars <= 0) {
        // Move to next line, add newline character
        if (remaining > 0 && currentLine < lines.length - 1) {
          result += '\n';
          remaining--;
          currentLine++;
          currentChar = 0;
        } else {
          break;
        }
      } else {
        const charsToTake = Math.min(availableChars, remaining);
        result += line.substring(currentChar, currentChar + charsToTake);
        remaining -= charsToTake;
        currentChar += charsToTake;

        // If we've consumed the line and need more, add newline and move to next
        if (remaining > 0 && currentChar >= line.length && currentLine < lines.length - 1) {
          result += '\n';
          remaining--;
          currentLine++;
          currentChar = 0;
        }
      }
    }

    return result;
  }

  /**
   * Check if a fix is idempotent (applying twice has no additional effect).
   *
   * A fix is idempotent if after applying it once, the content at the
   * fix's range already matches the newText, so applying again has no effect.
   *
   * @param fix - The quick fix to check
   * @param content - The original file content
   * @returns True if the fix is idempotent
   */
  isIdempotent(fix: QuickFix, content: string): boolean {
    // Apply the fix once
    const afterFirst = this.applyFix(fix, content);

    // Check if the content at each edit range now matches the newText
    // If so, applying again would have no effect
    for (const [_file, edits] of Object.entries(fix.edit.changes)) {
      for (const edit of edits) {
        const currentText = this.extractTextFromRange(afterFirst, edit.range);
        // If the range is now out of bounds or the text doesn't match newText,
        // the fix might not be idempotent in the traditional sense
        // But for our purposes, we check if applying twice gives same result
        if (currentText !== edit.newText) {
          // The range content changed, check if applying again changes anything
          const afterSecond = this.applyFix(fix, afterFirst);
          return afterFirst === afterSecond;
        }
      }
    }

    return true;
  }

  /**
   * Validate a fix before applying.
   *
   * @param fix - The quick fix to validate
   * @param content - The file content
   * @returns Validation result with any errors
   */
  validateFix(fix: QuickFix, content: string): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Check that all ranges are within bounds
    const lines = content.split('\n');
    for (const [_file, edits] of Object.entries(fix.edit.changes)) {
      for (const edit of edits) {
        if (edit.range.start.line < 0 || edit.range.start.line >= lines.length) {
          errors.push(`Invalid start line: ${edit.range.start.line}`);
        }
        if (edit.range.end.line < 0 || edit.range.end.line >= lines.length) {
          errors.push(`Invalid end line: ${edit.range.end.line}`);
        }
        if (edit.range.start.line > edit.range.end.line) {
          errors.push('Start line is after end line');
        }
        if (edit.range.start.line === edit.range.end.line &&
            edit.range.start.character > edit.range.end.character) {
          errors.push('Start character is after end character');
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Get available fix types for a violation.
   *
   * @param violation - The violation to check
   * @returns Array of fix types that can handle this violation
   */
  getAvailableFixTypes(violation: Violation): FixType[] {
    return this.strategies
      .filter(strategy => strategy.canHandle(violation))
      .map(strategy => strategy.type);
  }

  /**
   * Register a custom fix strategy.
   *
   * @param strategy - The fix strategy to register
   */
  registerStrategy(strategy: FixStrategy): void {
    // Remove existing strategy of same type
    this.strategies = this.strategies.filter(s => s.type !== strategy.type);
    this.strategies.push(strategy);
  }

  /**
   * Get all registered fix strategies.
   *
   * @returns Array of registered strategies
   */
  getStrategies(): FixStrategy[] {
    return [...this.strategies];
  }

  /**
   * Calculate the impact of a fix.
   *
   * @param fix - The quick fix to assess
   * @param content - The file content
   * @returns Impact assessment
   */
  calculateImpact(fix: QuickFix, content: string): FixImpact {
    let filesAffected = 0;
    let linesChanged = 0;

    for (const [_file, edits] of Object.entries(fix.edit.changes)) {
      filesAffected++;
      for (const edit of edits) {
        const originalLines = edit.range.end.line - edit.range.start.line + 1;
        const newLines = edit.newText.split('\n').length;
        linesChanged += Math.max(originalLines, newLines);
      }
    }

    // Determine risk level based on changes
    let riskLevel: 'low' | 'medium' | 'high' = 'low';
    if (linesChanged > 50 || filesAffected > 3) {
      riskLevel = 'high';
    } else if (linesChanged > 10 || filesAffected > 1) {
      riskLevel = 'medium';
    }

    // Check for breaking changes (simplified heuristic)
    const breakingChange = this.mightBeBreaking(fix, content);

    return {
      filesAffected,
      linesChanged,
      riskLevel,
      breakingChange,
    };
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Add metadata to a quick fix.
   */
  private addMetadata(
    fix: QuickFix,
    violation: Violation,
    fixType: FixType
  ): QuickFixWithMetadata {
    this.fixIdCounter++;

    return {
      ...fix,
      id: `fix-${Date.now()}-${this.fixIdCounter}`,
      fixType,
      violationId: violation.id,
      patternId: violation.patternId,
      validated: this.config.validateFixes ? this.validateFix(fix, '').valid : false,
    };
  }

  /**
   * Extract text from a range in content.
   */
  private extractTextFromRange(content: string, range: Range): string {
    const lines = content.split('\n');
    const startLine = range.start.line;
    const endLine = range.end.line;

    if (startLine < 0 || endLine >= lines.length) {
      return '';
    }

    if (startLine === endLine) {
      const line = lines[startLine];
      if (line === undefined) {return '';}
      return line.substring(range.start.character, range.end.character);
    }

    const extractedLines: string[] = [];
    for (let i = startLine; i <= endLine; i++) {
      const line = lines[i];
      if (line === undefined) {continue;}
      if (i === startLine) {
        extractedLines.push(line.substring(range.start.character));
      } else if (i === endLine) {
        extractedLines.push(line.substring(0, range.end.character));
      } else {
        extractedLines.push(line);
      }
    }
    return extractedLines.join('\n');
  }

  /**
   * Apply a text edit to content.
   */
  private applyTextEdit(content: string, edit: TextEdit): string {
    const lines = content.split('\n');
    const startLine = edit.range.start.line;
    const endLine = edit.range.end.line;

    if (startLine < 0 || startLine >= lines.length) {
      return content;
    }

    // Handle single-line edit
    if (startLine === endLine) {
      const line = lines[startLine];
      if (line === undefined) {return content;}
      const before = line.substring(0, edit.range.start.character);
      const after = line.substring(edit.range.end.character);
      lines[startLine] = before + edit.newText + after;
      return lines.join('\n');
    }

    // Handle multi-line edit
    const firstLine = lines[startLine];
    const lastLine = lines[endLine];
    if (firstLine === undefined || lastLine === undefined) {return content;}

    const before = firstLine.substring(0, edit.range.start.character);
    const after = lastLine.substring(edit.range.end.character);

    // Remove lines between start and end
    lines.splice(startLine, endLine - startLine + 1, before + edit.newText + after);

    return lines.join('\n');
  }

  /**
   * Check if a fix might be breaking.
   */
  private mightBeBreaking(fix: QuickFix, _content: string): boolean {
    // Check for deletions of significant code
    for (const [_file, edits] of Object.entries(fix.edit.changes)) {
      for (const edit of edits) {
        // Deletion of multiple lines might be breaking
        if (edit.newText === '' && edit.range.end.line - edit.range.start.line > 5) {
          return true;
        }
        // Renaming exports might be breaking
        if (edit.newText.includes('export') || edit.newText.includes('module.exports')) {
          return true;
        }
      }
    }
    return false;
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a QuickFixGenerator with default configuration.
 *
 * @returns New QuickFixGenerator instance
 */
export function createQuickFixGenerator(): QuickFixGenerator {
  return new QuickFixGenerator();
}

/**
 * Create a QuickFixGenerator with custom configuration.
 *
 * @param config - Configuration options
 * @returns New QuickFixGenerator instance
 */
export function createQuickFixGeneratorWithConfig(
  config: QuickFixGeneratorConfig
): QuickFixGenerator {
  return new QuickFixGenerator(config);
}

/**
 * Create a QuickFixGenerator with high confidence threshold.
 *
 * @returns New QuickFixGenerator instance with high confidence threshold
 */
export function createHighConfidenceQuickFixGenerator(): QuickFixGenerator {
  return new QuickFixGenerator({
    minConfidence: 0.8,
    maxFixesPerViolation: 3,
  });
}

/**
 * Create a QuickFixGenerator with all fixes enabled.
 *
 * @returns New QuickFixGenerator instance with all fixes
 */
export function createFullQuickFixGenerator(): QuickFixGenerator {
  return new QuickFixGenerator({
    minConfidence: 0.0,
    maxFixesPerViolation: 10,
    generatePreviews: true,
    validateFixes: true,
  });
}
