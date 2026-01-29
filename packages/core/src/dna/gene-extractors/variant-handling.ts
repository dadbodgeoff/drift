/**
 * Variant Handling Gene Extractor
 */

import { BaseGeneExtractor, type AlleleDefinition, type FileExtractionResult, type DetectedAllele } from './base-extractor.js';

import type { GeneId } from '../types.js';

export class VariantHandlingExtractor extends BaseGeneExtractor {
  readonly geneId: GeneId = 'variant-handling';
  readonly geneName = 'Variant Handling';
  readonly geneDescription = 'How component variants are implemented';

  getAlleleDefinitions(): AlleleDefinition[] {
    return [
      { id: 'classname-composition', name: 'className Composition', description: 'Using variant objects', patterns: [/const\s+variants\s*=\s*\{/, /className\s*=\s*\{?\s*variants\[/] },
      { id: 'cva', name: 'CVA', description: 'Class Variance Authority', patterns: [/cva\s*\(/], importPatterns: [/class-variance-authority/] },
      { id: 'conditional-classes', name: 'Conditional Classes', description: 'clsx/cn utilities', patterns: [/clsx\s*\(/, /\bcn\s*\(/] },
      { id: 'styled-variants', name: 'Styled Variants', description: 'styled-components', patterns: [/styled\.\w+`[^`]*\$\{props/] },
      { id: 'data-attributes', name: 'Data Attributes', description: 'data-variant', patterns: [/data-variant\s*=/] },
    ];
  }

  extractFromFile(fp: string, c: string, imp: string[]): FileExtractionResult {
    const det: DetectedAllele[] = [];
    const isComp = this.isComponentFile(fp, c);
    for (const d of this.getAlleleDefinitions()) {
      if (d.importPatterns?.some(p => imp.some(i => p.test(i)))) { det.push({ alleleId: d.id, line: 1, code: '', confidence: 0.9 }); continue; }
      for (const p of d.patterns) { const m = p.exec(c); if (m) { const ctx = this.extractContext(c, m.index); det.push({ alleleId: d.id, line: ctx.line, code: ctx.code, confidence: 0.8, context: ctx.context }); break; } }
    }
    return { file: fp, detectedAlleles: det, isComponent: isComp };
  }
}
