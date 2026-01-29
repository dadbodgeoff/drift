/**
 * Constraint Verifier
 *
 * Verifies code against architectural constraints.
 * Supports all 6 Drift languages with language-specific evaluators.
 */

import * as path from 'node:path';

import type { ConstraintStore } from '../store/constraint-store.js';
import type {
  Constraint,
  ConstraintLanguage,
  VerificationResult,
  SatisfiedConstraint,
  ConstraintViolation,
  SkippedConstraint,
  VerificationMetadata,
} from '../types.js';


// =============================================================================
// Types
// =============================================================================

export interface ConstraintVerifierConfig {
  /** Root directory of the project */
  rootDir: string;
  store: ConstraintStore;
}

export interface VerifyOptions {
  /** Only verify constraints of these categories */
  categories?: string[];
  /** Only verify constraints with these statuses */
  statuses?: ('approved' | 'discovered')[];
  /** Minimum confidence to verify */
  minConfidence?: number;
  /** Include fix suggestions */
  includeFixes?: boolean;
  /** Include code examples */
  includeExamples?: boolean;
}

export interface FileContext {
  filePath: string;
  content: string;
  language: ConstraintLanguage;
  ast?: any;
}

// =============================================================================
// Constraint Verifier
// =============================================================================

export class ConstraintVerifier {
  private readonly store: ConstraintStore;

  constructor(config: ConstraintVerifierConfig) {
    this.store = config.store;
  }


  /**
   * Verify a file against all applicable constraints
   */
  async verifyFile(
    filePath: string,
    content: string,
    options: VerifyOptions = {}
  ): Promise<VerificationResult> {
    const startTime = Date.now();
    const language = this.detectLanguage(filePath);

    // Get applicable constraints
    const constraints = this.getApplicableConstraints(filePath, language, options);

    const satisfied: SatisfiedConstraint[] = [];
    const violations: ConstraintViolation[] = [];
    const skipped: SkippedConstraint[] = [];

    // Create file context
    const context: FileContext = {
      filePath,
      content,
      language,
    };

    // Verify each constraint
    for (const constraint of constraints) {
      try {
        const result = await this.verifyConstraint(constraint, context, options);

        if (result.satisfied) {
          satisfied.push({
            constraintId: constraint.id,
            constraintName: constraint.name,
            category: constraint.category,
          });
        } else if (result.violations) {
          violations.push(...result.violations);
        }
      } catch (error) {
        skipped.push({
          constraintId: constraint.id,
          constraintName: constraint.name,
          reason: `Verification error: ${(error as Error).message}`,
        });
      }
    }

    const metadata: VerificationMetadata = {
      file: filePath,
      language,
      constraintsChecked: constraints.length,
      executionTimeMs: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };

    return {
      passed: violations.length === 0,
      summary: this.buildSummary(satisfied, violations, skipped),
      satisfied,
      violations,
      skipped,
      metadata,
    };
  }

  /**
   * Verify a diff/change against constraints
   */
  async verifyChange(
    filePath: string,
    oldContent: string,
    newContent: string,
    options: VerifyOptions = {}
  ): Promise<VerificationResult> {
    // Verify the new content
    const result = await this.verifyFile(filePath, newContent, options);

    // Filter to only violations in changed lines
    const changedLines = this.getChangedLines(oldContent, newContent);
    result.violations = result.violations.filter(v =>
      changedLines.has(v.location.line)
    );

    // Update summary
    result.passed = result.violations.length === 0;
    result.summary = this.buildSummary(
      result.satisfied,
      result.violations,
      result.skipped
    );

    return result;
  }

  /**
   * Get constraints applicable to a file
   */
  private getApplicableConstraints(
    filePath: string,
    language: ConstraintLanguage,
    options: VerifyOptions
  ): Constraint[] {
    let constraints = this.store.getForFile(filePath);

    // Filter by language
    constraints = constraints.filter(c =>
      c.language === 'all' || c.language === language
    );

    // Filter by status
    const statuses = options.statuses ?? ['approved'];
    constraints = constraints.filter(c => statuses.includes(c.status as any));

    // Filter by category
    if (options.categories?.length) {
      constraints = constraints.filter(c =>
        options.categories!.includes(c.category)
      );
    }

    // Filter by confidence
    if (options.minConfidence !== undefined) {
      constraints = constraints.filter(c =>
        c.confidence.score >= options.minConfidence!
      );
    }

    return constraints;
  }

