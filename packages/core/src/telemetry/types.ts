/**
 * Telemetry Types - Privacy-first telemetry for Drift
 *
 * All telemetry is opt-in and never includes source code.
 * Only anonymized pattern signatures and aggregate statistics.
 */

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * Telemetry configuration - stored in .drift/config.json
 */
export interface TelemetryConfig {
  /** Master switch - telemetry completely disabled if false */
  enabled: boolean;

  /** Share anonymized pattern signatures (hash + category + confidence) */
  sharePatternSignatures: boolean;

  /** Share aggregate statistics (counts, no identifying info) */
  shareAggregateStats: boolean;

  /** Share user actions (approve/ignore decisions, no code) */
  shareUserActions: boolean;

  /** Unique installation ID (generated on opt-in, not tied to identity) */
  installationId?: string;

  /** When telemetry was enabled */
  enabledAt?: string;
}

/**
 * Default telemetry config (all disabled)
 */
export const DEFAULT_TELEMETRY_CONFIG: TelemetryConfig = {
  enabled: false,
  sharePatternSignatures: false,
  shareAggregateStats: false,
  shareUserActions: false,
};

// ============================================================================
// Telemetry Event Types
// ============================================================================

/**
 * Base telemetry event
 */
export interface BaseTelemetryEvent {
  /** Event type discriminator */
  type: string;
  /** Timestamp (ISO 8601) */
  timestamp: string;
  /** Installation ID (anonymous) */
  installationId: string;
  /** Drift version */
  driftVersion: string;
}

/**
 * Pattern signature event - anonymized pattern data
 */
export interface PatternSignatureEvent extends BaseTelemetryEvent {
  type: 'pattern_signature';
  /** SHA-256 hash of pattern name + detector config (no code) */
  signatureHash: string;
  /** Pattern category */
  category: string;
  /** Confidence score (0-1) */
  confidence: number;
  /** Number of locations (count only) */
  locationCount: number;
  /** Number of outliers (count only) */
  outlierCount: number;
  /** Detection method used */
  detectionMethod: 'ast' | 'regex' | 'hybrid' | 'semantic';
  /** Primary language */
  language: string;
}

/**
 * Aggregate statistics event - project-level stats
 */
export interface AggregateStatsEvent extends BaseTelemetryEvent {
  type: 'aggregate_stats';
  /** Total patterns discovered */
  totalPatterns: number;
  /** Patterns by status */
  patternsByStatus: {
    discovered: number;
    approved: number;
    ignored: number;
  };
  /** Patterns by category (counts only) */
  patternsByCategory: Record<string, number>;
  /** Languages detected */
  languages: string[];
  /** Frameworks detected */
  frameworks: string[];
  /** Features enabled */
  featuresEnabled: string[];
  /** Approximate codebase size tier */
  codebaseSizeTier: 'small' | 'medium' | 'large' | 'enterprise';
}

/**
 * User action event - learning from decisions
 */
export interface UserActionEvent extends BaseTelemetryEvent {
  type: 'user_action';
  /** Action taken */
  action: 'approve' | 'ignore' | 'create_variant' | 'dismiss_outlier';
  /** Pattern category (no name or code) */
  category: string;
  /** Confidence at time of action */
  confidenceAtAction: number;
  /** Time since pattern was discovered (hours) */
  hoursSinceDiscovery: number;
  /** Was this a bulk action? */
  isBulkAction: boolean;
}

/**
 * Scan completion event - performance metrics
 */
export interface ScanCompletionEvent extends BaseTelemetryEvent {
  type: 'scan_completion';
  /** Scan duration in milliseconds */
  durationMs: number;
  /** Files scanned */
  filesScanned: number;
  /** New patterns discovered */
  newPatternsDiscovered: number;
  /** Was this incremental? */
  isIncremental: boolean;
  /** Worker count used */
  workerCount: number;
}

/**
 * Union of all telemetry events
 */
export type TelemetryEvent =
  | PatternSignatureEvent
  | AggregateStatsEvent
  | UserActionEvent
  | ScanCompletionEvent;

// ============================================================================
// Telemetry Client Types
// ============================================================================

/**
 * Telemetry client configuration
 */
export interface TelemetryClientConfig {
  /** Endpoint URL for telemetry submission */
  endpoint: string;
  /** Batch size before auto-flush */
  batchSize: number;
  /** Flush interval in milliseconds */
  flushIntervalMs: number;
  /** Request timeout in milliseconds */
  timeoutMs: number;
  /** Maximum retries on failure */
  maxRetries: number;
  /** Enable debug logging */
  debug: boolean;
}

/**
 * Default client configuration
 */
export const DEFAULT_CLIENT_CONFIG: TelemetryClientConfig = {
  endpoint: 'https://drift-telemetry.codedrift-studio.workers.dev/v1/events',
  batchSize: 50,
  flushIntervalMs: 60000, // 1 minute
  timeoutMs: 5000,
  maxRetries: 2,
  debug: false,
};

/**
 * Telemetry submission result
 */
export interface TelemetrySubmitResult {
  success: boolean;
  eventsSubmitted: number;
  error?: string;
}

/**
 * Telemetry status for CLI display
 */
export interface TelemetryStatus {
  enabled: boolean;
  config: TelemetryConfig;
  queuedEvents: number;
  lastSubmission?: string | undefined;
  lastError?: string | undefined;
}
