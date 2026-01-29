import { BaseGeneExtractor, type AlleleDefinition, type FileExtractionResult, type DetectedAllele } from './base-extractor.js';

import type { GeneId } from '../types.js';

export class ResponsiveApproachExtractor extends BaseGeneExtractor {
  readonly geneId: GeneId = 'responsive-approach';
  readonly geneName = 'Responsive Approach';
  readonly geneDescription = 'How responsive design is handled';

  getAlleleDefinitions(): AlleleDefinition[] {
    return [
      { id: 'tailwind-mobile-first', name: 'Tailwind Mobile-First', description: 'sm:, md:, lg: breakpoints', patterns: [/className\s*=\s*["'`][^"'`]*\b(sm|md|lg|xl):/] },
      { id: 'tailwind-desktop-first', name: 'Tailwind Desktop-First', description: 'max-* variants', patterns: [/className\s*=\s*["'`][^"'`]*\bmax-(sm|md|lg):/] },
      { id: 'css-media-queries', name: 'CSS Media Queries', description: '@media queries', patterns: [/@media\s*\([^)]*width/] },
      { id: 'container-queries', name: 'Container Queries', description: '@container', patterns: [/@container/] },
      { id: 'js-responsive', name: 'JS Responsive', description: 'useMediaQuery hooks', patterns: [/useMediaQuery\s*\(/, /useBreakpoint\s*\(/] },
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
