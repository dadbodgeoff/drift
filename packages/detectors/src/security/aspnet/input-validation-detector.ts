/**
 * Input Validation Detector for ASP.NET Core
 *
 * Detects input validation patterns:
 * - DataAnnotations ([Required], [StringLength], etc.)
 * - FluentValidation validators
 * - Custom validation attributes
 * - Model state checking
 */

import type { PatternMatch, Violation, Language } from 'driftdetect-core';
import type { DetectionContext, DetectionResult } from '../../base/base-detector.js';
import { BaseDetector } from '../../base/base-detector.js';

// ============================================================================
// Types
// ============================================================================

export interface InputValidationPatternInfo {
  /** Type of validation pattern */
  type: 'data-annotation' | 'fluent-validation' | 'custom-attribute' | 'model-state' | 'manual-validation';
  /** Validation attribute/method name */
  name: string;
  /** Property being validated */
  property: string | null;
  /** Line number */
  line: number;
  /** File path */
  file: string;
}

export interface InputValidationAnalysis {
  /** All validation patterns found */
  patterns: InputValidationPatternInfo[];
  /** Data annotations used */
  dataAnnotations: string[];
  /** Whether using FluentValidation */
  usesFluentValidation: boolean;
  /** Whether checking ModelState */
  checksModelState: boolean;
  /** Potential issues */
  issues: string[];
  /** Confidence score */
  confidence: number;
}

// ============================================================================
// Constants
// ============================================================================

const DATA_ANNOTATIONS = [
  'Required', 'StringLength', 'MaxLength', 'MinLength', 'Range',
  'RegularExpression', 'EmailAddress', 'Phone', 'Url', 'CreditCard',
  'Compare', 'DataType', 'EnumDataType', 'FileExtensions',
  'CustomValidation', 'Display', 'DisplayFormat',
];

// ============================================================================
// Detector Implementation
// ============================================================================

export class InputValidationDetector extends BaseDetector {
  readonly id = 'security/aspnet-input-validation';
  readonly category = 'security' as const;
  readonly subcategory = 'validation';
  readonly name = 'ASP.NET Input Validation Detector';
  readonly description = 'Detects input validation patterns in ASP.NET Core';
  readonly supportedLanguages: Language[] = ['csharp'];
  readonly detectionMethod = 'regex' as const;

  async detect(context: DetectionContext): Promise<DetectionResult> {
    const { content, file } = context;
    
    if (!this.isRelevantFile(content)) {
      return this.createEmptyResult();
    }

    const analysis = this.analyzeInputValidation(content, file);
    const patterns: PatternMatch[] = [];
    const violations: Violation[] = [];

    for (const pattern of analysis.patterns) {
      patterns.push({
        patternId: `${this.id}/${pattern.type}`,
        location: {
          file: pattern.file,
          line: pattern.line,
          column: 1,
        },
        confidence: analysis.confidence,
        isOutlier: false,
      });
    }

    violations.push(...this.detectViolations(analysis, file));

    return this.createResult(patterns, violations, analysis.confidence, {
      custom: {
        inputValidationAnalysis: analysis,
      },
    });
  }

  private isRelevantFile(content: string): boolean {
    return (
      DATA_ANNOTATIONS.some(attr => content.includes(`[${attr}`)) ||
      content.includes('AbstractValidator') ||
      content.includes('IValidator') ||
      content.includes('ModelState') ||
      content.includes('FluentValidation')
    );
  }

  analyzeInputValidation(content: string, file: string): InputValidationAnalysis {
    const patterns: InputValidationPatternInfo[] = [];
    const dataAnnotations = new Set<string>();
    const issues: string[] = [];
    let usesFluentValidation = false;
    let checksModelState = false;

    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] || '';
      const lineNum = i + 1;

      // Detect DataAnnotations
      for (const annotation of DATA_ANNOTATIONS) {
        const annotationRegex = new RegExp(`\\[${annotation}(?:\\(|\\])`);
        if (annotationRegex.test(line)) {
          dataAnnotations.add(annotation);
          
          // Try to get the property name from the next line
          const nextLine = lines[i + 1] || '';
          const propertyMatch = nextLine.match(/(?:public|private|protected)\s+\w+\??\s+(\w+)/);
          
          patterns.push({
            type: 'data-annotation',
            name: annotation,
            property: propertyMatch?.[1] || null,
            line: lineNum,
            file,
          });
        }
      }

      // Detect FluentValidation
      if (line.includes('AbstractValidator<') || line.includes(': AbstractValidator<')) {
        usesFluentValidation = true;
        const validatorMatch = line.match(/class\s+(\w+)\s*:\s*AbstractValidator<(\w+)>/);
        patterns.push({
          type: 'fluent-validation',
          name: validatorMatch?.[1] || 'Validator',
          property: validatorMatch?.[2] || null,
          line: lineNum,
          file,
        });
      }

      // Detect FluentValidation rules
      if (line.includes('RuleFor(') || line.includes('.NotEmpty()') || line.includes('.NotNull()')) {
        usesFluentValidation = true;
        const ruleMatch = line.match(/RuleFor\s*\(\s*\w+\s*=>\s*\w+\.(\w+)\)/);
        patterns.push({
          type: 'fluent-validation',
          name: 'RuleFor',
          property: ruleMatch?.[1] || null,
          line: lineNum,
          file,
        });
      }

      // Detect ModelState checking
      if (line.includes('ModelState.IsValid') || line.includes('!ModelState.IsValid')) {
        checksModelState = true;
        patterns.push({
          type: 'model-state',
          name: 'ModelState.IsValid',
          property: null,
          line: lineNum,
          file,
        });
      }

      // Detect manual validation
      if (line.includes('string.IsNullOrEmpty') || line.includes('string.IsNullOrWhiteSpace')) {
        patterns.push({
          type: 'manual-validation',
          name: line.includes('IsNullOrWhiteSpace') ? 'IsNullOrWhiteSpace' : 'IsNullOrEmpty',
          property: null,
          line: lineNum,
          file,
        });
      }

      // Detect custom validation attributes
      const customAttrMatch = line.match(/class\s+(\w+Attribute)\s*:\s*ValidationAttribute/);
      if (customAttrMatch) {
        patterns.push({
          type: 'custom-attribute',
          name: customAttrMatch[1] || 'CustomAttribute',
          property: null,
          line: lineNum,
          file,
        });
      }
    }

    // Check for potential issues
    if (file.includes('Controller') && !checksModelState && patterns.length === 0) {
      issues.push('Controller may be missing input validation');
    }

    return {
      patterns,
      dataAnnotations: Array.from(dataAnnotations),
      usesFluentValidation,
      checksModelState,
      issues,
      confidence: patterns.length > 0 ? 0.85 : 0,
    };
  }

  private detectViolations(analysis: InputValidationAnalysis, file: string): Violation[] {
    const violations: Violation[] = [];

    for (const issue of analysis.issues) {
      violations.push({
        id: `${this.id}-${file}-missing-validation`,
        patternId: this.id,
        severity: 'warning',
        file,
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 100 },
        },
        message: issue,
        expected: 'Use DataAnnotations, FluentValidation, or check ModelState.IsValid',
        actual: 'No validation detected',
        explanation: 'Input validation is critical for security. Always validate user input ' +
          'to prevent injection attacks and ensure data integrity.',
        aiExplainAvailable: true,
        aiFixAvailable: true,
        firstSeen: new Date(),
        occurrences: 1,
      });
    }

    return violations;
  }

  generateQuickFix(): null {
    return null;
  }
}

export function createInputValidationDetector(): InputValidationDetector {
  return new InputValidationDetector();
}