  /**
   * Verify a single constraint against file context
   */
  private async verifyConstraint(
    constraint: Constraint,
    context: FileContext,
    options: VerifyOptions
  ): Promise<{ satisfied: boolean; violations?: ConstraintViolation[] }> {
    const predicate = constraint.invariant.predicate;
    const violations: ConstraintViolation[] = [];

    // Check function predicates
    if (predicate.functionMustHave) {
      const funcViolations = this.verifyFunctionPredicate(
        constraint,
        context,
        predicate.functionMustHave,
        options
      );
      violations.push(...funcViolations);
    }

    // Check class predicates
    if (predicate.classMustHave) {
      const classViolations = this.verifyClassPredicate(
        constraint,
        context,
        predicate.classMustHave,
        options
      );
      violations.push(...classViolations);
    }

    // Check entry point predicates
    if (predicate.entryPointMustHave) {
      const entryViolations = this.verifyEntryPointPredicate(
        constraint,
        context,
        predicate.entryPointMustHave,
        options
      );
      violations.push(...entryViolations);
    }

    // Check naming predicates
    if (predicate.naming) {
      const namingViolations = this.verifyNamingPredicate(
        constraint,
        context,
        predicate.naming,
        options
      );
      violations.push(...namingViolations);
    }

    // Check file structure predicates
    if (predicate.fileStructure) {
      const structureViolations = this.verifyFileStructurePredicate(
        constraint,
        context,
        predicate.fileStructure,
        options
      );
      violations.push(...structureViolations);
    }

    return {
      satisfied: violations.length === 0,
      violations: violations.length > 0 ? violations : [],
    };
  }


  /**
   * Verify function predicate
   */
  private verifyFunctionPredicate(
    constraint: Constraint,
    context: FileContext,
    predicate: NonNullable<Constraint['invariant']['predicate']['functionMustHave']>,
    options: VerifyOptions
  ): ConstraintViolation[] {
    const violations: ConstraintViolation[] = [];
    const functions = this.extractFunctions(context);

    for (const func of functions) {
      const funcViolations: string[] = [];

      // Check decorators
      if (predicate.decorator?.length) {
        const hasDecorator = predicate.decorator.some(d =>
          func.decorators?.some(fd => fd.includes(d))
        );
        if (!hasDecorator) {
          funcViolations.push(
            `Missing required decorator: ${predicate.decorator.join(' or ')}`
          );
        }
      }

      // Check error handling
      if (predicate.errorHandling && !func.hasErrorHandling) {
        funcViolations.push('Missing error handling (try-catch)');
      }

      // Check async requirement
      if (predicate.isAsync !== undefined && func.isAsync !== predicate.isAsync) {
        funcViolations.push(
          predicate.isAsync ? 'Function must be async' : 'Function must not be async'
        );
      }

      // Check body contains
      if (predicate.bodyContains?.length) {
        for (const required of predicate.bodyContains) {
          if (!func.body?.includes(required)) {
            funcViolations.push(`Function body must contain: ${required}`);
          }
        }
      }

      // Check body must not contain
      if (predicate.bodyMustNotContain?.length) {
        for (const forbidden of predicate.bodyMustNotContain) {
          if (func.body?.includes(forbidden)) {
            funcViolations.push(`Function body must not contain: ${forbidden}`);
          }
        }
      }

      // Create violations
      for (const message of funcViolations) {
        violations.push(this.createViolation(
          constraint,
          message,
          { file: context.filePath, line: func.line, column: 0 },
          options
        ));
      }
    }

    return violations;
  }

