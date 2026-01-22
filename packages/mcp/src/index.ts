/**
 * Drift MCP Server
 * 
 * Exposes drift functionality as MCP tools for AI agents.
 * This enables structured, type-safe access to codebase patterns.
 * 
 * The server uses the DataLake as the central source of truth for all data:
 * - Pre-computed views for instant status/pattern queries
 * - Sharded storage for efficient category-based lookups
 * - Automatic fallback to source stores when lake data unavailable
 * 
 * Features:
 * - Layered tool architecture (orchestration → discovery → exploration → detail)
 * - Intent-aware context synthesis via drift_context
 * - Token budget awareness and cursor-based pagination
 * - Structured error handling with recovery hints
 * - Response caching, rate limiting, and metrics
 */

// Primary Server Export
export { 
  createEnterpriseMCPServer as createDriftMCPServer,
  createEnterpriseMCPServer,
  getAllTools,
  getToolCategories,
} from './enterprise-server.js';
export type { EnterpriseMCPConfig, EnterpriseMCPConfig as DriftMCPConfig } from './enterprise-server.js';

// Utilities
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

// Infrastructure (for custom server implementations)
export {
  createResponseBuilder,
  TokenEstimator,
  CursorManager,
  DriftError,
  Errors,
  createCache,
  rateLimiter,
  metrics,
} from './infrastructure/index.js';
