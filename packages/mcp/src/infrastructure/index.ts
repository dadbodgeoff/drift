/**
 * Enterprise MCP Infrastructure
 * 
 * Core infrastructure components for building enterprise-grade MCP servers:
 * - Response building with token budgets
 * - Cursor-based pagination
 * - Structured error handling
 * - Caching with invalidation
 * - Rate limiting
 * - Metrics collection
 * - Multi-project resolution
 */

// Response Building
export {
  ResponseBuilder,
  createResponseBuilder,
  type MCPResponse,
  type MCPResponseMeta,
  type PaginationInfo,
  type ResponseHints,
  type ResponseBuilderConfig,
} from './response-builder.js';

// Token Estimation
export {
  TokenEstimator,
  tokenEstimator,
  type TokenEstimate,
} from './token-estimator.js';

// Cursor Pagination
export {
  CursorManager,
  cursorManager,
  createCursor,
  parseCursor,
  type CursorData,
  type CursorConfig,
} from './cursor-manager.js';

// Error Handling
export {
  DriftError,
  DriftErrorCode,
  Errors,
  handleError,
  type DriftErrorDetails,
  type RecoveryHint,
} from './error-handler.js';

// Caching
export {
  ResponseCache,
  createCache,
  type CachedResponse,
  type CacheConfig,
} from './cache.js';

// Rate Limiting
export {
  RateLimiter,
  rateLimiter,
  type RateLimitConfig,
} from './rate-limiter.js';

// Metrics
export {
  MetricsCollector,
  metrics,
  type Metric,
  type MetricLabels,
  type HistogramBuckets,
} from './metrics.js';

// Project Resolution
export {
  resolveProject,
  formatProjectContext,
  getActiveProjectRoot,
  ProjectNotFoundError,
  ProjectInvalidError,
  type ProjectResolution,
} from './project-resolver.js';

// Startup Warmer
export {
  warmupStores,
  buildMissingData,
  logWarmupResult,
  type WarmupResult,
  type WarmupStores,
} from './startup-warmer.js';

// Tool Filtering
export {
  detectProjectLanguages,
  filterToolsForProject,
  getFilteredTools,
  getToolFilterConfig,
  type Language,
} from './tool-filter.js';