  /**
   * Verify class predicate
   */
  private verifyClassPredicate(
    constraint: Constraint,
    context: FileContext,
    predicate: NonNullable<Constraint['invariant']['predicate']['classMustHave']>,
    options: VerifyOptions
  ): ConstraintViolation[] {
    const violations: ConstraintViolation[] = [];
    const classes = this.extractClasses(context);

    for (const cls of classes) {
      const classViolations: string[] = [];

      // Check decorators/annotations/attributes
      if (predicate.decorator?.length) {
        const hasDecorator = predicate.decorator.some(d =>
          cls.decorators?.some(cd => cd.includes(d))
        );
        if (!hasDecorator) {
          classViolations.push(
            `Missing required decorator: ${predicate.decorator.join(' or ')}`
          );
        }
      }

      // Check implements
      if (predicate.implements?.length) {
        const hasInterface = predicate.implements.some(i =>
          cls.implements?.includes(i)
        );
        if (!hasInterface) {
          classViolations.push(
            `Must implement: ${predicate.implements.join(' or ')}`
          );
        }
      }

      // Check extends
      if (predicate.extends?.length) {
        const hasExtends = predicate.extends.some(e =>
          cls.extends === e
        );
        if (!hasExtends) {
          classViolations.push(
            `Must extend: ${predicate.extends.join(' or ')}`
          );
        }
      }

      // Create violations
      for (const message of classViolations) {
        violations.push(this.createViolation(
          constraint,
          message,
          { file: context.filePath, line: cls.line, column: 0 },
          options
        ));
      }
    }

    return violations;
  }

  /**
   * Verify entry point predicate
   */
  private verifyEntryPointPredicate(
    constraint: Constraint,
    context: FileContext,
    predicate: NonNullable<Constraint['invariant']['predicate']['entryPointMustHave']>,
    options: VerifyOptions
  ): ConstraintViolation[] {
    const violations: ConstraintViolation[] = [];
    const entryPoints = this.extractEntryPoints(context);

    for (const entry of entryPoints) {
      const entryViolations: string[] = [];

      // Check middleware
      if (predicate.middleware?.length) {
        const hasMiddleware = predicate.middleware.some(m =>
          entry.middleware?.some(em => em.includes(m))
        );
        if (!hasMiddleware) {
          entryViolations.push(
            `Missing required middleware: ${predicate.middleware.join(' or ')}`
          );
        }
      }

      // Check decorators
      if (predicate.decorator?.length) {
        const hasDecorator = predicate.decorator.some(d =>
          entry.decorators?.some(ed => ed.includes(d))
        );
        if (!hasDecorator) {
          entryViolations.push(
            `Missing required decorator: ${predicate.decorator.join(' or ')}`
          );
        }
      }

      // Create violations
      for (const message of entryViolations) {
        violations.push(this.createViolation(
          constraint,
          message,
          { file: context.filePath, line: entry.line, column: 0 },
          options
        ));
      }
    }

    return violations;
  }

  /**
   * Verify naming predicate
   */
  private verifyNamingPredicate(
    constraint: Constraint,
    context: FileContext,
    predicate: NonNullable<Constraint['invariant']['predicate']['naming']>,
    options: VerifyOptions
  ): ConstraintViolation[] {
    const violations: ConstraintViolation[] = [];
    const regex = new RegExp(predicate.pattern);

    // Get items to check based on scope
    let items: Array<{ name: string; line: number }> = [];

    switch (predicate.scope) {
      case 'file':
        items = [{ name: path.basename(context.filePath), line: 1 }];
        break;
      case 'function':
        items = this.extractFunctions(context).map(f => ({ name: f.name, line: f.line }));
        break;
      case 'class':
        items = this.extractClasses(context).map(c => ({ name: c.name, line: c.line }));
        break;
    }

    for (const item of items) {
      let valid = regex.test(item.name);

      // Check prefix
      if (valid && predicate.prefix && !item.name.startsWith(predicate.prefix)) {
        valid = false;
      }

      // Check suffix
      if (valid && predicate.suffix && !item.name.endsWith(predicate.suffix)) {
        valid = false;
      }

      if (!valid) {
        violations.push(this.createViolation(
          constraint,
          `Name "${item.name}" does not match pattern: ${predicate.pattern}`,
          { file: context.filePath, line: item.line, column: 0 },
          options
        ));
      }
    }

    return violations;
  }

