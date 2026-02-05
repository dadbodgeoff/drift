/**
 * Safety Interlock Detector
 * 
 * Single responsibility: Detect safety patterns and violations
 */

import { RegexDetector } from '../../base/regex-detector.js';
import { extractSafetyInterlocks } from '../extractors/safety-extractor.js';

import type { DetectionContext, DetectionResult } from '../../base/base-detector.js';
import type { PatternCategory, Language, Violation, QuickFix, PatternMatch } from 'driftdetect-core';

export class SafetyInterlockDetector extends RegexDetector {
  readonly id = 'iec61131/safety-interlocks';
  readonly name = 'IEC 61131-3 Safety Interlock Detector';
  readonly description = 'Detects safety interlock patterns and bypass violations';
  readonly category: PatternCategory = 'security';
  readonly subcategory = 'safety-interlocks';
  readonly supportedLanguages: Language[] = ['structured-text' as Language];

  async detect(context: DetectionContext): Promise<DetectionResult> {
    if (!this.supportsLanguage(context.language)) {
      return this.createEmptyResult();
    }

    const interlocks = extractSafetyInterlocks(context.content);
    const patterns: PatternMatch[] = [];
    const violations: Violation[] = [];

    for (const interlock of interlocks) {
      // Create pattern
      patterns.push({
        patternId: `${this.id}/${interlock.type}`,
        location: {
          file: context.file,
          line: interlock.line,
          column: 1,
        },
        confidence: 0.95,
        isOutlier: interlock.isBypassed || interlock.type === 'bypass',
      });

      // Create violations for bypasses
      if (interlock.type === 'bypass') {
        violations.push(this.convertViolationInfo({
          type: 'safety-bypass',
          file: context.file,
          line: interlock.line,
          column: 1,
          value: interlock.name,
          issue: `Safety bypass variable detected: ${interlock.name}`,
          severity: 'error',
        }));
      } else if (interlock.isBypassed) {
        violations.push(this.convertViolationInfo({
          type: 'bypassed-interlock',
          file: context.file,
          line: interlock.line,
          column: 1,
          value: interlock.name,
          issue: `Interlock '${interlock.name}' may be bypassed`,
          severity: 'warning',
        }));
      }
    }

    // Group by type
    const byType: Record<string, number> = {};
    for (const il of interlocks) {
      byType[il.type] = (byType[il.type] || 0) + 1;
    }

    return this.createResult(patterns, violations, 0.95, {
      custom: {
        totalInterlocks: interlocks.length,
        bypassCount: interlocks.filter(i => i.type === 'bypass').length,
        bypassedCount: interlocks.filter(i => i.isBypassed).length,
        byType,
      },
    });
  }

  generateQuickFix(_violation: Violation): QuickFix | null {
    // QuickFix generation requires proper WorkspaceEdit structure
    return null;
  }
}
