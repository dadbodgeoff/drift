/**
 * IEC 61131-3 Analyzers
 * 
 * Advanced analysis modules for migration scoring and AI context generation.
 */

export { MigrationScorer, createMigrationScorer } from './migration-scorer.js';
export type { MigrationScorerConfig, ScoringWeights } from './migration-scorer.js';

export { AIContextGenerator, createAIContextGenerator } from './ai-context.js';
export type { AIContextGeneratorConfig } from './ai-context.js';
