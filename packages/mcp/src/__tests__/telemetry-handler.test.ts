/**
 * Telemetry Handler Tests
 * 
 * Tests the MCP telemetry tool functionality
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { handleTelemetry } from '../tools/setup/telemetry-handler.js';

// ============================================================================
// Test Utilities
// ============================================================================

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'drift-telemetry-mcp-test-'));
}

function cleanupTempDir(dir: string): void {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function createDriftDir(rootDir: string): string {
  const driftDir = path.join(rootDir, '.drift');
  fs.mkdirSync(driftDir, { recursive: true });
  return driftDir;
}

function createConfig(rootDir: string, config: Record<string, unknown> = {}): void {
  const configPath = path.join(rootDir, '.drift', 'config.json');
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}

function parseResponse(result: { content: Array<{ type: string; text: string }> }): {
  success: boolean;
  enabled?: boolean;
  error?: string;
  message?: string;
  config?: {
    sharePatternSignatures?: boolean;
    shareAggregateStats?: boolean;
    shareUserActions?: boolean;
    installationId?: string;
    enabledAt?: string;
  };
} {
  return JSON.parse(result.content[0]!.text);
}

// ============================================================================
// Test Suite
// ============================================================================

describe('Telemetry Handler', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
  });

  afterEach(() => {
    cleanupTempDir(tempDir);
  });

  describe('Status Action', () => {
    it('should return NOT_INITIALIZED when drift is not initialized', async () => {
      const result = await handleTelemetry(
        { action: 'status' },
        { projectRoot: tempDir }
      );

      const response = parseResponse(result);
      expect(response.success).toBe(false);
      expect(response.error).toBe('NOT_INITIALIZED');
    });

    it('should return disabled status when telemetry not configured', async () => {
      createDriftDir(tempDir);
      createConfig(tempDir, {});

      const result = await handleTelemetry(
        { action: 'status' },
        { projectRoot: tempDir }
      );

      const response = parseResponse(result);
      expect(response.success).toBe(true);
      expect(response.enabled).toBe(false);
    });

    it('should return enabled status when telemetry is enabled', async () => {
      createDriftDir(tempDir);
      createConfig(tempDir, {
        telemetry: {
          enabled: true,
          sharePatternSignatures: true,
          shareAggregateStats: true,
          shareUserActions: false,
          installationId: 'test-id-123',
          enabledAt: '2024-01-01T00:00:00.000Z',
        },
      });

      const result = await handleTelemetry(
        { action: 'status' },
        { projectRoot: tempDir }
      );

      const response = parseResponse(result);
      expect(response.success).toBe(true);
      expect(response.enabled).toBe(true);
      expect(response.config?.sharePatternSignatures).toBe(true);
      expect(response.config?.shareAggregateStats).toBe(true);
      expect(response.config?.shareUserActions).toBe(false);
      expect(response.config?.installationId).toBe('test-id-123');
    });
  });

  describe('Enable Action', () => {
    it('should enable telemetry and generate installation ID', async () => {
      createDriftDir(tempDir);
      createConfig(tempDir, {});

      const result = await handleTelemetry(
        { action: 'enable' },
        { projectRoot: tempDir }
      );

      const response = parseResponse(result);
      expect(response.success).toBe(true);
      expect(response.enabled).toBe(true);
      expect(response.config?.sharePatternSignatures).toBe(true);
      expect(response.config?.shareAggregateStats).toBe(true);
      expect(response.config?.shareUserActions).toBe(false); // Privacy default
      expect(response.config?.installationId).toBeDefined();
      expect(response.config?.enabledAt).toBeDefined();

      // Verify config was persisted
      const configPath = path.join(tempDir, '.drift', 'config.json');
      const savedConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      expect(savedConfig.telemetry.enabled).toBe(true);
    });

    it('should preserve existing installation ID when re-enabling', async () => {
      createDriftDir(tempDir);
      createConfig(tempDir, {
        telemetry: {
          enabled: false,
          installationId: 'existing-id-456',
        },
      });

      const result = await handleTelemetry(
        { action: 'enable' },
        { projectRoot: tempDir }
      );

      const response = parseResponse(result);
      expect(response.success).toBe(true);
      expect(response.config?.installationId).toBe('existing-id-456');
    });
  });

  describe('Disable Action', () => {
    it('should disable telemetry', async () => {
      createDriftDir(tempDir);
      createConfig(tempDir, {
        telemetry: {
          enabled: true,
          sharePatternSignatures: true,
          shareAggregateStats: true,
          installationId: 'test-id',
        },
      });

      const result = await handleTelemetry(
        { action: 'disable' },
        { projectRoot: tempDir }
      );

      const response = parseResponse(result);
      expect(response.success).toBe(true);
      expect(response.enabled).toBe(false);

      // Verify config was persisted
      const configPath = path.join(tempDir, '.drift', 'config.json');
      const savedConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      expect(savedConfig.telemetry.enabled).toBe(false);
      expect(savedConfig.telemetry.sharePatternSignatures).toBe(false);
      expect(savedConfig.telemetry.shareAggregateStats).toBe(false);
    });

    it('should preserve installation ID when disabling', async () => {
      createDriftDir(tempDir);
      createConfig(tempDir, {
        telemetry: {
          enabled: true,
          installationId: 'preserve-this-id',
        },
      });

      await handleTelemetry(
        { action: 'disable' },
        { projectRoot: tempDir }
      );

      const configPath = path.join(tempDir, '.drift', 'config.json');
      const savedConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      expect(savedConfig.telemetry.installationId).toBe('preserve-this-id');
    });
  });

  describe('Invalid Action', () => {
    it('should return error for unknown action', async () => {
      createDriftDir(tempDir);
      createConfig(tempDir, {});

      const result = await handleTelemetry(
        { action: 'invalid' as 'status' },
        { projectRoot: tempDir }
      );

      const response = parseResponse(result);
      expect(response.success).toBe(false);
      expect(response.error).toBe('INVALID_ACTION');
    });
  });
});
