/**
 * Drift MCP Server
 * 
 * Exposes drift functionality as MCP tools for AI agents.
 * This enables structured, type-safe access to codebase patterns.
 */

export { createDriftMCPServer } from './server.js';
export type { DriftMCPConfig } from './server.js';

export { PackManager, DEFAULT_PACKS } from './packs.js';
export type { 
  PackDefinition, 
  PackMeta, 
  PackResult,
  PackUsage,
  SuggestedPack,
} from './packs.js';

export { FeedbackManager } from './feedback.js';
export type {
  ExampleFeedback,
  FeedbackStats,
  LocationScore,
} from './feedback.js';
