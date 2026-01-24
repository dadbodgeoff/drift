/**
 * Speculative Execution Engine - Type Definitions
 *
 * Simulates multiple implementation approaches BEFORE code generation,
 * scoring them by friction, impact, and pattern alignment.
 *
 * @module simulation/types
 */

import type { CallGraphLanguage } from '../call-graph/types.js';

// ============================================================================
// Task Types
// ============================================================================

/** Task categories (auto-detected from description) */
export type TaskCategory =
  | 'rate-limiting'
  | 'authentication'
  | 'authorization'
  | 'api-endpoint'
  | 'data-access'
  | 'error-handling'
  | 'caching'
  | 'logging'
  | 'testing'
  | 'validation'
  | 'middleware'
  | 'refactoring'
  | 'generic';

/** Constraint types */
export type ConstraintType =
  | 'must-work-with'
  | 'avoid-changing'
  | 'max-files'
  | 'pattern-required'
  | 'framework-required'
  | 'custom';

/** A constraint that must be satisfied */
export interface SimulationConstraint {
  type: ConstraintType;
  value: string;
  description?: string;
  required?: boolean;
}

/** Task description for simulation */
export interface SimulationTask {
  description: string;
  category?: TaskCategory | undefined;
  target?: string | undefined;
  constraints?: SimulationConstraint[] | undefined;
  scope?: 'function' | 'file' | 'module' | 'codebase' | undefined;
}

// ============================================================================
// Approach Types
// ============================================================================

/** Implementation strategy (language-agnostic) */
export type ApproachStrategy =
  | 'middleware'
  | 'decorator'
  | 'wrapper'
  | 'per-route'
  | 'per-function'
  | 'centralized'
  | 'distributed'
  | 'aspect'
  | 'filter'
  | 'interceptor'
  | 'guard'
  | 'policy'
  | 'dependency'
  | 'mixin'
  | 'custom';


/** A single implementation approach to simulate */
export interface SimulationApproach {
  id: string;
  name: string;
  description: string;
  strategy: ApproachStrategy;
  language: CallGraphLanguage;
  framework?: string;
  targetFiles: string[];
  targetFunctions?: string[];
  newFiles?: string[];
  followsPatterns?: string[];
  estimatedLinesAdded?: number;
  estimatedLinesModified?: number;
  template?: string;
  frameworkNotes?: string;
}

// ============================================================================
// Scoring Types
// ============================================================================

export type RiskLevel = 'critical' | 'high' | 'medium' | 'low';
export type Severity = 'error' | 'warning' | 'info';

/** Friction metrics breakdown */
export interface FrictionBreakdown {
  metric: string;
  value: number;
  weight: number;
  contribution: number;
  reason?: string;
}

/** Friction metrics for an approach */
export interface FrictionMetrics {
  codeChurn: number;
  patternDeviation: number;
  testingEffort: number;
  refactoringRequired: number;
  learningCurve: number;
  overall: number;
  breakdown: FrictionBreakdown[];
}

/** Impact metrics for an approach */
export interface ImpactMetrics {
  filesAffected: number;
  functionsAffected: number;
  entryPointsAffected: number;
  sensitiveDataPaths: number;
  riskScore: number;
  riskLevel: RiskLevel;
  breakingChanges: boolean;
  breakingChangeRisks: string[];
  maxDepthAffected: number;
}

/** Aligned pattern info */
export interface AlignedPattern {
  id: string;
  name: string;
  category: string;
  alignmentScore: number;
  reason: string;
  exampleFile?: string | undefined;
}

/** Conflicting pattern info */
export interface ConflictingPattern {
  id: string;
  name: string;
  category: string;
  conflictReason: string;
  severity: Severity;
}

/** Pattern alignment metrics */
export interface PatternAlignmentMetrics {
  alignmentScore: number;
  alignedPatterns: AlignedPattern[];
  conflictingPatterns: ConflictingPattern[];
  createsNewPattern: boolean;
  wouldBeOutlier: boolean;
  suggestedPatterns: string[];
}

/** Data access implication */
export interface DataAccessImplication {
  table: string;
  fields: string[];
  operation: 'read' | 'write' | 'delete' | 'unknown';
  sensitivity: 'credentials' | 'financial' | 'health' | 'pii' | 'unknown';
  throughFunction?: string | undefined;
}

/** Security warning */
export interface SecurityWarning {
  type: string;
  message: string;
  severity: RiskLevel;
  recommendation?: string;
}

/** Security metrics */
export interface SecurityMetrics {
  securityRisk: number;
  dataAccessImplications: DataAccessImplication[];
  authImplications: string[];
  warnings: SecurityWarning[];
}


// ============================================================================
// Result Types
// ============================================================================

/** Complete simulation result for a single approach */
export interface SimulatedApproach {
  approach: SimulationApproach;
  friction: FrictionMetrics;
  impact: ImpactMetrics;
  patternAlignment: PatternAlignmentMetrics;
  security: SecurityMetrics;
  score: number;
  rank: number;
  reasoning: string;
  pros: string[];
  cons: string[];
  warnings: string[];
  nextSteps: string[];
  satisfiedConstraints: string[];
  unsatisfiedConstraints: string[];
}

/** Trade-off comparison between approaches */
export interface ApproachTradeoff {
  approach1: string;
  approach2: string;
  comparison: string;
  winner?: string;
  dimensions: {
    dimension: string;
    approach1Value: number;
    approach2Value: number;
    better: string;
  }[];
}

/** Confidence assessment */
export interface SimulationConfidence {
  score: number;
  limitations: string[];
  dataSources: string[];
}

/** Execution metadata */
export interface SimulationMetadata {
  executionTimeMs: number;
  approachesSimulated: number;
  approachesGenerated: number;
  dataSourcesUsed: string[];
  cacheHits?: number;
}

/** Complete simulation result */
export interface SimulationResult {
  task: SimulationTask;
  approaches: SimulatedApproach[];
  recommended: SimulatedApproach;
  summary: string;
  tradeoffs: ApproachTradeoff[];
  confidence: SimulationConfidence;
  metadata: SimulationMetadata;
}

// ============================================================================
// Configuration Types
// ============================================================================

/** Options for simulation */
export interface SimulationOptions {
  maxApproaches?: number;
  maxDepth?: number;
  includeSecurityAnalysis?: boolean;
  minPatternConfidence?: number;
  timeout?: number;
  enableCache?: boolean;
}

/** Scoring weights */
export interface ScoringWeights {
  friction: number;
  impact: number;
  patternAlignment: number;
  security: number;
}

export const DEFAULT_SCORING_WEIGHTS: ScoringWeights = {
  friction: 0.30,
  impact: 0.25,
  patternAlignment: 0.30,
  security: 0.15,
};

export const DEFAULT_SIMULATION_OPTIONS: Required<SimulationOptions> = {
  maxApproaches: 5,
  maxDepth: 10,
  includeSecurityAnalysis: true,
  minPatternConfidence: 0.5,
  timeout: 30000,
  enableCache: true,
};
