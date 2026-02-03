/**
 * Telemetry Client - Privacy-first telemetry for Drift
 *
 * Features:
 * - Queue-based batching for efficiency
 * - Graceful failure (never blocks user operations)
 * - Local persistence of queue for reliability
 * - Respects all opt-in settings
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import {
  DEFAULT_TELEMETRY_CONFIG,
  DEFAULT_CLIENT_CONFIG,
} from './types.js';

import type {
  TelemetryConfig,
  TelemetryClientConfig,
  TelemetryEvent,
  TelemetrySubmitResult,
  TelemetryStatus,
  PatternSignatureEvent,
  AggregateStatsEvent,
  UserActionEvent,
  ScanCompletionEvent,
} from './types.js';


// ============================================================================
// Constants
// ============================================================================

// Dynamic version from package.json (falls back to 0.0.0 if not found)
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let DRIFT_VERSION = '0.0.0';
try {
  // Try to load version from the CLI package (the published package)
  const pkg = require('driftdetect/package.json');
  DRIFT_VERSION = pkg.version;
} catch {
  try {
    // Fallback: try core package
    const corePkg = require('driftdetect-core/package.json');
    DRIFT_VERSION = corePkg.version;
  } catch {
    // Keep default
  }
}

const QUEUE_FILE = 'telemetry-queue.json';

// ============================================================================
// Telemetry Client
// ============================================================================

export class TelemetryClient {
  private config: TelemetryConfig;
  private clientConfig: TelemetryClientConfig;
  private queue: TelemetryEvent[] = [];
  private driftDir: string;
  private flushTimer: NodeJS.Timeout | null = null;
  private lastSubmission: string | undefined;
  private lastError: string | undefined;
  private isInitialized = false;

  constructor(
    driftDir: string,
    config?: Partial<TelemetryConfig>,
    clientConfig?: Partial<TelemetryClientConfig>
  ) {
    this.driftDir = driftDir;
    this.config = { ...DEFAULT_TELEMETRY_CONFIG, ...config };
    this.clientConfig = { ...DEFAULT_CLIENT_CONFIG, ...clientConfig };
  }

  /**
   * Initialize the telemetry client
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {return;}

    // Load persisted queue
    await this.loadQueue();

    // Start flush timer if enabled
    if (this.config.enabled) {
      this.startFlushTimer();
    }

    this.isInitialized = true;
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<TelemetryConfig>): void {
    const wasEnabled = this.config.enabled;
    this.config = { ...this.config, ...config };

    // Handle enable/disable transitions
    if (!wasEnabled && this.config.enabled) {
      this.startFlushTimer();
    } else if (wasEnabled && !this.config.enabled) {
      this.stopFlushTimer();
      this.queue = []; // Clear queue when disabled
    }
  }

  /**
   * Get current configuration
   */
  getConfig(): TelemetryConfig {
    return { ...this.config };
  }

  /**
   * Get telemetry status
   */
  async getStatus(): Promise<TelemetryStatus> {
    return {
      enabled: this.config.enabled,
      config: { ...this.config },
      queuedEvents: this.queue.length,
      lastSubmission: this.lastSubmission,
      lastError: this.lastError,
    };
  }

  // ==========================================================================
  // Event Recording Methods
  // ==========================================================================

  /**
   * Record a pattern signature event
   */
  async recordPatternSignature(data: {
    patternName: string;
    detectorConfig: Record<string, unknown>;
    category: string;
    confidence: number;
    locationCount: number;
    outlierCount: number;
    detectionMethod: 'ast' | 'regex' | 'hybrid' | 'semantic';
    language: string;
  }): Promise<void> {
    if (!this.config.enabled || !this.config.sharePatternSignatures) {return;}

    // Create anonymized signature hash
    const signatureInput = `${data.patternName}:${JSON.stringify(data.detectorConfig)}`;
    const signatureHash = crypto
      .createHash('sha256')
      .update(signatureInput)
      .digest('hex')
      .substring(0, 16); // Truncate for privacy

    const event: PatternSignatureEvent = {
      type: 'pattern_signature',
      timestamp: new Date().toISOString(),
      installationId: this.config.installationId ?? 'unknown',
      driftVersion: DRIFT_VERSION,
      signatureHash,
      category: data.category,
      confidence: Math.round(data.confidence * 100) / 100, // Round to 2 decimals
      locationCount: data.locationCount,
      outlierCount: data.outlierCount,
      detectionMethod: data.detectionMethod,
      language: data.language,
    };

    await this.enqueue(event);
  }

  /**
   * Record aggregate statistics event
   */
  async recordAggregateStats(data: {
    totalPatterns: number;
    patternsByStatus: { discovered: number; approved: number; ignored: number };
    patternsByCategory: Record<string, number>;
    languages: string[];
    frameworks: string[];
    featuresEnabled: string[];
    fileCount: number;
  }): Promise<void> {
    if (!this.config.enabled || !this.config.shareAggregateStats) {return;}

    // Determine codebase size tier (anonymized)
    let codebaseSizeTier: 'small' | 'medium' | 'large' | 'enterprise';
    if (data.fileCount < 100) {codebaseSizeTier = 'small';}
    else if (data.fileCount < 1000) {codebaseSizeTier = 'medium';}
    else if (data.fileCount < 10000) {codebaseSizeTier = 'large';}
    else {codebaseSizeTier = 'enterprise';}

    const event: AggregateStatsEvent = {
      type: 'aggregate_stats',
      timestamp: new Date().toISOString(),
      installationId: this.config.installationId ?? 'unknown',
      driftVersion: DRIFT_VERSION,
      totalPatterns: data.totalPatterns,
      patternsByStatus: data.patternsByStatus,
      patternsByCategory: data.patternsByCategory,
      languages: data.languages,
      frameworks: data.frameworks,
      featuresEnabled: data.featuresEnabled,
      codebaseSizeTier,
    };

    await this.enqueue(event);
  }

  /**
   * Record user action event
   */
  async recordUserAction(data: {
    action: 'approve' | 'ignore' | 'create_variant' | 'dismiss_outlier';
    category: string;
    confidenceAtAction: number;
    discoveredAt: string;
    isBulkAction: boolean;
  }): Promise<void> {
    if (!this.config.enabled || !this.config.shareUserActions) {return;}

    // Calculate hours since discovery
    const discoveredTime = new Date(data.discoveredAt).getTime();
    const now = Date.now();
    const hoursSinceDiscovery = Math.round((now - discoveredTime) / (1000 * 60 * 60));

    const event: UserActionEvent = {
      type: 'user_action',
      timestamp: new Date().toISOString(),
      installationId: this.config.installationId ?? 'unknown',
      driftVersion: DRIFT_VERSION,
      action: data.action,
      category: data.category,
      confidenceAtAction: Math.round(data.confidenceAtAction * 100) / 100,
      hoursSinceDiscovery,
      isBulkAction: data.isBulkAction,
    };

    await this.enqueue(event);
  }

  /**
   * Record scan completion event
   */
  async recordScanCompletion(data: {
    durationMs: number;
    filesScanned: number;
    newPatternsDiscovered: number;
    isIncremental: boolean;
    workerCount: number;
  }): Promise<void> {
    if (!this.config.enabled || !this.config.shareAggregateStats) {return;}

    const event: ScanCompletionEvent = {
      type: 'scan_completion',
      timestamp: new Date().toISOString(),
      installationId: this.config.installationId ?? 'unknown',
      driftVersion: DRIFT_VERSION,
      durationMs: data.durationMs,
      filesScanned: data.filesScanned,
      newPatternsDiscovered: data.newPatternsDiscovered,
      isIncremental: data.isIncremental,
      workerCount: data.workerCount,
    };

    await this.enqueue(event);
  }

  // ==========================================================================
  // Queue Management
  // ==========================================================================

  /**
   * Add event to queue
   */
  private async enqueue(event: TelemetryEvent): Promise<void> {
    this.queue.push(event);
    await this.saveQueue();

    // Auto-flush if batch size reached
    if (this.queue.length >= this.clientConfig.batchSize) {
      await this.flush();
    }
  }

  /**
   * Flush queued events to server
   */
  async flush(): Promise<TelemetrySubmitResult> {
    if (!this.config.enabled || this.queue.length === 0) {
      return { success: true, eventsSubmitted: 0 };
    }

    const eventsToSubmit = [...this.queue];
    
    try {
      const response = await this.submitEvents(eventsToSubmit);
      
      if (response.success) {
        // Clear submitted events from queue
        this.queue = this.queue.slice(eventsToSubmit.length);
        await this.saveQueue();
        this.lastSubmission = new Date().toISOString();
        this.lastError = undefined;
      }

      return response;
    } catch (error) {
      this.lastError = (error as Error).message;
      
      if (this.clientConfig.debug) {
        console.error('[Telemetry] Flush failed:', error);
      }

      // Don't throw - telemetry should never block user operations
      return {
        success: false,
        eventsSubmitted: 0,
        error: (error as Error).message,
      };
    }
  }

  /**
   * Submit events to telemetry server
   */
  private async submitEvents(events: TelemetryEvent[]): Promise<TelemetrySubmitResult> {
    if (this.clientConfig.debug) {
      console.log(`[Telemetry] Submitting ${events.length} events to ${this.clientConfig.endpoint}`);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.clientConfig.timeoutMs);

    let retries = 0;
    let lastError: Error | null = null;

    while (retries <= this.clientConfig.maxRetries) {
      try {
        const response = await fetch(this.clientConfig.endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ events }),
          signal: controller.signal,
        });

        clearTimeout(timeout);

        if (!response.ok) {
          const errorText = await response.text().catch(() => 'Unknown error');
          throw new Error(`HTTP ${response.status}: ${errorText}`);
        }

        const result = await response.json() as { success: boolean; eventsProcessed?: number };
        
        if (this.clientConfig.debug) {
          console.log(`[Telemetry] Successfully submitted ${result.eventsProcessed ?? events.length} events`);
        }

        return { success: true, eventsSubmitted: result.eventsProcessed ?? events.length };
      } catch (error) {
        lastError = error as Error;
        retries++;

        if (retries <= this.clientConfig.maxRetries) {
          // Exponential backoff: 1s, 2s, 4s...
          const backoffMs = Math.min(1000 * Math.pow(2, retries - 1), 10000);
          if (this.clientConfig.debug) {
            console.log(`[Telemetry] Retry ${retries}/${this.clientConfig.maxRetries} after ${backoffMs}ms`);
          }
          await new Promise(resolve => setTimeout(resolve, backoffMs));
        }
      }
    }

    clearTimeout(timeout);

    // All retries exhausted
    if (this.clientConfig.debug) {
      console.error(`[Telemetry] Failed after ${this.clientConfig.maxRetries} retries:`, lastError);
    }

    return {
      success: false,
      eventsSubmitted: 0,
      error: lastError?.message ?? 'Unknown error',
    };
  }

  // ==========================================================================
  // Persistence
  // ==========================================================================

  /**
   * Load queue from disk
   */
  private async loadQueue(): Promise<void> {
    try {
      const queuePath = path.join(this.driftDir, QUEUE_FILE);
      const content = await fs.readFile(queuePath, 'utf-8');
      const data = JSON.parse(content);
      this.queue = Array.isArray(data.events) ? data.events : [];
      this.lastSubmission = data.lastSubmission;
      this.lastError = data.lastError;
    } catch {
      // Queue file doesn't exist or is invalid - start fresh
      this.queue = [];
    }
  }

  /**
   * Save queue to disk
   */
  private async saveQueue(): Promise<void> {
    try {
      const queuePath = path.join(this.driftDir, QUEUE_FILE);
      await fs.writeFile(
        queuePath,
        JSON.stringify({
          events: this.queue,
          lastSubmission: this.lastSubmission,
          lastError: this.lastError,
        }, null, 2)
      );
    } catch {
      // Ignore save errors - telemetry should never block
    }
  }

  // ==========================================================================
  // Timer Management
  // ==========================================================================

  /**
   * Start periodic flush timer
   */
  private startFlushTimer(): void {
    if (this.flushTimer) {return;}

    this.flushTimer = setInterval(async () => {
      await this.flush();
    }, this.clientConfig.flushIntervalMs);

    // Don't prevent process exit
    this.flushTimer.unref();
  }

  /**
   * Stop flush timer
   */
  private stopFlushTimer(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }

  /**
   * Shutdown client gracefully
   */
  async shutdown(): Promise<void> {
    this.stopFlushTimer();
    
    // Final flush attempt
    if (this.queue.length > 0) {
      await this.flush();
    }
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a telemetry client
 */
export function createTelemetryClient(
  driftDir: string,
  config?: Partial<TelemetryConfig>,
  clientConfig?: Partial<TelemetryClientConfig>
): TelemetryClient {
  return new TelemetryClient(driftDir, config, clientConfig);
}

/**
 * Generate a new installation ID
 */
export function generateInstallationId(): string {
  return crypto.randomUUID();
}
