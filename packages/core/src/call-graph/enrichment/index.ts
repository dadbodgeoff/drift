/**
 * Enrichment Module
 *
 * Enterprise-grade security finding enrichment.
 * Transforms raw vulnerability findings into actionable intelligence.
 */

// Types
export type {
  // Input types
  FindingSeverity,
  FindingCategory,
  SecurityFinding,
  // Data impact types
  DataSensitivityProfile,
  DataRegulation,
  ReachableData,
  DataImpact,
  SensitiveFieldImpact,
  ImpactClassification,
  // Blast radius types
  BlastRadius,
  EntryPointInfo,
  EntryPointType,
  AffectedFunction,
  BlastRadiusClassification,
  // Priority types
  PriorityScore,
  PriorityTier,
  // Remediation types
  RemediationGuidance,
  RemediationStep,
  CodeExample,
  RemediationEffort,
  Reference,
  // Result types
  EnrichedFinding,
  EnrichmentMetadata,
  EnrichmentOptions,
  EnrichmentResult,
  EnrichmentSummary,
  BatchMetadata,
  EnrichmentFailure,
} from './types.js';

// Enrichment Engine
export {
  EnrichmentEngine,
  createEnrichmentEngine,
} from './enrichment-engine.js';

// Sensitivity Classifier
export {
  SensitivityClassifier,
  createSensitivityClassifier,
  getDefaultClassifier,
} from './sensitivity-classifier.js';

// Impact Scorer
export {
  ImpactScorer,
  createImpactScorer,
} from './impact-scorer.js';

// Remediation Generator
export {
  RemediationGenerator,
  createRemediationGenerator,
} from './remediation-generator.js';
