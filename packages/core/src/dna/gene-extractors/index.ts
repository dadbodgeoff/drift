/**
 * Gene Extractors Index
 */

export { BaseGeneExtractor } from './base-extractor.js';
export type { AlleleDefinition, FileExtractionResult, DetectedAllele, AggregatedExtractionResult } from './base-extractor.js';

// Frontend gene extractors
export { VariantHandlingExtractor } from './variant-handling.js';
export { ResponsiveApproachExtractor } from './responsive-approach.js';
export { StateStylingExtractor } from './state-styling.js';
export { ThemingExtractor } from './theming.js';
export { SpacingPhilosophyExtractor } from './spacing-philosophy.js';
export { AnimationApproachExtractor } from './animation-approach.js';

// Backend gene extractors
export { ApiResponseFormatExtractor } from './api-response-format.js';
export { ErrorResponseFormatExtractor } from './error-response-format.js';
export { LoggingFormatExtractor } from './logging-format.js';
export { ConfigPatternExtractor } from './config-pattern.js';

import { AnimationApproachExtractor } from './animation-approach.js';
import { ApiResponseFormatExtractor } from './api-response-format.js';
import { ConfigPatternExtractor } from './config-pattern.js';
import { ErrorResponseFormatExtractor } from './error-response-format.js';
import { LoggingFormatExtractor } from './logging-format.js';
import { ResponsiveApproachExtractor } from './responsive-approach.js';
import { SpacingPhilosophyExtractor } from './spacing-philosophy.js';
import { StateStylingExtractor } from './state-styling.js';
import { ThemingExtractor } from './theming.js';
import { VariantHandlingExtractor } from './variant-handling.js';

import type { BaseGeneExtractor } from './base-extractor.js';
import type { GeneId } from '../types.js';

export function createAllGeneExtractors(): Map<GeneId, BaseGeneExtractor> {
  const extractors = new Map<GeneId, BaseGeneExtractor>();
  
  // Frontend extractors
  extractors.set('variant-handling', new VariantHandlingExtractor());
  extractors.set('responsive-approach', new ResponsiveApproachExtractor());
  extractors.set('state-styling', new StateStylingExtractor());
  extractors.set('theming', new ThemingExtractor());
  extractors.set('spacing-philosophy', new SpacingPhilosophyExtractor());
  extractors.set('animation-approach', new AnimationApproachExtractor());
  
  // Backend extractors
  extractors.set('api-response-format', new ApiResponseFormatExtractor());
  extractors.set('error-response-format', new ErrorResponseFormatExtractor());
  extractors.set('logging-format', new LoggingFormatExtractor());
  extractors.set('config-pattern', new ConfigPatternExtractor());
  
  return extractors;
}

export function createFrontendGeneExtractors(): Map<GeneId, BaseGeneExtractor> {
  const extractors = new Map<GeneId, BaseGeneExtractor>();
  extractors.set('variant-handling', new VariantHandlingExtractor());
  extractors.set('responsive-approach', new ResponsiveApproachExtractor());
  extractors.set('state-styling', new StateStylingExtractor());
  extractors.set('theming', new ThemingExtractor());
  extractors.set('spacing-philosophy', new SpacingPhilosophyExtractor());
  extractors.set('animation-approach', new AnimationApproachExtractor());
  return extractors;
}

export function createBackendGeneExtractors(): Map<GeneId, BaseGeneExtractor> {
  const extractors = new Map<GeneId, BaseGeneExtractor>();
  extractors.set('api-response-format', new ApiResponseFormatExtractor());
  extractors.set('error-response-format', new ErrorResponseFormatExtractor());
  extractors.set('logging-format', new LoggingFormatExtractor());
  extractors.set('config-pattern', new ConfigPatternExtractor());
  return extractors;
}

export function createGeneExtractor(geneId: GeneId): BaseGeneExtractor | null {
  switch (geneId) {
    // Frontend
    case 'variant-handling': return new VariantHandlingExtractor();
    case 'responsive-approach': return new ResponsiveApproachExtractor();
    case 'state-styling': return new StateStylingExtractor();
    case 'theming': return new ThemingExtractor();
    case 'spacing-philosophy': return new SpacingPhilosophyExtractor();
    case 'animation-approach': return new AnimationApproachExtractor();
    // Backend
    case 'api-response-format': return new ApiResponseFormatExtractor();
    case 'error-response-format': return new ErrorResponseFormatExtractor();
    case 'logging-format': return new LoggingFormatExtractor();
    case 'config-pattern': return new ConfigPatternExtractor();
    default: return null;
  }
}
