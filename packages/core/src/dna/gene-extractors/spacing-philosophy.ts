import { BaseGeneExtractor, type AlleleDefinition, type FileExtractionResult, type DetectedAllele } from './base-extractor.js';

import type { GeneId } from '../types.js';

export class SpacingPhilosophyExtractor extends BaseGeneExtractor {
  readonly geneId: GeneId = 'spacing-philosophy';
  readonly geneName = 'Spacing Philosophy';
  readonly geneDescription = 'How spacing is managed';

  getAlleleDefinitions(): AlleleDefinition[] {
    return [
      { id: 'tailwind-scale', name: 'Tailwind Scale', description: 'p-4, m-2, gap-6', patterns: [/className\s*=\s*["'`][^"'`]*\b[pm][trblxy]?-\d+/, /className\s*=\s*["'`][^"'`]*\bgap-\d+/] },
      { id: 'tailwind-arbitrary', name: 'Tailwind Arbitrary', description: 'p-[13px]', patterns: [/className\s*=\s*["'`][^"'`]*\b[pm][trblxy]?-\[\d+/] },
      { id: 'design-tokens', name: 'Design Tokens', description: 'var(--spacing-*)', patterns: [/var\s*\(\s*--spacing/] },
      { id: 'hardcoded', name: 'Hardcoded', description: 'padding: 16px', patterns: [/padding\s*:\s*\d+px/, /margin\s*:\s*\d+px/] },
      { id: 'spacing-components', name: 'Spacing Components', description: 'Stack, Box', patterns: [/<Stack\s+spacing/, /<Box\s+[pm]=/] },
    ];
  }

  extractFromFile(fp: string, c: string, _imp: string[]): FileExtractionResult {
    const det: DetectedAllele[] = [];
    for (const d of this.getAlleleDefinitions()) {
      for (const p of d.patterns) { const m = p.exec(c); if (m) { const ctx = this.extractContext(c, m.index); det.push({ alleleId: d.id, line: ctx.line, code: ctx.code, confidence: 0.8, context: ctx.context }); break; } }
    }
    return { file: fp, detectedAlleles: det, isComponent: this.isComponentFile(fp, c) };
  }
}
