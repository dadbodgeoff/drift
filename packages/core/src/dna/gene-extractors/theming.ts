import { BaseGeneExtractor, type AlleleDefinition, type FileExtractionResult, type DetectedAllele } from './base-extractor.js';

import type { GeneId } from '../types.js';

export class ThemingExtractor extends BaseGeneExtractor {
  readonly geneId: GeneId = 'theming';
  readonly geneName = 'Theming';
  readonly geneDescription = 'How theming/dark mode is implemented';

  getAlleleDefinitions(): AlleleDefinition[] {
    return [
      { id: 'tailwind-dark', name: 'Tailwind Dark Mode', description: 'dark: prefix', patterns: [/className\s*=\s*["'`][^"'`]*\bdark:/] },
      { id: 'css-variables', name: 'CSS Variables', description: 'var(--*)', patterns: [/var\s*\(\s*--/] },
      { id: 'theme-context', name: 'Theme Context', description: 'useTheme/ThemeProvider', patterns: [/useTheme\s*\(/, /ThemeProvider/] },
      { id: 'styled-theming', name: 'Styled Theming', description: 'props.theme', patterns: [/props\.theme\./] },
      { id: 'data-theme', name: 'Data Theme', description: 'data-theme attribute', patterns: [/data-theme\s*=/] },
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
