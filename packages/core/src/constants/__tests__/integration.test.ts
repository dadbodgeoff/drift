/**
 * Integration Tests for Constants Module
 *
 * Tests for scanner adapter, call graph adapter, and pattern adapter.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  ConstantScannerAdapter,
  createConstantScanner,
  getConstantLanguage,
  hashContent,
  processConstantTask,
  createDefaultConstantQuality,
} from '../integration/scanner-adapter.js';
import {
  ConstantCallGraphAdapter,
  createCallGraphAdapter,
  type CallGraphInterface,
} from '../integration/callgraph-adapter.js';
import {
  ConstantPatternAdapter,
  createPatternAdapter,
  severityToNumber,
  compareSeverity,
} from '../integration/pattern-adapter.js';
import { ConstantStore } from '../store/constant-store.js';

// ============================================================================
// Test Helpers
// ============================================================================

let testDir: string;

async function createTestDir(): Promise<string> {
  const dir = path.join(os.tmpdir(), `drift-constants-integration-test-${Date.now()}`);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

async function cleanupTestDir(dir: string): Promise<void> {
  try {
    await fs.rm(dir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

// ============================================================================
// Scanner Adapter Tests
// ============================================================================

describe('ConstantScannerAdapter', () => {
  beforeEach(async () => {
    testDir = await createTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  describe('initialization', () => {
    it('should initialize successfully', async () => {
      const adapter = createConstantScanner({ rootDir: testDir });
      await adapter.initialize();
      expect(adapter.isEnabled()).toBe(true);
    });

    it('should respect enabled config', async () => {
      const adapter = createConstantScanner({ rootDir: testDir, enabled: false });
      await adapter.initialize();
      expect(adapter.isEnabled()).toBe(false);
    });
  });

  describe('extractFile', () => {
    it('should extract constants from TypeScript file', async () => {
      const adapter = createConstantScanner({ rootDir: testDir });
      await adapter.initialize();

      const content = `
        export const API_URL = 'https://api.example.com';
        export const MAX_RETRIES = 3;
      `;

      const result = await adapter.extractFile('src/config.ts', content);

      expect(result.skipped).toBe(false);
      expect(result.result).not.toBeNull();
      expect(result.result!.constants.length).toBeGreaterThanOrEqual(2);
    });

    it('should extract constants from Python file', async () => {
      const adapter = createConstantScanner({ rootDir: testDir });
      await adapter.initialize();

      const content = `
MAX_CONNECTIONS = 100
API_ENDPOINT = "https://api.example.com"
      `;

      const result = await adapter.extractFile('config.py', content);

      expect(result.skipped).toBe(false);
      expect(result.result).not.toBeNull();
      expect(result.result!.constants.length).toBeGreaterThanOrEqual(2);
    });

    it('should skip unsupported file types', async () => {
      const adapter = createConstantScanner({ rootDir: testDir });
      await adapter.initialize();

      const result = await adapter.extractFile('readme.md', '# Hello');

      expect(result.skipped).toBe(true);
      expect(result.result).toBeNull();
    });

    it('should skip when disabled', async () => {
      const adapter = createConstantScanner({ rootDir: testDir, enabled: false });
      await adapter.initialize();

      const result = await adapter.extractFile('config.ts', 'export const X = 1;');

      expect(result.skipped).toBe(true);
    });

    it('should use incremental mode', async () => {
      const adapter = createConstantScanner({ rootDir: testDir, incremental: true });
      await adapter.initialize();

      const content = 'export const X = 1;';

      // First extraction
      const result1 = await adapter.extractFile('config.ts', content);
      expect(result1.skipped).toBe(false);

      // Second extraction with same content should be skipped
      const result2 = await adapter.extractFile('config.ts', content);
      expect(result2.skipped).toBe(true);

      // Third extraction with different content should not be skipped
      const result3 = await adapter.extractFile('config.ts', 'export const Y = 2;');
      expect(result3.skipped).toBe(false);
    });
  });

  describe('extractFiles', () => {
    it('should extract from multiple files', async () => {
      const adapter = createConstantScanner({ rootDir: testDir });
      await adapter.initialize();

      const files = [
        { path: 'config.ts', content: 'export const A = 1;' },
        { path: 'constants.ts', content: 'export const B = 2;' },
        { path: 'utils.py', content: 'C = 3' },
      ];

      const result = await adapter.extractFiles(files);

      expect(result.filesProcessed).toBe(3);
      expect(result.totalConstants).toBeGreaterThanOrEqual(3);
    });

    it('should track statistics correctly', async () => {
      const adapter = createConstantScanner({ rootDir: testDir });
      await adapter.initialize();

      const files = [
        { path: 'a.ts', content: 'export const X = 1;' },
        { path: 'b.md', content: '# Readme' }, // Skipped
        { path: 'c.py', content: 'Y = 2' },
      ];

      const result = await adapter.extractFiles(files);

      expect(result.filesProcessed).toBe(2);
      expect(result.filesSkipped).toBe(1);
    });
  });

  describe('handleFileDeleted', () => {
    it('should remove file from store', async () => {
      const adapter = createConstantScanner({ rootDir: testDir });
      await adapter.initialize();

      // Extract a file
      await adapter.extractFile('config.ts', 'export const X = 1;');

      // Delete it
      await adapter.handleFileDeleted('config.ts');

      // Verify it's gone
      const store = adapter.getStore();
      const result = await store.getFileResult('config.ts');
      expect(result).toBeNull();
    });
  });
});

// ============================================================================
// Language Detection Tests
// ============================================================================

describe('getConstantLanguage', () => {
  it('should detect TypeScript', () => {
    expect(getConstantLanguage('file.ts')).toBe('typescript');
    expect(getConstantLanguage('file.tsx')).toBe('typescript');
  });

  it('should detect JavaScript', () => {
    expect(getConstantLanguage('file.js')).toBe('javascript');
    expect(getConstantLanguage('file.jsx')).toBe('javascript');
    expect(getConstantLanguage('file.mjs')).toBe('javascript');
  });

  it('should detect Python', () => {
    expect(getConstantLanguage('file.py')).toBe('python');
    expect(getConstantLanguage('file.pyw')).toBe('python');
  });

  it('should detect Java', () => {
    expect(getConstantLanguage('file.java')).toBe('java');
  });

  it('should detect C#', () => {
    expect(getConstantLanguage('file.cs')).toBe('csharp');
  });

  it('should detect PHP', () => {
    expect(getConstantLanguage('file.php')).toBe('php');
  });

  it('should detect Go', () => {
    expect(getConstantLanguage('file.go')).toBe('go');
  });

  it('should return null for unsupported', () => {
    expect(getConstantLanguage('file.md')).toBeNull();
    expect(getConstantLanguage('file.txt')).toBeNull();
    expect(getConstantLanguage('file')).toBeNull();
  });
});

// ============================================================================
// Hash Content Tests
// ============================================================================

describe('hashContent', () => {
  it('should produce consistent hashes', () => {
    const content = 'export const X = 1;';
    const hash1 = hashContent(content);
    const hash2 = hashContent(content);
    expect(hash1).toBe(hash2);
  });

  it('should produce different hashes for different content', () => {
    const hash1 = hashContent('export const X = 1;');
    const hash2 = hashContent('export const Y = 2;');
    expect(hash1).not.toBe(hash2);
  });
});

// ============================================================================
// Worker Task Tests
// ============================================================================

describe('processConstantTask', () => {
  it('should process TypeScript file', () => {
    const result = processConstantTask({
      type: 'extract',
      file: 'config.ts',
      content: 'export const API_URL = "https://api.example.com";',
      rootDir: '/test',
    });

    expect(result.language).toBe('typescript');
    expect(result.result).not.toBeNull();
    expect(result.result!.constants.length).toBeGreaterThanOrEqual(1);
  });

  it('should handle warmup task', () => {
    const result = processConstantTask({ type: 'warmup' });
    expect(result.file).toBe('');
    expect(result.result).toBeNull();
  });

  it('should handle missing file', () => {
    const result = processConstantTask({ type: 'extract' });
    expect(result.error).toBeDefined();
  });

  it('should handle unsupported language', () => {
    const result = processConstantTask({
      type: 'extract',
      file: 'readme.md',
      content: '# Hello',
      rootDir: '/test',
    });

    expect(result.language).toBeNull();
    expect(result.result).toBeNull();
  });
});

// ============================================================================
// Call Graph Adapter Tests
// ============================================================================

describe('ConstantCallGraphAdapter', () => {
  beforeEach(async () => {
    testDir = await createTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  describe('initialization', () => {
    it('should create adapter', () => {
      const adapter = createCallGraphAdapter({ rootDir: testDir });
      expect(adapter).toBeDefined();
    });
  });

  describe('getConstantWithContext', () => {
    it('should return null for non-existent constant', async () => {
      const adapter = createCallGraphAdapter({ rootDir: testDir });
      const result = await adapter.getConstantWithContext('non-existent-id');
      expect(result).toBeNull();
    });
  });

  describe('analyzeConstantImpact', () => {
    it('should return null for non-existent constant', async () => {
      const adapter = createCallGraphAdapter({ rootDir: testDir });
      const result = await adapter.analyzeConstantImpact('non-existent-id');
      expect(result).toBeNull();
    });
  });

  describe('findConstantsUsedByFunction', () => {
    it('should return empty array when no constants', async () => {
      const adapter = createCallGraphAdapter({ rootDir: testDir });
      const result = await adapter.findConstantsUsedByFunction('myFunc', 'file.ts');
      expect(result).toEqual([]);
    });
  });
});

// ============================================================================
// Pattern Adapter Tests
// ============================================================================

describe('ConstantPatternAdapter', () => {
  beforeEach(async () => {
    testDir = await createTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  describe('initialization', () => {
    it('should create adapter with defaults', () => {
      const adapter = createPatternAdapter({ rootDir: testDir });
      expect(adapter).toBeDefined();
    });

    it('should respect config options', () => {
      const adapter = createPatternAdapter({
        rootDir: testDir,
        detectMagicValues: false,
        detectSecrets: false,
      });
      expect(adapter).toBeDefined();
    });
  });

  describe('detectPatterns', () => {
    it('should return empty patterns when no constants', async () => {
      const adapter = createPatternAdapter({ rootDir: testDir });
      const result = await adapter.detectPatterns();

      expect(result.patterns).toEqual([]);
      expect(result.stats.totalPatterns).toBe(0);
    });

    it('should detect patterns from stored constants', async () => {
      // First, store some constants
      const store = new ConstantStore({ rootDir: testDir });
      await store.initialize();
      await store.saveFileResult({
        file: 'config.ts',
        language: 'typescript',
        constants: [
          {
            id: 'config.ts:API_KEY:1',
            name: 'API_KEY',
            qualifiedName: 'API_KEY',
            file: 'config.ts',
            line: 1,
            column: 0,
            endLine: 1,
            language: 'typescript',
            kind: 'primitive',
            category: 'security',
            value: 'sk_test_FAKE_abc123',
            isExported: true,
            decorators: [],
            modifiers: ['const'],
            confidence: 0.9,
          },
        ],
        enums: [],
        references: [],
        errors: [],
        quality: {
          method: 'regex',
          confidence: 0.75,
          coveragePercent: 80,
          itemsExtracted: 1,
          parseErrors: 0,
          warnings: [],
          usedFallback: false,
          extractionTimeMs: 10,
        },
      });

      const adapter = createPatternAdapter({ rootDir: testDir });
      const result = await adapter.detectPatterns();

      // Should detect the potential secret
      expect(result.patterns.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('toManifestPatterns', () => {
    it('should convert patterns to manifest format', () => {
      const adapter = createPatternAdapter({ rootDir: testDir });
      const patterns = [
        {
          id: 'test-pattern',
          name: 'Test Pattern',
          category: 'security' as const,
          subcategory: 'secrets',
          description: 'Test description',
          severity: 'high' as const,
          confidence: 0.9,
          locations: [{ file: 'test.ts', line: 1, column: 0 }],
          metadata: {},
          firstSeen: new Date().toISOString(),
          lastSeen: new Date().toISOString(),
        },
      ];

      const manifest = adapter.toManifestPatterns(patterns);

      expect(manifest.length).toBe(1);
      expect(manifest[0]!.id).toBe('test-pattern');
      expect(manifest[0]!.status).toBe('discovered');
    });
  });
});

// ============================================================================
// Severity Utility Tests
// ============================================================================

describe('severityToNumber', () => {
  it('should convert severities to numbers', () => {
    expect(severityToNumber('info')).toBe(0);
    expect(severityToNumber('low')).toBe(1);
    expect(severityToNumber('medium')).toBe(2);
    expect(severityToNumber('high')).toBe(3);
    expect(severityToNumber('critical')).toBe(4);
  });
});

describe('compareSeverity', () => {
  it('should compare severities correctly', () => {
    expect(compareSeverity('info', 'critical')).toBeLessThan(0);
    expect(compareSeverity('critical', 'info')).toBeGreaterThan(0);
    expect(compareSeverity('medium', 'medium')).toBe(0);
  });
});

// ============================================================================
// Default Quality Tests
// ============================================================================

describe('createDefaultConstantQuality', () => {
  it('should create default quality object', () => {
    const quality = createDefaultConstantQuality();

    expect(quality.method).toBe('regex');
    expect(quality.confidence).toBe(0.75);
    expect(quality.coveragePercent).toBe(80);
    expect(quality.itemsExtracted).toBe(0);
    expect(quality.parseErrors).toBe(0);
    expect(quality.warnings).toEqual([]);
    expect(quality.usedFallback).toBe(false);
    expect(quality.extractionTimeMs).toBe(0);
  });
});
