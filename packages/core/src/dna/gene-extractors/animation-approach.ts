/**
 * Animation Approach Gene Extractor
 *
 * Detects how the codebase implements animations and transitions.
 */

import { BaseGeneExtractor, type AlleleDefinition, type FileExtractionResult, type DetectedAllele } from './base-extractor.js';

import type { GeneId } from '../types.js';

export class AnimationApproachExtractor extends BaseGeneExtractor {
  readonly geneId: GeneId = 'animation-approach';
  readonly geneName = 'Animation Approach';
  readonly geneDescription = 'How animations and transitions are implemented';

  getAlleleDefinitions(): AlleleDefinition[] {
    return [
      {
        id: 'tailwind-transitions',
        name: 'Tailwind Transitions',
        description: 'Using Tailwind transition utilities',
        patterns: [
          /className\s*=\s*["'`][^"'`]*\btransition-/,
          /className\s*=\s*["'`][^"'`]*\bduration-/,
          /className\s*=\s*["'`][^"'`]*\bease-/,
          /className\s*=\s*["'`][^"'`]*\banimate-/,
        ],
      },
      {
        id: 'framer-motion',
        name: 'Framer Motion',
        description: 'Using Framer Motion library',
        patterns: [/<motion\./, /useAnimation\s*\(/, /useSpring\s*\(/],
        importPatterns: [/from\s+['"]framer-motion['"]/],
      },
      {
        id: 'css-animations',
        name: 'CSS Animations',
        description: 'Using CSS @keyframes',
        patterns: [/@keyframes\s+\w+/, /animation\s*:\s*\w+/],
      },
      {
        id: 'css-transitions',
        name: 'CSS Transitions',
        description: 'Using CSS transition property',
        patterns: [/transition\s*:\s*[^;]+;/, /transition-property\s*:/],
      },
      {
        id: 'react-spring',
        name: 'React Spring',
        description: 'Using React Spring library',
        patterns: [/useSpring\s*\(/, /animated\./],
        importPatterns: [/from\s+['"]@react-spring/],
      },
      {
        id: 'no-animation',
        name: 'No Animation',
        description: 'No animation patterns detected',
        patterns: [],
      },
    ];
  }

  extractFromFile(filePath: string, content: string, imports: string[]): FileExtractionResult {
    const detectedAlleles: DetectedAllele[] = [];
    const isComponent = this.isComponentFile(filePath, content);

    for (const def of this.getAlleleDefinitions()) {
      if (def.id === 'no-animation') {continue;}

      // Check import patterns
      if (def.importPatterns) {
        for (const importPattern of def.importPatterns) {
          if (imports.some(imp => importPattern.test(imp))) {
            detectedAlleles.push({
              alleleId: def.id,
              line: 1,
              code: imports.find(imp => importPattern.test(imp)) ?? '',
              confidence: 0.9,
            });
            break;
          }
        }
      }

      // Check content patterns
      for (const pattern of def.patterns) {
        const match = pattern.exec(content);
        if (match) {
          const ctx = this.extractContext(content, match.index);
          detectedAlleles.push({
            alleleId: def.id,
            line: ctx.line,
            code: ctx.code,
            confidence: 0.8,
            context: ctx.context,
          });
          break;
        }
      }
    }

    return { file: filePath, detectedAlleles, isComponent };
  }
}