  /**
   * Verify file structure predicate
   */
  private verifyFileStructurePredicate(
    constraint: Constraint,
    context: FileContext,
    predicate: NonNullable<Constraint['invariant']['predicate']['fileStructure']>,
    options: VerifyOptions
  ): ConstraintViolation[] {
    const violations: ConstraintViolation[] = [];

    // Check must import
    if (predicate.mustImport?.length) {
      const imports = this.extractImports(context);
      for (const required of predicate.mustImport) {
        if (!imports.some(i => i.includes(required))) {
          violations.push(this.createViolation(
            constraint,
            `Missing required import: ${required}`,
            { file: context.filePath, line: 1, column: 0 },
            options
          ));
        }
      }
    }

    // Check must not import
    if (predicate.mustNotImport?.length) {
      const imports = this.extractImports(context);
      for (const forbidden of predicate.mustNotImport) {
        const found = imports.find(i => i.includes(forbidden));
        if (found) {
          violations.push(this.createViolation(
            constraint,
            `Forbidden import found: ${forbidden}`,
            { file: context.filePath, line: 1, column: 0 },
            options
          ));
        }
      }
    }

    // Check max lines
    if (predicate.maxLines) {
      const lineCount = context.content.split('\n').length;
      if (lineCount > predicate.maxLines) {
        violations.push(this.createViolation(
          constraint,
          `File exceeds maximum lines (${lineCount} > ${predicate.maxLines})`,
          { file: context.filePath, line: 1, column: 0 },
          options
        ));
      }
    }

    return violations;
  }


  // ===========================================================================
  // Helper Methods
  // ===========================================================================

  /**
   * Create a violation object
   */
  private createViolation(
    constraint: Constraint,
    message: string,
    location: { file: string; line: number; column: number },
    options: VerifyOptions
  ): ConstraintViolation {
    const violation: ConstraintViolation = {
      constraintId: constraint.id,
      constraintName: constraint.name,
      category: constraint.category,
      severity: constraint.enforcement.level,
      message,
      location: {
        ...location,
        snippet: this.getSnippet(location.file, location.line),
      },
      guidance: constraint.enforcement.guidance,
    };

    // Add fix if available and requested
    if (options.includeFixes && constraint.enforcement.autoFix) {
      violation.fix = {
        type: constraint.enforcement.autoFix.type,
        suggestion: constraint.enforcement.autoFix.template,
        confidence: constraint.enforcement.autoFix.confidence,
      };
    }

    // Add example if available and requested
    if (options.includeExamples && constraint.enforcement.example) {
      violation.example = constraint.enforcement.example;
    }

    return violation;
  }

  /**
   * Detect language from file path
   */
  private detectLanguage(filePath: string): ConstraintLanguage {
    const ext = path.extname(filePath).toLowerCase();

    switch (ext) {
      case '.ts':
      case '.tsx':
        return 'typescript';
      case '.js':
      case '.jsx':
      case '.mjs':
      case '.cjs':
        return 'javascript';
      case '.py':
        return 'python';
      case '.java':
        return 'java';
      case '.cs':
        return 'csharp';
      case '.php':
        return 'php';
      default:
        return 'all';
    }
  }

  /**
   * Get changed lines between old and new content
   */
  private getChangedLines(oldContent: string, newContent: string): Set<number> {
    const oldLines = oldContent.split('\n');
    const newLines = newContent.split('\n');
    const changed = new Set<number>();

    // Simple line-by-line comparison
    const maxLines = Math.max(oldLines.length, newLines.length);
    for (let i = 0; i < maxLines; i++) {
      if (oldLines[i] !== newLines[i]) {
        changed.add(i + 1); // 1-indexed
      }
    }

    return changed;
  }

  /**
   * Build summary message
   */
  private buildSummary(
    satisfied: SatisfiedConstraint[],
    violations: ConstraintViolation[],
    skipped: SkippedConstraint[]
  ): string {
    const parts: string[] = [];

    if (violations.length === 0) {
      parts.push('All constraints satisfied');
    } else {
      const errors = violations.filter(v => v.severity === 'error').length;
      const warnings = violations.filter(v => v.severity === 'warning').length;

      if (errors > 0) {parts.push(`${errors} error(s)`);}
      if (warnings > 0) {parts.push(`${warnings} warning(s)`);}
    }

    parts.push(`${satisfied.length} passed`);

    if (skipped.length > 0) {
      parts.push(`${skipped.length} skipped`);
    }

    return parts.join(', ');
  }

