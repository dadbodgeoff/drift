/**
 * Unit tests for LockFileManager
 *
 * Tests lock file generation, persistence, and validation.
 *
 * @requirements 4.7 - THE drift.lock file SHALL contain a snapshot of approved patterns for version control
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  LockFileManager,
  LockFileError,
  LockFileValidationError,
} from './lock-file-manager.js';
import type {
  Pattern,
  LockFile,
  PatternCategory,
} from './types.js';

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Create a test pattern with default values
 */
function createTestPattern(overrides: Partial<Pattern> = {}): Pattern {
  const now = new Date().toISOString();
  return {
    id: `test-pattern-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    category: 'structural',
    subcategory: 'file-naming',
    name: 'Test Pattern',
    description: 'A test pattern for unit testing',
    detector: {
      type: 'regex',
      config: { pattern: '.*\\.test\\.ts$' },
    },
    confidence: {
      frequency: 0.9,
      consistency: 0.85,
      age: 30,
      spread: 10,
      score: 0.87,
      level: 'high',
    },
    locations: [
      { file: 'src/test.ts', line: 1, column: 1 },
    ],
    outliers: [],
    metadata: {
      firstSeen: now,
      lastSeen: now,
    },
    severity: 'warning',
    autoFixable: false,
    status: 'approved',
    ...overrides,
  };
}

describe('LockFileManager', () => {
  let manager: LockFileManager;
  let testDir: string;

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'drift-lock-file-test-'));
    manager = new LockFileManager({ rootDir: testDir });
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  // ==========================================================================
  // Lock File Generation Tests
  // ==========================================================================

  describe('generateLockFile()', () => {
    /**
     * @requirements 4.7 - Snapshot approved patterns
     */
    it('should generate a lock file from approved patterns', () => {
      const patterns = [
        createTestPattern({ id: 'pattern-1', name: 'Pattern 1' }),
        createTestPattern({ id: 'pattern-2', name: 'Pattern 2' }),
      ];

      const lockFile = manager.generateLockFile(patterns);

      expect(lockFile.version).toBe('1.0.0');
      expect(lockFile.patterns).toHaveLength(2);
      expect(lockFile.generatedAt).toBeDefined();
      expect(lockFile.checksum).toBeDefined();
    });

    it('should include correct pattern information in lock file', () => {
      const pattern = createTestPattern({
        id: 'test-pattern',
        category: 'components',
        name: 'Component Pattern',
        severity: 'error',
        confidence: {
          frequency: 0.9,
          consistency: 0.85,
          age: 30,
          spread: 10,
          score: 0.92,
          level: 'high',
        },
      });

      const lockFile = manager.generateLockFile([pattern]);

      expect(lockFile.patterns[0].id).toBe('test-pattern');
      expect(lockFile.patterns[0].category).toBe('components');
      expect(lockFile.patterns[0].name).toBe('Component Pattern');
      expect(lockFile.patterns[0].severity).toBe('error');
      expect(lockFile.patterns[0].confidenceScore).toBe(0.92);
      expect(lockFile.patterns[0].definitionHash).toBeDefined();
      expect(lockFile.patterns[0].lockedAt).toBeDefined();
    });

    it('should generate empty lock file for no patterns', () => {
      const lockFile = manager.generateLockFile([]);

      expect(lockFile.patterns).toHaveLength(0);
      expect(lockFile.checksum).toBeDefined();
    });

    /**
     * @requirements 4.7 - Version control friendly format
     */
    it('should sort patterns deterministically by category then id', () => {
      const patterns = [
        createTestPattern({ id: 'z-pattern', category: 'api' }),
        createTestPattern({ id: 'a-pattern', category: 'structural' }),
        createTestPattern({ id: 'b-pattern', category: 'api' }),
        createTestPattern({ id: 'm-pattern', category: 'components' }),
      ];

      const lockFile = manager.generateLockFile(patterns);

      // Should be sorted by category first, then by id
      expect(lockFile.patterns[0].id).toBe('b-pattern'); // api
      expect(lockFile.patterns[1].id).toBe('z-pattern'); // api
      expect(lockFile.patterns[2].id).toBe('m-pattern'); // components
      expect(lockFile.patterns[3].id).toBe('a-pattern'); // structural
    });

    it('should generate consistent hash for same pattern', () => {
      const pattern = createTestPattern({ id: 'consistent-pattern' });

      const lockFile1 = manager.generateLockFile([pattern]);
      const lockFile2 = manager.generateLockFile([pattern]);

      expect(lockFile1.patterns[0].definitionHash).toBe(lockFile2.patterns[0].definitionHash);
    });

    it('should generate different hash for modified pattern', () => {
      const pattern1 = createTestPattern({ id: 'pattern', name: 'Original Name' });
      const pattern2 = createTestPattern({ id: 'pattern', name: 'Modified Name' });

      const lockFile1 = manager.generateLockFile([pattern1]);
      const lockFile2 = manager.generateLockFile([pattern2]);

      expect(lockFile1.patterns[0].definitionHash).not.toBe(lockFile2.patterns[0].definitionHash);
    });
  });

  // ==========================================================================
  // Lock File Persistence Tests
  // ==========================================================================

  describe('save() and load()', () => {
    it('should save lock file to disk', async () => {
      const patterns = [createTestPattern({ id: 'save-test' })];
      const lockFile = manager.generateLockFile(patterns);

      await manager.save(lockFile);

      const filePath = path.join(testDir, '.drift', 'drift.lock');
      const exists = await fs.access(filePath).then(() => true).catch(() => false);
      expect(exists).toBe(true);
    });

    it('should load lock file from disk', async () => {
      const patterns = [createTestPattern({ id: 'load-test', name: 'Load Test Pattern' })];
      const lockFile = manager.generateLockFile(patterns);
      await manager.save(lockFile);

      const loaded = await manager.load();

      expect(loaded).not.toBeNull();
      expect(loaded!.version).toBe(lockFile.version);
      expect(loaded!.patterns).toHaveLength(1);
      expect(loaded!.patterns[0].id).toBe('load-test');
      expect(loaded!.patterns[0].name).toBe('Load Test Pattern');
      expect(loaded!.checksum).toBe(lockFile.checksum);
    });

    it('should return null when lock file does not exist', async () => {
      const loaded = await manager.load();
      expect(loaded).toBeNull();
    });

    it('should create .drift directory if it does not exist', async () => {
      const patterns = [createTestPattern()];
      const lockFile = manager.generateLockFile(patterns);

      await manager.save(lockFile);

      const driftDir = path.join(testDir, '.drift');
      const exists = await fs.access(driftDir).then(() => true).catch(() => false);
      expect(exists).toBe(true);
    });

    /**
     * @requirements 4.7 - Version control friendly format
     */
    it('should format lock file with consistent indentation', async () => {
      const patterns = [createTestPattern({ id: 'format-test' })];
      const lockFile = manager.generateLockFile(patterns);
      await manager.save(lockFile);

      const filePath = path.join(testDir, '.drift', 'drift.lock');
      const content = await fs.readFile(filePath, 'utf-8');

      // Should be formatted with 2-space indentation
      expect(content).toContain('  "version"');
      expect(content).toContain('  "patterns"');
      // Should end with newline
      expect(content.endsWith('\n')).toBe(true);
    });

    it('should throw LockFileError on invalid JSON', async () => {
      const filePath = path.join(testDir, '.drift', 'drift.lock');
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, 'invalid json content');

      await expect(manager.load()).rejects.toThrow(LockFileError);
    });

    it('should throw LockFileError on missing required fields', async () => {
      const filePath = path.join(testDir, '.drift', 'drift.lock');
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, JSON.stringify({ version: '1.0.0' }));

      await expect(manager.load()).rejects.toThrow(LockFileError);
    });
  });

  describe('exists()', () => {
    it('should return false when lock file does not exist', async () => {
      expect(await manager.exists()).toBe(false);
    });

    it('should return true when lock file exists', async () => {
      const lockFile = manager.generateLockFile([createTestPattern()]);
      await manager.save(lockFile);

      expect(await manager.exists()).toBe(true);
    });
  });

  describe('delete()', () => {
    it('should delete existing lock file', async () => {
      const lockFile = manager.generateLockFile([createTestPattern()]);
      await manager.save(lockFile);

      const result = await manager.delete();

      expect(result).toBe(true);
      expect(await manager.exists()).toBe(false);
    });

    it('should return false when lock file does not exist', async () => {
      const result = await manager.delete();
      expect(result).toBe(false);
    });
  });

  // ==========================================================================
  // Lock File Integrity Tests
  // ==========================================================================

  describe('verifyIntegrity()', () => {
    it('should return true for valid lock file', () => {
      const patterns = [createTestPattern()];
      const lockFile = manager.generateLockFile(patterns);

      expect(manager.verifyIntegrity(lockFile)).toBe(true);
    });

    it('should return false for tampered lock file', () => {
      const patterns = [createTestPattern()];
      const lockFile = manager.generateLockFile(patterns);

      // Tamper with the lock file
      lockFile.patterns[0].name = 'Tampered Name';

      expect(manager.verifyIntegrity(lockFile)).toBe(false);
    });

    it('should return false for modified checksum', () => {
      const patterns = [createTestPattern()];
      const lockFile = manager.generateLockFile(patterns);

      // Modify checksum
      lockFile.checksum = 'invalid-checksum';

      expect(manager.verifyIntegrity(lockFile)).toBe(false);
    });
  });

  // ==========================================================================
  // Lock File Comparison Tests
  // ==========================================================================

  describe('compare()', () => {
    it('should return isMatch true when patterns match', () => {
      const patterns = [
        createTestPattern({ id: 'pattern-1' }),
        createTestPattern({ id: 'pattern-2' }),
      ];
      const lockFile = manager.generateLockFile(patterns);

      const result = manager.compare(lockFile, patterns);

      expect(result.isMatch).toBe(true);
      expect(result.differences).toHaveLength(0);
      expect(result.lockedCount).toBe(2);
      expect(result.currentCount).toBe(2);
    });

    it('should detect added patterns', () => {
      const originalPatterns = [createTestPattern({ id: 'original' })];
      const lockFile = manager.generateLockFile(originalPatterns);

      const currentPatterns = [
        createTestPattern({ id: 'original' }),
        createTestPattern({ id: 'new-pattern', name: 'New Pattern' }),
      ];

      const result = manager.compare(lockFile, currentPatterns);

      expect(result.isMatch).toBe(false);
      expect(result.differences).toHaveLength(1);
      expect(result.differences[0].type).toBe('added');
      expect(result.differences[0].patternId).toBe('new-pattern');
    });

    it('should detect removed patterns', () => {
      const originalPatterns = [
        createTestPattern({ id: 'pattern-1' }),
        createTestPattern({ id: 'pattern-2' }),
      ];
      const lockFile = manager.generateLockFile(originalPatterns);

      const currentPatterns = [createTestPattern({ id: 'pattern-1' })];

      const result = manager.compare(lockFile, currentPatterns);

      expect(result.isMatch).toBe(false);
      expect(result.differences).toHaveLength(1);
      expect(result.differences[0].type).toBe('removed');
      expect(result.differences[0].patternId).toBe('pattern-2');
    });

    it('should detect modified patterns (definition change)', () => {
      const originalPattern = createTestPattern({
        id: 'pattern-1',
        name: 'Original Name',
      });
      const lockFile = manager.generateLockFile([originalPattern]);

      const modifiedPattern = createTestPattern({
        id: 'pattern-1',
        name: 'Modified Name',
      });

      const result = manager.compare(lockFile, [modifiedPattern]);

      expect(result.isMatch).toBe(false);
      const modifiedDiff = result.differences.find(d => d.details === 'Pattern definition has changed');
      expect(modifiedDiff).toBeDefined();
      expect(modifiedDiff!.type).toBe('modified');
      expect(modifiedDiff!.patternId).toBe('pattern-1');
    });

    it('should detect modified patterns (severity change)', () => {
      const originalPattern = createTestPattern({
        id: 'pattern-1',
        severity: 'warning',
      });
      const lockFile = manager.generateLockFile([originalPattern]);

      const modifiedPattern = createTestPattern({
        id: 'pattern-1',
        severity: 'error',
      });

      const result = manager.compare(lockFile, [modifiedPattern]);

      expect(result.isMatch).toBe(false);
      const severityDiff = result.differences.find(d => d.details === 'Severity has changed');
      expect(severityDiff).toBeDefined();
      expect(severityDiff!.previousValue).toBe('warning');
      expect(severityDiff!.currentValue).toBe('error');
    });

    it('should detect significant confidence changes (>10%)', () => {
      const originalPattern = createTestPattern({
        id: 'pattern-1',
        confidence: {
          frequency: 0.9,
          consistency: 0.9,
          age: 30,
          spread: 10,
          score: 0.9,
          level: 'high',
        },
      });
      const lockFile = manager.generateLockFile([originalPattern]);

      const modifiedPattern = createTestPattern({
        id: 'pattern-1',
        confidence: {
          frequency: 0.7,
          consistency: 0.7,
          age: 30,
          spread: 10,
          score: 0.7, // 20% change
          level: 'medium',
        },
      });

      const result = manager.compare(lockFile, [modifiedPattern]);

      expect(result.isMatch).toBe(false);
      const confidenceDiff = result.differences.find(d => d.details === 'Confidence score has changed significantly');
      expect(confidenceDiff).toBeDefined();
    });

    it('should not flag minor confidence changes (<=10%)', () => {
      const originalPattern = createTestPattern({
        id: 'pattern-1',
        confidence: {
          frequency: 0.9,
          consistency: 0.9,
          age: 30,
          spread: 10,
          score: 0.9,
          level: 'high',
        },
      });
      const lockFile = manager.generateLockFile([originalPattern]);

      const modifiedPattern = createTestPattern({
        id: 'pattern-1',
        confidence: {
          frequency: 0.85,
          consistency: 0.85,
          age: 30,
          spread: 10,
          score: 0.85, // 5% change
          level: 'high',
        },
      });

      const result = manager.compare(lockFile, [modifiedPattern]);

      const confidenceDiff = result.differences.find(d => d.details === 'Confidence score has changed significantly');
      expect(confidenceDiff).toBeUndefined();
    });

    it('should sort differences by type then by id', () => {
      const originalPatterns = [
        createTestPattern({ id: 'removed-b' }),
        createTestPattern({ id: 'removed-a' }),
        createTestPattern({ id: 'modified', name: 'Original' }),
      ];
      const lockFile = manager.generateLockFile(originalPatterns);

      const currentPatterns = [
        createTestPattern({ id: 'added-b' }),
        createTestPattern({ id: 'added-a' }),
        createTestPattern({ id: 'modified', name: 'Changed' }),
      ];

      const result = manager.compare(lockFile, currentPatterns);

      // Should be sorted: removed first, then added, then modified
      // Within each type, sorted by id
      expect(result.differences[0].type).toBe('removed');
      expect(result.differences[0].patternId).toBe('removed-a');
      expect(result.differences[1].type).toBe('removed');
      expect(result.differences[1].patternId).toBe('removed-b');
      expect(result.differences[2].type).toBe('added');
      expect(result.differences[2].patternId).toBe('added-a');
      expect(result.differences[3].type).toBe('added');
      expect(result.differences[3].patternId).toBe('added-b');
    });
  });

  // ==========================================================================
  // Lock File Validation Tests
  // ==========================================================================

  describe('validate()', () => {
    it('should not throw when patterns match', () => {
      const patterns = [createTestPattern({ id: 'pattern-1' })];
      const lockFile = manager.generateLockFile(patterns);

      expect(() => manager.validate(lockFile, patterns)).not.toThrow();
    });

    it('should throw LockFileValidationError when patterns differ', () => {
      const originalPatterns = [createTestPattern({ id: 'original' })];
      const lockFile = manager.generateLockFile(originalPatterns);

      const currentPatterns = [createTestPattern({ id: 'different' })];

      expect(() => manager.validate(lockFile, currentPatterns)).toThrow(LockFileValidationError);
    });

    it('should include differences in validation error', () => {
      const originalPatterns = [createTestPattern({ id: 'original' })];
      const lockFile = manager.generateLockFile(originalPatterns);

      const currentPatterns = [createTestPattern({ id: 'different' })];

      try {
        manager.validate(lockFile, currentPatterns);
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(LockFileValidationError);
        const validationError = error as LockFileValidationError;
        expect(validationError.differences.length).toBeGreaterThan(0);
      }
    });
  });

  // ==========================================================================
  // Convenience Method Tests
  // ==========================================================================

  describe('generateAndSave()', () => {
    it('should generate and save lock file in one call', async () => {
      const patterns = [createTestPattern({ id: 'convenience-test' })];

      const lockFile = await manager.generateAndSave(patterns);

      expect(lockFile.patterns).toHaveLength(1);
      expect(await manager.exists()).toBe(true);

      const loaded = await manager.load();
      expect(loaded!.patterns[0].id).toBe('convenience-test');
    });
  });

  describe('loadAndCompare()', () => {
    it('should load and compare in one call', async () => {
      const patterns = [createTestPattern({ id: 'compare-test' })];
      await manager.generateAndSave(patterns);

      const result = await manager.loadAndCompare(patterns);

      expect(result.isMatch).toBe(true);
    });

    it('should throw when lock file does not exist', async () => {
      const patterns = [createTestPattern()];

      await expect(manager.loadAndCompare(patterns)).rejects.toThrow(LockFileError);
    });
  });

  describe('loadAndValidate()', () => {
    it('should load and validate in one call', async () => {
      const patterns = [createTestPattern({ id: 'validate-test' })];
      await manager.generateAndSave(patterns);

      await expect(manager.loadAndValidate(patterns)).resolves.not.toThrow();
    });

    it('should throw when lock file does not exist', async () => {
      const patterns = [createTestPattern()];

      await expect(manager.loadAndValidate(patterns)).rejects.toThrow(LockFileError);
    });

    it('should throw when patterns differ', async () => {
      const originalPatterns = [createTestPattern({ id: 'original' })];
      await manager.generateAndSave(originalPatterns);

      const currentPatterns = [createTestPattern({ id: 'different' })];

      await expect(manager.loadAndValidate(currentPatterns)).rejects.toThrow(LockFileValidationError);
    });
  });

  // ==========================================================================
  // Utility Method Tests
  // ==========================================================================

  describe('path', () => {
    it('should return correct lock file path', () => {
      expect(manager.path).toBe(path.join(testDir, '.drift', 'drift.lock'));
    });
  });

  describe('getSummary()', () => {
    it('should return correct summary', () => {
      const patterns = [
        createTestPattern({ id: 'p1', category: 'structural' }),
        createTestPattern({ id: 'p2', category: 'structural' }),
        createTestPattern({ id: 'p3', category: 'components' }),
        createTestPattern({ id: 'p4', category: 'api' }),
      ];
      const lockFile = manager.generateLockFile(patterns);

      const summary = manager.getSummary(lockFile);

      expect(summary.version).toBe('1.0.0');
      expect(summary.patternCount).toBe(4);
      expect(summary.generatedAt).toBeDefined();
      expect(summary.categories.structural).toBe(2);
      expect(summary.categories.components).toBe(1);
      expect(summary.categories.api).toBe(1);
    });
  });

  // ==========================================================================
  // Round-Trip Tests
  // ==========================================================================

  describe('round-trip', () => {
    it('should preserve all data through save and load', async () => {
      const patterns = [
        createTestPattern({
          id: 'round-trip-1',
          category: 'structural',
          name: 'Round Trip Pattern 1',
          severity: 'error',
          confidence: {
            frequency: 0.95,
            consistency: 0.92,
            age: 45,
            spread: 15,
            score: 0.93,
            level: 'high',
          },
        }),
        createTestPattern({
          id: 'round-trip-2',
          category: 'components',
          name: 'Round Trip Pattern 2',
          severity: 'warning',
          confidence: {
            frequency: 0.75,
            consistency: 0.72,
            age: 20,
            spread: 8,
            score: 0.73,
            level: 'medium',
          },
        }),
      ];

      const originalLockFile = manager.generateLockFile(patterns);
      await manager.save(originalLockFile);
      const loadedLockFile = await manager.load();

      expect(loadedLockFile).not.toBeNull();
      expect(loadedLockFile!.version).toBe(originalLockFile.version);
      expect(loadedLockFile!.checksum).toBe(originalLockFile.checksum);
      expect(loadedLockFile!.generatedAt).toBe(originalLockFile.generatedAt);
      expect(loadedLockFile!.patterns).toHaveLength(originalLockFile.patterns.length);

      for (let i = 0; i < originalLockFile.patterns.length; i++) {
        const original = originalLockFile.patterns[i];
        const loaded = loadedLockFile!.patterns[i];
        expect(loaded.id).toBe(original.id);
        expect(loaded.category).toBe(original.category);
        expect(loaded.name).toBe(original.name);
        expect(loaded.severity).toBe(original.severity);
        expect(loaded.confidenceScore).toBe(original.confidenceScore);
        expect(loaded.definitionHash).toBe(original.definitionHash);
        expect(loaded.lockedAt).toBe(original.lockedAt);
      }
    });
  });
});
