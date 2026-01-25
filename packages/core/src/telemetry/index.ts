/**
 * Telemetry Module - Privacy-first telemetry for Drift
 *
 * All telemetry is opt-in and never includes source code.
 * Only anonymized pattern signatures and aggregate statistics.
 */

// Types
export type {
  TelemetryConfig,
  TelemetryClientConfig,
  TelemetryEvent,
  BaseTelemetryEvent,
  PatternSignatureEvent,
  AggregateStatsEvent,
  UserActionEvent,
  ScanCompletionEvent,
  TelemetrySubmitResult,
  TelemetryStatus,
} from './types.js';

// Constants
export {
  DEFAULT_TELEMETRY_CONFIG,
  DEFAULT_CLIENT_CONFIG,
} from './types.js';

// Client
export {
  TelemetryClient,
  createTelemetryClient,
  generateInstallationId,
} from './telemetry-client.js';