  /**
   * Get code snippet around a line
   */
  private getSnippet(_filePath: string, _line: number): string {
    // This would need file content - simplified for now
    return '';
  }

  // ===========================================================================
  // Language-Specific Extraction (Simplified regex-based)
  // ===========================================================================

  private extractFunctions(context: FileContext): Array<{
    name: string;
    line: number;
    decorators?: string[];
    isAsync?: boolean;
    hasErrorHandling?: boolean;
    body?: string;
  }> {
    const functions: Array<{
      name: string;
      line: number;
      decorators?: string[];
      isAsync?: boolean;
      hasErrorHandling?: boolean;
      body?: string;
    }> = [];

    const lines = context.content.split('\n');

    // Language-specific patterns
    const patterns = this.getFunctionPatterns(context.language);

    for (let i = 0; i < lines.length; i++) {
      const currentLine = lines[i];
      if (!currentLine) {continue;}

      for (const pattern of patterns) {
        const match = currentLine.match(pattern.regex);
        if (match?.[1]) {
          // Look for decorators above
          const decorators: string[] = [];
          for (let j = i - 1; j >= 0 && j >= i - 5; j--) {
            const prevLine = lines[j];
            if (!prevLine) {continue;}
            const decoratorMatch = prevLine.match(pattern.decoratorRegex);
            if (decoratorMatch?.[1]) {
              decorators.push(decoratorMatch[1]);
            } else if (prevLine.trim() && !prevLine.trim().startsWith('//')) {
              break;
            }
          }

          const funcEntry: {
            name: string;
            line: number;
            decorators?: string[];
            isAsync?: boolean;
            hasErrorHandling?: boolean;
            body?: string;
          } = {
            name: match[1],
            line: i + 1,
            isAsync: currentLine.includes('async '),
            hasErrorHandling: this.hasErrorHandling(lines, i, context.language),
          };
          if (decorators.length > 0) {
            funcEntry.decorators = decorators;
          }
          functions.push(funcEntry);
        }
      }
    }

    return functions;
  }

  private extractClasses(context: FileContext): Array<{
    name: string;
    line: number;
    decorators?: string[];
    implements?: string[];
    extends?: string;
  }> {
    const classes: Array<{
      name: string;
      line: number;
      decorators?: string[];
      implements?: string[];
      extends?: string;
    }> = [];

    const lines = context.content.split('\n');
    const patterns = this.getClassPatterns(context.language);

    for (let i = 0; i < lines.length; i++) {
      const currentLine = lines[i];
      if (!currentLine) {continue;}

      for (const pattern of patterns) {
        const match = currentLine.match(pattern.regex);
        if (match?.[1]) {
          const classEntry: {
            name: string;
            line: number;
            decorators?: string[];
            implements?: string[];
            extends?: string;
          } = {
            name: match[1],
            line: i + 1,
          };
          if (match[2]) {
            classEntry.extends = match[2];
          }
          if (match[3]) {
            classEntry.implements = match[3].split(',').map(s => s.trim());
          }
          classes.push(classEntry);
        }
      }
    }

    return classes;
  }

  private extractEntryPoints(context: FileContext): Array<{
    name: string;
    line: number;
    decorators?: string[];
    middleware?: string[];
  }> {
    // Entry points are functions with route decorators/annotations
    const functions = this.extractFunctions(context);

    return functions.filter(f =>
      f.decorators?.some(d =>
        /Get|Post|Put|Delete|Patch|Route|RequestMapping|app\.(get|post|put|delete)/i.test(d)
      )
    ).map(f => {
      const entry: {
        name: string;
        line: number;
        decorators?: string[];
        middleware?: string[];
      } = {
        name: f.name,
        line: f.line,
      };
      if (f.decorators) {
        entry.decorators = f.decorators;
      }
      return entry;
    });
  }

