/**
 * Curation Handler Tests
 * 
 * Tests the MCP pattern curation tool with anti-hallucination verification
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { createPatternStore } from 'driftdetect-core/storage';
import type { Pattern, PatternCategory, ConfidenceLevel } from 'driftdetect-core';

// ============================================================================
// Test Utilities
// ============================================================================

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'drift-curation-test-'));
}

function cleanupTempDir(dir: string): void {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function createDriftDir(rootDir: string): string {
  const driftDir = path.join(rootDir, '.drift');
  fs.mkdirSync(driftDir, { recursive: true });
  fs.mkdirSync(path.join(driftDir, 'audit'), { recursive: true });
  return driftDir;
}

function createConfig(rootDir: string, config: Record<string, unknown> = {}): void {
  const configPath = path.join(rootDir, '.drift', 'config.json');
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}

function createManifest(rootDir: string): void {
  const manifestPath = path.join(rootDir, '.drift', 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify({
    version: '1.0.0',
    lastScan: new Date().toISOString(),
    projectRoot: rootDir,
  }, null, 2));
}

function createTestPattern(options: {
  id: string;
  name: string;
  category: PatternCategory;
  confidence: { score: number; level: ConfidenceLevel };
  locations: Array<{ file: string; line: number }>;
  description?: string;
}): Pattern {
  const now = new Date().toISOString();
  return {
    id: options.id,
    name: options.name,
    description: options.description ?? `Test pattern: ${options.name}`,
    category: options.category,
    subcategory: 'test',
    status: 'discovered',
    confidence: {
      frequency: options.confidence.score,
      consistency: options.confidence.score,
      age: 1,
      spread: 1,
      score: options.confidence.score,
      level: options.confidence.level,
    },
    detector: {
      type: 'ast',
      config: { language: 'typescript' },
    },
    severity: 'info',
    autoFixable: false,
    locations: options.locations.map(loc => ({
      file: loc.file,
      line: loc.line,
      column: 0,
    })),
    outliers: [],
    metadata: {
      firstSeen: now,
      lastSeen: now,
    },
  };
}

function createSourceFile(rootDir: string, relativePath: string, content: string): void {
  const fullPath = path.join(rootDir, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content);
}

// ============================================================================
// Type Definitions
// ============================================================================

interface PatternItem {
  id: string;
  name: string;
  confidence: number;
  evidenceRequirements?: {
    minFiles: number;
    requireSnippet: boolean;
  };
}

interface CurationData {
  patterns?: PatternItem[];
  total?: number;
  success?: boolean;
  error?: string;
  verified?: boolean;
  verificationScore?: number;
  canApprove?: boolean;
  approvalRequirements?: string[];
  approved?: number;
  skipped?: number;
  pattern?: string;
  message?: string;
}

interface CurationResponse {
  summary?: string;
  data?: CurationData;
  hints?: {
    nextActions?: string[];
  };
}

function parseResponse(result: { content: Array<{ type: string; text: string }> }): CurationResponse {
  const text = result.content[0]?.text ?? '{}';
  try {
    const parsed = JSON.parse(text);
    return parsed;
  } catch {
    return { summary: text };
  }
}

// ============================================================================
// Test Suite
// ============================================================================

describe('Curation Handler', () => {
  let tempDir: string;
  let handleCurate: typeof import('../tools/curation/handler.js').handleCurate;

  beforeEach(async () => {
    tempDir = createTempDir();
    const module = await import('../tools/curation/handler.js');
    handleCurate = module.handleCurate;
  });

  afterEach(() => {
    cleanupTempDir(tempDir);
  });

  describe('Review Action', () => {
    it('should return empty list when no patterns exist', async () => {
      createDriftDir(tempDir);
      createConfig(tempDir, {});
      createManifest(tempDir);

      const result = await handleCurate(
        { action: 'review' },
        { projectRoot: tempDir }
      );

      const response = parseResponse(result);
      expect(response.data?.patterns).toEqual([]);
      expect(response.data?.total).toBe(0);
    });

    it('should return discovered patterns with evidence requirements', async () => {
      createDriftDir(tempDir);
      createConfig(tempDir, {});
      createManifest(tempDir);
      
      // Use the store API to add patterns (uses SQLite by default)
      const store = await createPatternStore({ rootDir: tempDir });
      await store.add(createTestPattern({
        id: 'pattern-1',
        name: 'Error Handler Pattern',
        category: 'errors',
        confidence: { score: 0.75, level: 'medium' },
        locations: [{ file: 'src/utils.ts', line: 10 }],
      }));
      await store.saveAll();
      if (store.close) await store.close();

      const result = await handleCurate(
        { action: 'review' },
        { projectRoot: tempDir }
      );

      const response = parseResponse(result);
      expect(response.data?.patterns?.length).toBe(1);
      expect(response.data?.patterns?.[0]?.name).toBe('Error Handler Pattern');
      expect(response.data?.patterns?.[0]?.evidenceRequirements?.minFiles).toBe(2);
      expect(response.data?.patterns?.[0]?.evidenceRequirements?.requireSnippet).toBe(true);
    });

    it('should filter by confidence range', async () => {
      createDriftDir(tempDir);
      createConfig(tempDir, {});
      createManifest(tempDir);
      
      const store = await createPatternStore({ rootDir: tempDir });
      await store.add(createTestPattern({
        id: 'high-conf',
        name: 'High Confidence Pattern',
        category: 'api',
        confidence: { score: 0.95, level: 'high' },
        locations: [{ file: 'src/api.ts', line: 5 }],
      }));
      await store.add(createTestPattern({
        id: 'low-conf',
        name: 'Low Confidence Pattern',
        category: 'api',
        confidence: { score: 0.50, level: 'low' },
        locations: [{ file: 'src/api.ts', line: 20 }],
      }));
      await store.saveAll();
      if (store.close) await store.close();

      const result = await handleCurate(
        { action: 'review', minConfidence: 0.8 },
        { projectRoot: tempDir }
      );

      const response = parseResponse(result);
      expect(response.data?.patterns?.length).toBe(1);
      expect(response.data?.patterns?.[0]?.name).toBe('High Confidence Pattern');
    });
  });

  describe('Verify Action', () => {
    it('should require patternId', async () => {
      createDriftDir(tempDir);
      createConfig(tempDir, {});
      createManifest(tempDir);

      const result = await handleCurate(
        { action: 'verify' },
        { projectRoot: tempDir }
      );

      const response = parseResponse(result);
      expect(response.data?.error).toContain('patternId required');
    });

    it('should require evidence', async () => {
      createDriftDir(tempDir);
      createConfig(tempDir, {});
      createManifest(tempDir);
      
      const store = await createPatternStore({ rootDir: tempDir });
      await store.add(createTestPattern({
        id: 'test-pattern',
        name: 'Test Pattern',
        category: 'api',
        confidence: { score: 0.75, level: 'medium' },
        locations: [{ file: 'src/test.ts', line: 10 }],
      }));
      await store.saveAll();
      if (store.close) await store.close();

      const result = await handleCurate(
        { action: 'verify', patternId: 'test-pattern' },
        { projectRoot: tempDir }
      );

      const response = parseResponse(result);
      expect(response.data?.error).toContain('evidence required');
    });

    it('should verify pattern exists in actual files', async () => {
      createDriftDir(tempDir);
      createConfig(tempDir, {});
      createManifest(tempDir);
      
      // Create source file with pattern
      createSourceFile(tempDir, 'src/utils.ts', `
export function handleError(error: Error) {
  console.error('Error:', error.message);
  throw error;
}
`);
      
      const store = await createPatternStore({ rootDir: tempDir });
      await store.add(createTestPattern({
        id: 'error-handler',
        name: 'Error Handler',
        category: 'errors',
        confidence: { score: 0.75, level: 'medium' },
        locations: [{ file: 'src/utils.ts', line: 2 }],
      }));
      await store.saveAll();
      if (store.close) await store.close();

      const result = await handleCurate(
        { 
          action: 'verify', 
          patternId: 'error-handler',
          evidence: {
            files: ['src/utils.ts'],
            snippets: ['handleError'],
            reasoning: 'This is a standard error handling pattern used throughout the codebase',
          },
        },
        { projectRoot: tempDir }
      );

      const response = parseResponse(result);
      expect(response.data?.verified).toBe(true);
      expect(response.data?.verificationScore).toBeGreaterThan(0);
    });

    it('should fail verification for non-existent files', async () => {
      createDriftDir(tempDir);
      createConfig(tempDir, {});
      createManifest(tempDir);
      
      const store = await createPatternStore({ rootDir: tempDir });
      await store.add(createTestPattern({
        id: 'fake-pattern',
        name: 'Fake Pattern',
        category: 'api',
        confidence: { score: 0.50, level: 'low' },
        locations: [{ file: 'src/nonexistent.ts', line: 10 }],
      }));
      await store.saveAll();
      if (store.close) await store.close();

      const result = await handleCurate(
        { 
          action: 'verify', 
          patternId: 'fake-pattern',
          evidence: {
            files: ['src/nonexistent.ts'],
            reasoning: 'AI hallucinated this file',
          },
        },
        { projectRoot: tempDir }
      );

      const response = parseResponse(result);
      expect(response.data?.canApprove).toBe(false);
    });
  });

  describe('Approve Action', () => {
    it('should require evidence for non-high-confidence patterns', async () => {
      createDriftDir(tempDir);
      createConfig(tempDir, {});
      createManifest(tempDir);
      
      const store = await createPatternStore({ rootDir: tempDir });
      await store.add(createTestPattern({
        id: 'medium-conf',
        name: 'Medium Confidence Pattern',
        category: 'api',
        confidence: { score: 0.70, level: 'medium' },
        locations: [{ file: 'src/api.ts', line: 5 }],
      }));
      await store.saveAll();
      if (store.close) await store.close();

      const result = await handleCurate(
        { action: 'approve', patternId: 'medium-conf' },
        { projectRoot: tempDir }
      );

      const response = parseResponse(result);
      expect(response.data?.error).toContain('Evidence required');
    });

    it('should approve high-confidence patterns without evidence', async () => {
      createDriftDir(tempDir);
      createConfig(tempDir, {});
      createManifest(tempDir);
      
      createSourceFile(tempDir, 'src/api.ts', 'export const api = {};');
      
      const store = await createPatternStore({ rootDir: tempDir });
      await store.add(createTestPattern({
        id: 'high-conf',
        name: 'High Confidence Pattern',
        category: 'api',
        confidence: { score: 0.95, level: 'high' },
        locations: [{ file: 'src/api.ts', line: 1 }],
      }));
      await store.saveAll();
      if (store.close) await store.close();

      const result = await handleCurate(
        { action: 'approve', patternId: 'high-conf' },
        { projectRoot: tempDir }
      );

      const response = parseResponse(result);
      expect(response.data?.success ?? !response.data?.error).toBe(true);
    });
  });

  describe('Ignore Action', () => {
    it('should require ignoreReason', async () => {
      createDriftDir(tempDir);
      createConfig(tempDir, {});
      createManifest(tempDir);
      
      const store = await createPatternStore({ rootDir: tempDir });
      await store.add(createTestPattern({
        id: 'to-ignore',
        name: 'Pattern to Ignore',
        category: 'api',
        confidence: { score: 0.50, level: 'low' },
        locations: [{ file: 'src/api.ts', line: 5 }],
      }));
      await store.saveAll();
      if (store.close) await store.close();

      const result = await handleCurate(
        { action: 'ignore', patternId: 'to-ignore' },
        { projectRoot: tempDir }
      );

      const response = parseResponse(result);
      expect(response.data?.error).toContain('ignoreReason required');
    });

    it('should ignore pattern with reason', async () => {
      createDriftDir(tempDir);
      createConfig(tempDir, {});
      createManifest(tempDir);
      
      const store = await createPatternStore({ rootDir: tempDir });
      await store.add(createTestPattern({
        id: 'to-ignore',
        name: 'Pattern to Ignore',
        category: 'api',
        confidence: { score: 0.50, level: 'low' },
        locations: [{ file: 'src/api.ts', line: 5 }],
      }));
      await store.saveAll();
      if (store.close) await store.close();

      const result = await handleCurate(
        { 
          action: 'ignore', 
          patternId: 'to-ignore',
          ignoreReason: 'False positive - this is test code',
        },
        { projectRoot: tempDir }
      );

      const response = parseResponse(result);
      expect(response.data?.success).toBe(true);
    });
  });

  describe('Bulk Approve Action', () => {
    it('should only approve high-confidence patterns', async () => {
      createDriftDir(tempDir);
      createConfig(tempDir, {});
      createManifest(tempDir);
      
      createSourceFile(tempDir, 'src/api.ts', 'export const api = {};');
      
      const store = await createPatternStore({ rootDir: tempDir });
      await store.add(createTestPattern({
        id: 'high-1',
        name: 'High Confidence 1',
        category: 'api',
        confidence: { score: 0.96, level: 'high' },
        locations: [{ file: 'src/api.ts', line: 1 }],
      }));
      await store.add(createTestPattern({
        id: 'medium-1',
        name: 'Medium Confidence 1',
        category: 'api',
        confidence: { score: 0.70, level: 'medium' },
        locations: [{ file: 'src/api.ts', line: 1 }],
      }));
      await store.saveAll();
      if (store.close) await store.close();

      const result = await handleCurate(
        { action: 'bulk_approve', dryRun: true },
        { projectRoot: tempDir }
      );

      const response = parseResponse(result);
      expect(response.data?.patterns?.length).toBe(1);
      expect(response.summary).toContain('DRY RUN');
    });
  });

  describe('Audit Action', () => {
    it('should return empty audit when no decisions made', async () => {
      createDriftDir(tempDir);
      createConfig(tempDir, {});
      createManifest(tempDir);

      const result = await handleCurate(
        { action: 'audit' },
        { projectRoot: tempDir }
      );

      const response = parseResponse(result);
      expect(response.summary).toContain('0 curation decisions');
    });
  });
});

describe('Evidence Requirements', () => {
  it('should require more evidence for lower confidence', async () => {
    const { getEvidenceRequirements } = await import('../tools/curation/verifier.js');
    
    const high = getEvidenceRequirements('high');
    const medium = getEvidenceRequirements('medium');
    const low = getEvidenceRequirements('low');
    const uncertain = getEvidenceRequirements('uncertain');
    
    expect(high.minFiles).toBe(1);
    expect(high.requireSnippet).toBe(false);
    
    expect(medium.minFiles).toBe(2);
    expect(medium.requireSnippet).toBe(true);
    
    expect(low.minFiles).toBe(3);
    expect(low.requireSnippet).toBe(true);
    
    expect(uncertain.minFiles).toBe(5);
    expect(uncertain.requireSnippet).toBe(true);
  });
});
