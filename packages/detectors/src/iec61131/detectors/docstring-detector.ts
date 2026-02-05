/**
 * ST Docstring Detector
 * 
 * Single responsibility: Detect documentation patterns and violations
 */

import { RegexDetector } from '../../base/regex-detector.js';
import { extractDocstrings } from '../extractors/docstring-extractor.js';

import type { DetectionContext, DetectionResult } from '../../base/base-detector.js';
import type { PatternCategory, Language, Violation, QuickFix, PatternMatch } from 'driftdetect-core';
import type { STDocstring } from '../types.js';

export class STDocstringDetector extends RegexDetector {
  readonly id = 'iec61131/docstrings';
  readonly name = 'IEC 61131-3 Docstring Detector';
  readonly description = 'Detects documentation patterns in Structured Text';
  readonly category: PatternCategory = 'documentation';
  readonly subcategory = 'docstrings';
  readonly supportedLanguages: Language[] = ['structured-text' as Language];

  async detect(context: DetectionContext): Promise<DetectionResult> {
    if (!this.supportsLanguage(context.language)) {
      return this.createEmptyResult();
    }

    const docstrings = extractDocstrings(context.content);
    const patterns: PatternMatch[] = [];
    const violations: Violation[] = [];

    for (const doc of docstrings) {
      // Create pattern for each docstring
      patterns.push(this.createPatternMatch(doc, context.file));

      // Check for violations
      this.checkViolations(doc, context.file, violations);
    }

    // Check for undocumented blocks
    this.checkUndocumentedBlocks(context.content, docstrings, context.file, violations);

    return this.createResult(patterns, violations, 0.9, {
      custom: {
        docstringCount: docstrings.length,
        withParams: docstrings.filter(d => d.params.length > 0).length,
        withHistory: docstrings.filter(d => d.history.length > 0).length,
        withWarnings: docstrings.filter(d => d.warnings.length > 0).length,
      },
    });
  }

  generateQuickFix(_violation: Violation): QuickFix | null {
    // QuickFix generation requires proper WorkspaceEdit structure
    // For now, return null - can be enhanced later
    return null;
  }

  private createPatternMatch(doc: STDocstring, file: string): PatternMatch {
    return {
      patternId: `${this.id}/${doc.associatedBlock || 'standalone'}`,
      location: {
        file,
        line: doc.line,
        column: 1,
      },
      confidence: 0.95,
      isOutlier: false,
    };
  }

  private checkViolations(doc: STDocstring, file: string, violations: Violation[]): void {
    // Check for empty summary
    if (!doc.summary && doc.associatedBlock) {
      violations.push(this.convertViolationInfo({
        type: 'empty-summary',
        file,
        line: doc.line,
        column: 1,
        issue: `Docstring for '${doc.associatedBlock}' has no summary`,
        severity: 'warning',
      }));
    }

    // Check for params without descriptions
    for (const param of doc.params) {
      if (!param.description) {
        violations.push(this.convertViolationInfo({
          type: 'param-no-description',
          file,
          line: doc.line,
          column: 1,
          issue: `Parameter '${param.name}' has no description`,
          severity: 'info',
        }));
      }
    }
  }

  private checkUndocumentedBlocks(
    content: string,
    docstrings: STDocstring[],
    file: string,
    violations: Violation[]
  ): void {
    const documentedBlocks = new Set(
      docstrings.map(d => d.associatedBlock).filter(Boolean)
    );

    // Find all blocks
    const blockPattern = /^(FUNCTION_BLOCK|PROGRAM|FUNCTION)\s+(\w+)/gim;
    let match;

    while ((match = blockPattern.exec(content)) !== null) {
      const blockName = match[2]!;
      if (!documentedBlocks.has(blockName)) {
        const line = content.slice(0, match.index).split('\n').length;
        violations.push(this.convertViolationInfo({
          type: 'undocumented-block',
          file,
          line,
          column: 1,
          value: blockName,
          issue: `${match[1]} '${blockName}' lacks documentation`,
          suggestedFix: 'Add (* ... *) docstring before block definition',
          severity: 'warning',
        }));
      }
    }
  }
}
