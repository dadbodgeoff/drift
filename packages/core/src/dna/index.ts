/**
 * DNA Module - Styling DNA Analysis System
 */

export * from './types.js';
export { DNAStore } from './dna-store.js';
export { DNAAnalyzer } from './dna-analyzer.js';
export type { DNAAnalyzerConfig } from './dna-analyzer.js';
export { BaseGeneExtractor } from './gene-extractors/base-extractor.js';
// Frontend extractors
export { VariantHandlingExtractor } from './gene-extractors/variant-handling.js';
export { ResponsiveApproachExtractor } from './gene-extractors/responsive-approach.js';
export { StateStylingExtractor } from './gene-extractors/state-styling.js';
export { ThemingExtractor } from './gene-extractors/theming.js';
export { SpacingPhilosophyExtractor } from './gene-extractors/spacing-philosophy.js';
export { AnimationApproachExtractor } from './gene-extractors/animation-approach.js';
// Backend extractors
export { ApiResponseFormatExtractor } from './gene-extractors/api-response-format.js';
export { ErrorResponseFormatExtractor } from './gene-extractors/error-response-format.js';
export { LoggingFormatExtractor } from './gene-extractors/logging-format.js';
export { ConfigPatternExtractor } from './gene-extractors/config-pattern.js';
// Extractor factories
export { createAllGeneExtractors, createFrontendGeneExtractors, createBackendGeneExtractors } from './gene-extractors/index.js';
export { HealthCalculator } from './health-calculator.js';
export { MutationDetector } from './mutation-detector.js';
export { PlaybookGenerator } from './playbook-generator.js';
export { AIContextBuilder } from './ai-context.js';
export type { ContextLevel } from './ai-context.js';
