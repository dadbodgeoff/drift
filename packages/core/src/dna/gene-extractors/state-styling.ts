import { BaseGeneExtractor, type AlleleDefinition, type FileExtractionResult, type DetectedAllele } from './base-extractor.js';

import type { GeneId } from '../types.js';

export class StateStylingExtractor extends BaseGeneExtractor {
  readonly geneId: GeneId = 'state-styling';
  readonly geneName = 'State Styling';
  readonly geneDescription = 'How interactive states are styled';

  getAlleleDefinitions(): AlleleDefinition[] {
    return [
      { id: 'tailwind-variants', name: 'Tailwind State Variants', description: 'hover:, focus:, disabled:', patterns: [/className\s*=\s*["'`][^"'`]*\bhover:/, /className\s*=\s*["'`][^"'`]*\bfocus:/] },
      { id: 'css-pseudo', name: 'CSS Pseudo Classes', description: ':hover, :focus', patterns: [/:hover\s*\{/, /:focus\s*\{/] },
      { id: 'state-props', name: 'State Props', description: 'isHovered, isFocused', patterns: [/isHovered\s*[?&|]/, /isFocused\s*[?&|]/] },
      { id: 'data-state', name: 'Data State', description: 'data-state attributes', patterns: [/data-state\s*=/] },
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
