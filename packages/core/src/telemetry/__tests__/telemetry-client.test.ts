/**
 * Telemetry Client Tests
 * 
 * Tests the telemetry client functionality including:
 * 1. Version loading from package.json
 * 2. Event recording
 * 3. Queue management
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { TelemetryClient, createTelemetryClient, generateInstallationId } from '../telemetry-client.js';

// ============================================================================
// Test Utilities
// ============================================================================

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'drift-telemetry-test-'));
}

function cleanupTempDir(dir: string): void {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ============================================================================
// Test Suite
// ============================================================================

describe('TelemetryClient', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
  });

  afterEach(() => {
    cleanupTempDir(tempDir);
  });

  describe('Initialization', () => {
    it('should create a telemetry client', () => {
      const client = createTelemetryClient(tempDir);
      expect(client).toBeInstanceOf(TelemetryClient);
    });

    it('should initialize with default config', async () => {
      const client = createTelemetryClient(tempDir);
      await client.initialize();
      
      const config = client.getConfig();
      expect(config.enabled).toBe(false); // Default is disabled
    });

    it('should initialize with custom config', async () => {
      const client = createTelemetryClient(tempDir, {
        enabled: true,
        installationId: 'test-id',
        sharePatternSignatures: true,
        shareAggregateStats: true,
        shareUserActions: false,
      });
      await client.initialize();
      
      const config = client.getConfig();
      expect(config.enabled).toBe(true);
      expect(config.installationId).toBe('test-id');
    });
  });

  describe('Configuration', () => {
    it('should update configuration', async () => {
      const client = createTelemetryClient(tempDir);
      await client.initialize();
      
      client.updateConfig({ enabled: true });
      
      const config = client.getConfig();
      expect(config.enabled).toBe(true);
    });

    it('should clear queue when disabled', async () => {
      const client = createTelemetryClient(tempDir, {
        enabled: true,
        installationId: 'test-id',
        sharePatternSignatures: true,
      });
      await client.initialize();
      
      // Record an event
      await client.recordPatternSignature({
        patternName: 'test-pattern',
        detectorConfig: {},
        category: 'api',
        confidence: 0.9,
        locationCount: 5,
        outlierCount: 0,
        detectionMethod: 'ast',
        language: 'typescript',
      });
      
      // Disable telemetry
      client.updateConfig({ enabled: false });
      
      const status = await client.getStatus();
      expect(status.queuedEvents).toBe(0);
    });
  });

  describe('Event Recording', () => {
    it('should not record events when disabled', async () => {
      const client = createTelemetryClient(tempDir, { enabled: false });
      await client.initialize();
      
      await client.recordPatternSignature({
        patternName: 'test-pattern',
        detectorConfig: {},
        category: 'api',
        confidence: 0.9,
        locationCount: 5,
        outlierCount: 0,
        detectionMethod: 'ast',
        language: 'typescript',
      });
      
      const status = await client.getStatus();
      expect(status.queuedEvents).toBe(0);
    });

    it('should record pattern signature events when enabled', async () => {
      const client = createTelemetryClient(tempDir, {
        enabled: true,
        installationId: 'test-id',
        sharePatternSignatures: true,
      });
      await client.initialize();
      
      await client.recordPatternSignature({
        patternName: 'test-pattern',
        detectorConfig: { detectorId: 'test-detector' },
        category: 'api',
        confidence: 0.9,
        locationCount: 5,
        outlierCount: 0,
        detectionMethod: 'ast',
        language: 'typescript',
      });
      
      const status = await client.getStatus();
      expect(status.queuedEvents).toBe(1);
    });

    it('should record aggregate stats events', async () => {
      const client = createTelemetryClient(tempDir, {
        enabled: true,
        installationId: 'test-id',
        shareAggregateStats: true,
      });
      await client.initialize();
      
      await client.recordAggregateStats({
        totalPatterns: 100,
        patternsByStatus: { discovered: 80, approved: 15, ignored: 5 },
        patternsByCategory: { api: 30, auth: 20, security: 50 },
        languages: ['typescript', 'javascript'],
        frameworks: ['express', 'react'],
        featuresEnabled: ['contracts', 'boundaries'],
        fileCount: 500,
      });
      
      const status = await client.getStatus();
      expect(status.queuedEvents).toBe(1);
    });

    it('should record scan completion events', async () => {
      const client = createTelemetryClient(tempDir, {
        enabled: true,
        installationId: 'test-id',
        shareAggregateStats: true,
      });
      await client.initialize();
      
      await client.recordScanCompletion({
        durationMs: 5000,
        filesScanned: 200,
        newPatternsDiscovered: 15,
        isIncremental: false,
        workerCount: 4,
      });
      
      const status = await client.getStatus();
      expect(status.queuedEvents).toBe(1);
    });

    it('should record user action events', async () => {
      const client = createTelemetryClient(tempDir, {
        enabled: true,
        installationId: 'test-id',
        shareUserActions: true,
      });
      await client.initialize();
      
      await client.recordUserAction({
        action: 'approve',
        category: 'api',
        confidenceAtAction: 0.85,
        discoveredAt: new Date(Date.now() - 3600000).toISOString(), // 1 hour ago
        isBulkAction: false,
      });
      
      const status = await client.getStatus();
      expect(status.queuedEvents).toBe(1);
    });
  });

  describe('Status', () => {
    it('should return correct status', async () => {
      const client = createTelemetryClient(tempDir, {
        enabled: true,
        installationId: 'test-id',
        sharePatternSignatures: true,
      });
      await client.initialize();
      
      const status = await client.getStatus();
      
      expect(status.enabled).toBe(true);
      expect(status.config.installationId).toBe('test-id');
      expect(status.queuedEvents).toBe(0);
    });
  });

  describe('Installation ID', () => {
    it('should generate valid UUID', () => {
      const id = generateInstallationId();
      
      // UUID v4 format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      expect(id).toMatch(uuidRegex);
    });

    it('should generate unique IDs', () => {
      const ids = new Set<string>();
      for (let i = 0; i < 100; i++) {
        ids.add(generateInstallationId());
      }
      expect(ids.size).toBe(100);
    });
  });

  describe('Queue Persistence', () => {
    it('should persist queue to disk', async () => {
      const client = createTelemetryClient(tempDir, {
        enabled: true,
        installationId: 'test-id',
        sharePatternSignatures: true,
      });
      await client.initialize();
      
      await client.recordPatternSignature({
        patternName: 'test-pattern',
        detectorConfig: {},
        category: 'api',
        confidence: 0.9,
        locationCount: 5,
        outlierCount: 0,
        detectionMethod: 'ast',
        language: 'typescript',
      });
      
      // Check queue file exists
      const queuePath = path.join(tempDir, 'telemetry-queue.json');
      expect(fs.existsSync(queuePath)).toBe(true);
      
      // Verify content
      const content = JSON.parse(fs.readFileSync(queuePath, 'utf-8'));
      expect(content.events.length).toBe(1);
      expect(content.events[0].type).toBe('pattern_signature');
    });

    it('should load persisted queue on initialization', async () => {
      // Create a queue file
      const queuePath = path.join(tempDir, 'telemetry-queue.json');
      fs.writeFileSync(queuePath, JSON.stringify({
        events: [
          { type: 'pattern_signature', timestamp: new Date().toISOString() },
          { type: 'aggregate_stats', timestamp: new Date().toISOString() },
        ],
      }));
      
      const client = createTelemetryClient(tempDir, { enabled: true });
      await client.initialize();
      
      const status = await client.getStatus();
      expect(status.queuedEvents).toBe(2);
    });
  });

  describe('Shutdown', () => {
    it('should shutdown gracefully', async () => {
      const client = createTelemetryClient(tempDir, { enabled: true });
      await client.initialize();
      
      // Should not throw
      await expect(client.shutdown()).resolves.not.toThrow();
    });
  });
});
