/**
 * Gene Extractors Index
 */

export { BaseGeneExtractor } from './base-extractor.js';
export type { AlleleDefinition, FileExtractionResult, DetectedAllele, AggregatedExtractionResult } from './base-extractor.js';

export { VariantHandlingExtractor } from './variant-handling.js';
export { ResponsiveApproachExtractor } from './responsive-approach.js';
export { StateStylingExtractor } from './state-styling.js';
export { ThemingExtractor } from './theming.js';
export { SpacingPhilosophyExtractor } from './spacing-philosophy.js';
export { AnimationApproachExtractor } from './animation-approach.js';

import { VariantHandlingExtractor } from './variant-handling.js';
import { ResponsiveApproachExtractor } from './responsive-approach.js';
import { StateStylingExtractor } from './state-styling.js';
import { ThemingExtractor } from './theming.js';
import { SpacingPhilosophyExtractor } from './spacing-philosophy.js';
import { AnimationApproachExtractor } from './animation-approach.js';
import type { BaseGeneExtractor } from './base-extractor.js';
import type { GeneId } from '../types.js';

export function createAllGeneExtractors(): Map<GeneId, BaseGeneExtractor> {
  const extractors = new Map<GeneId, BaseGeneExtractor>();
  extractors.set('variant-handling', new VariantHandlingExtractor());
  extractors.set('responsive-approach', new ResponsiveApproachExtractor());
  extractors.set('state-styling', new StateStylingExtractor());
  extractors.set('theming', new ThemingExtractor());
  extractors.set('spacing-philosophy', new SpacingPhilosophyExtractor());
  extractors.set('animation-approach', new AnimationApproachExtractor());
  return extractors;
}

export function createGeneExtractor(geneId: GeneId): BaseGeneExtractor | null {
  switch (geneId) {
    case 'variant-handling': return new VariantHandlingExtractor();
    case 'responsive-approach': return new ResponsiveApproachExtractor();
    case 'state-styling': return new StateStylingExtractor();
    case 'theming': return new ThemingExtractor();
    case 'spacing-philosophy': return new SpacingPhilosophyExtractor();
    case 'animation-approach': return new AnimationApproachExtractor();
    default: return null;
  }
}