  private extractImports(context: FileContext): string[] {
    const imports: string[] = [];
    const lines = context.content.split('\n');

    for (const line of lines) {
      if (!line) {continue;}
      
      // TypeScript/JavaScript
      const tsMatch = line.match(/import\s+.*from\s+['"]([^'"]+)['"]/);
      if (tsMatch?.[1]) {imports.push(tsMatch[1]);}

      // Python
      const pyMatch = line.match(/(?:from\s+(\S+)\s+)?import\s+(\S+)/);
      if (pyMatch) {
        const importPath = pyMatch[1] ?? pyMatch[2];
        if (importPath) {imports.push(importPath);}
      }

      // Java
      const javaMatch = line.match(/import\s+(?:static\s+)?([^;]+);/);
      if (javaMatch?.[1]) {imports.push(javaMatch[1]);}

      // C#
      const csMatch = line.match(/using\s+(?:static\s+)?([^;]+);/);
      if (csMatch?.[1]) {imports.push(csMatch[1]);}

      // PHP
      const phpMatch = line.match(/use\s+([^;]+);/);
      if (phpMatch?.[1]) {imports.push(phpMatch[1]);}
    }

    return imports;
  }

  private getFunctionPatterns(language: ConstraintLanguage): Array<{
    regex: RegExp;
    decoratorRegex: RegExp;
  }> {
    switch (language) {
      case 'typescript':
      case 'javascript':
        return [{
          regex: /(?:async\s+)?(?:function\s+)?(\w+)\s*\([^)]*\)\s*[:{]/,
          decoratorRegex: /@(\w+)/,
        }];
      case 'python':
        return [{
          regex: /def\s+(\w+)\s*\(/,
          decoratorRegex: /@(\w+)/,
        }];
      case 'java':
        return [{
          regex: /(?:public|private|protected)?\s*(?:static\s+)?(?:\w+\s+)?(\w+)\s*\([^)]*\)\s*(?:throws\s+\w+)?\s*\{/,
          decoratorRegex: /@(\w+)/,
        }];
      case 'csharp':
        return [{
          regex: /(?:public|private|protected|internal)?\s*(?:static\s+)?(?:async\s+)?(?:\w+\s+)?(\w+)\s*\([^)]*\)\s*\{/,
          decoratorRegex: /\[(\w+)/,
        }];
      case 'php':
        return [{
          regex: /(?:public|private|protected)?\s*(?:static\s+)?function\s+(\w+)\s*\(/,
          decoratorRegex: /#\[(\w+)/,
        }];
      default:
        return [];
    }
  }

  private getClassPatterns(language: ConstraintLanguage): Array<{
    regex: RegExp;
  }> {
    switch (language) {
      case 'typescript':
      case 'javascript':
        return [{
          regex: /class\s+(\w+)(?:\s+extends\s+(\w+))?(?:\s+implements\s+([^{]+))?\s*\{/,
        }];
      case 'python':
        return [{
          regex: /class\s+(\w+)(?:\(([^)]+)\))?\s*:/,
        }];
      case 'java':
      case 'csharp':
        return [{
          regex: /class\s+(\w+)(?:\s+extends\s+(\w+))?(?:\s+implements\s+([^{]+))?\s*\{/,
        }];
      case 'php':
        return [{
          regex: /class\s+(\w+)(?:\s+extends\s+(\w+))?(?:\s+implements\s+([^{]+))?\s*\{/,
        }];
      default:
        return [];
    }
  }

  private hasErrorHandling(lines: string[], startLine: number, language: ConstraintLanguage): boolean {
    // Look for try-catch in the function body
    let braceCount = 0;
    let started = false;

    for (let i = startLine; i < lines.length; i++) {
      const currentLine = lines[i];
      if (!currentLine) {continue;}

      // Count braces
      for (const char of currentLine) {
        if (char === '{') {
          braceCount++;
          started = true;
        } else if (char === '}') {
          braceCount--;
        }
      }

      // Check for error handling
      if (language === 'python') {
        if (/\btry\s*:/.test(currentLine)) {return true;}
      } else {
        if (/\btry\s*\{/.test(currentLine)) {return true;}
      }

      // End of function
      if (started && braceCount === 0) {break;}
    }

    return false;
  }
}

// =============================================================================
// Factory
// =============================================================================

export function createConstraintVerifier(
  config: ConstraintVerifierConfig
): ConstraintVerifier {
  return new ConstraintVerifier(config);
}
