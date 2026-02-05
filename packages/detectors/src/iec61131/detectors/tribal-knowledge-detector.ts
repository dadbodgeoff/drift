/**
 * Tribal Knowledge Detector
 * 
 * Single responsibility: Detect and surface institutional knowledge
 */

import { RegexDetector } from '../../base/regex-detector.js';
import { extractTribalKnowledge } from '../extractors/tribal-knowledge-extractor.js';

import type { DetectionContext, DetectionResult } from '../../base/base-detector.js';
import type { PatternCategory, Language, Violation, QuickFix, PatternMatch } from 'driftdetect-core';

export class TribalKnowledgeDetector extends RegexDetector {
  readonly id = 'iec61131/tribal-knowledge';
  readonly name = 'IEC 61131-3 Tribal Knowledge Detector';
  readonly description = 'Extracts institutional knowledge from legacy PLC code';
  readonly category: PatternCategory = 'documentation';
  readonly subcategory = 'tribal-knowledge';
  readonly supportedLanguages: Language[] = ['structured-text' as Language];

  async detect(context: DetectionContext): Promise<DetectionResult> {
    if (!this.supportsLanguage(context.language)) {
      return this.createEmptyResult();
    }

    const knowledge = extractTribalKnowledge(context.content, context.file);
    const patterns: PatternMatch[] = [];

    // Group by type for summary
    const byType: Record<string, number> = {};

    for (const item of knowledge) {
      byType[item.type] = (byType[item.type] || 0) + 1;

      patterns.push({
        patternId: `${this.id}/${item.type}`,
        location: {
          file: context.file,
          line: item.line,
          column: 1,
        },
        confidence: 0.8,
        isOutlier: false,
      });
    }

    return this.createResult(patterns, [], 0.85, {
      custom: {
        totalItems: knowledge.length,
        byType,
        items: knowledge,
      },
    });
  }

  generateQuickFix(_violation: Violation): QuickFix | null {
    return null;
  }
}
