/**
 * Migration Stress Tests
 * 
 * Tests the JSON to SQLite migration path to ensure:
 * 1. All data is migrated correctly
 * 2. No data loss during migration
 * 3. Edge cases are handled
 * 4. Rollback/backup works
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { migrateFromJson, createUnifiedStore } from '../migration.js';
import { UnifiedStore } from '../unified-store.js';
import type { PatternFile } from '../../store/types.js';

// ============================================================================
// Test Utilities
// ============================================================================

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'drift-migration-test-'));
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

// ============================================================================
// Test Suite: Migration from JSON
// ============================================================================

describe('Migration Stress Tests', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
  });

  afterEach(() => {
    cleanupTempDir(tempDir);
  });

  describe('Pattern Migration', () => {
    it('should migrate patterns from legacy format', async () => {
      const driftDir = createDriftDir(tempDir);
      
      // Create legacy pattern structure
      const discoveredDir = path.join(driftDir, 'patterns', 'discovered');
      fs.mkdirSync(discoveredDir, { recursive: true });
      
      const patternFile: PatternFile = {
        version: '1.0.0',
        category: 'api',
        patterns: [
          {
            id: 'test-pattern-1',
            name: 'Test Pattern 1',
            description: 'A test pattern',
            confidence: { score: 0.85, level: 'high', frequency: 0.9, consistency: 0.8, age: 0.7, spread: 5 },
            detector: { type: 'ast', config: { language: 'typescript' } },
            severity: 'info',
            autoFixable: false,
            locations: [
              { file: 'src/test.ts', line: 10, column: 5 },
              { file: 'src/test.ts', line: 20, column: 10 },
            ],
            outliers: [
              { file: 'src/legacy.ts', line: 100, column: 1, reason: 'Deprecated' },
            ],
            metadata: {
              firstSeen: '2024-01-01T00:00:00.000Z',
              lastSeen: '2024-02-01T00:00:00.000Z',
              tags: ['test', 'api'],
            },
          },
        ],
        lastUpdated: new Date().toISOString(),
      };
      
      fs.writeFileSync(
        path.join(discoveredDir, 'api.json'),
        JSON.stringify(patternFile, null, 2)
      );

      // Run migration
      const result = await migrateFromJson({ rootDir: tempDir });

      expect(result.success).toBe(true);
      expect(result.patternsImported).toBe(1);
      expect(result.errors.length).toBe(0);

      // Verify data in SQLite
      const store = await createUnifiedStore({ rootDir: tempDir });
      const pattern = await store.patterns.read('test-pattern-1');
      
      expect(pattern).not.toBeNull();
      expect(pattern!.name).toBe('Test Pattern 1');
      expect(pattern!.confidence_score).toBe(0.85);
      
      const locations = await store.patterns.getLocations('test-pattern-1');
      expect(locations.length).toBe(2);
      
      const outliers = await store.patterns.getOutliers('test-pattern-1');
      expect(outliers.length).toBe(1);
      
      await store.close();
    });

    it('should migrate patterns from unified format (v2)', async () => {
      const driftDir = createDriftDir(tempDir);
      const patternsDir = path.join(driftDir, 'patterns');
      fs.mkdirSync(patternsDir, { recursive: true });
      
      const unifiedFile = {
        version: '2.0.0',
        category: 'security',
        patterns: [
          {
            id: 'unified-pattern-1',
            name: 'Unified Pattern',
            status: 'discovered',
            confidence: { score: 0.9, level: 'high' },
            locations: [{ file: 'src/auth.ts', line: 15 }],
            outliers: [],
            metadata: { firstSeen: new Date().toISOString(), lastSeen: new Date().toISOString() },
          },
        ],
      };
      
      fs.writeFileSync(
        path.join(patternsDir, 'security.json'),
        JSON.stringify(unifiedFile, null, 2)
      );

      const result = await migrateFromJson({ rootDir: tempDir });

      expect(result.success).toBe(true);
      expect(result.patternsImported).toBe(1);

      const store = await createUnifiedStore({ rootDir: tempDir });
      const pattern = await store.patterns.read('unified-pattern-1');
      expect(pattern).not.toBeNull();
      expect(pattern!.category).toBe('security');
      await store.close();
    });

    it('should handle empty patterns directory', async () => {
      const driftDir = createDriftDir(tempDir);
      fs.mkdirSync(path.join(driftDir, 'patterns'), { recursive: true });

      const result = await migrateFromJson({ rootDir: tempDir });

      expect(result.success).toBe(true);
      expect(result.patternsImported).toBe(0);
    });

    it('should correctly read detectionMethod field (not detector.type)', async () => {
      // This test verifies the fix for the telemetry bug where detector_type
      // was incorrectly reading from detector.type instead of detectionMethod
      const driftDir = createDriftDir(tempDir);
      const discoveredDir = path.join(driftDir, 'patterns', 'discovered');
      fs.mkdirSync(discoveredDir, { recursive: true });
      
      const patternFile: PatternFile = {
        version: '1.0.0',
        category: 'api',
        patterns: [
          {
            id: 'detection-method-test',
            name: 'Detection Method Test',
            description: 'Tests detectionMethod field priority',
            subcategory: 'test',
            confidence: { score: 0.9, level: 'high', frequency: 0.9, consistency: 0.9, age: 0.5, spread: 3 },
            // This is the key test: detector.type says 'regex' but detectionMethod says 'ast'
            // The migration should use 'ast' (from detectionMethod), not 'regex' (from detector.type)
            detector: { type: 'regex', config: {} },
            detectionMethod: 'ast', // This should take priority
            severity: 'info',
            autoFixable: false,
            locations: [{ file: 'src/test.ts', line: 10, column: 5 }],
            outliers: [],
            metadata: { firstSeen: new Date().toISOString(), lastSeen: new Date().toISOString() },
          } as any, // Cast to any because detectionMethod is not in the type but exists in real data
        ],
        lastUpdated: new Date().toISOString(),
      };
      
      fs.writeFileSync(
        path.join(discoveredDir, 'api.json'),
        JSON.stringify(patternFile, null, 2)
      );

      const result = await migrateFromJson({ rootDir: tempDir });

      expect(result.success).toBe(true);
      expect(result.patternsImported).toBe(1);

      // Verify the detector_type is 'ast' (from detectionMethod), not 'regex' (from detector.type)
      const store = await createUnifiedStore({ rootDir: tempDir });
      const pattern = await store.patterns.read('detection-method-test');
      
      expect(pattern).not.toBeNull();
      expect(pattern!.detector_type).toBe('ast'); // Should be 'ast', not 'regex'
      
      await store.close();
    });

    it('should handle malformed JSON gracefully', async () => {
      const driftDir = createDriftDir(tempDir);
      const discoveredDir = path.join(driftDir, 'patterns', 'discovered');
      fs.mkdirSync(discoveredDir, { recursive: true });
      
      // Write malformed JSON
      fs.writeFileSync(path.join(discoveredDir, 'api.json'), '{ invalid json }');

      const result = await migrateFromJson({ rootDir: tempDir });

      expect(result.success).toBe(true); // Should continue despite errors
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe('Constraint Migration', () => {
    it('should migrate constraints', async () => {
      const driftDir = createDriftDir(tempDir);
      const constraintsDir = path.join(driftDir, 'constraints', 'discovered');
      fs.mkdirSync(constraintsDir, { recursive: true });
      
      const constraint = {
        id: 'constraint-1',
        name: 'No Raw SQL',
        description: 'Prevent raw SQL queries',
        category: 'security',
        language: 'typescript',
        invariant: { type: 'no-raw-sql' },
        enforcement: { level: 'error', message: 'Use parameterized queries' },
        confidence: { score: 0.9, evidence: 10, violations: 2 },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      
      fs.writeFileSync(
        path.join(constraintsDir, 'constraint-1.json'),
        JSON.stringify(constraint, null, 2)
      );

      const result = await migrateFromJson({ rootDir: tempDir });

      expect(result.success).toBe(true);
      expect(result.constraintsImported).toBe(1);

      const store = await createUnifiedStore({ rootDir: tempDir });
      const retrieved = await store.constraints.read('constraint-1');
      expect(retrieved).not.toBeNull();
      expect(retrieved!.name).toBe('No Raw SQL');
      await store.close();
    });
  });

  describe('Boundary Migration', () => {
    it('should migrate boundaries from access-map.json', async () => {
      const driftDir = createDriftDir(tempDir);
      const boundariesDir = path.join(driftDir, 'boundaries');
      fs.mkdirSync(boundariesDir, { recursive: true });
      
      const accessMap = {
        tables: {
          users: {
            model: {
              name: 'User',
              file: 'src/models/user.ts',
              line: 10,
              framework: 'prisma',
            },
            fields: ['id', 'email', 'password_hash'],
            sensitiveFields: [
              { field: 'password_hash', sensitivity: 'auth', reason: 'Password hash' },
              { field: 'email', sensitivity: 'pii', reason: 'Personal email' },
            ],
            accessPoints: [
              {
                id: 'ap-1',
                operation: 'read',
                file: 'src/services/user.ts',
                line: 25,
                fields: ['id', 'email'],
              },
            ],
          },
        },
      };
      
      fs.writeFileSync(
        path.join(boundariesDir, 'access-map.json'),
        JSON.stringify(accessMap, null, 2)
      );

      const result = await migrateFromJson({ rootDir: tempDir });

      expect(result.success).toBe(true);
      expect(result.boundariesImported).toBe(1);

      const store = await createUnifiedStore({ rootDir: tempDir });
      const model = await store.boundaries.getModelByTable('users');
      expect(model).not.toBeNull();
      expect(model!.framework).toBe('prisma');
      
      const sensitiveFields = await store.boundaries.getSensitiveFields('users');
      expect(sensitiveFields.length).toBe(2);
      
      const accessPoints = await store.boundaries.getAccessPoints('users');
      expect(accessPoints.length).toBe(1);
      
      await store.close();
    });
  });

  describe('Environment Migration', () => {
    it('should migrate environment variables', async () => {
      const driftDir = createDriftDir(tempDir);
      const envDir = path.join(driftDir, 'environment');
      fs.mkdirSync(envDir, { recursive: true });
      
      const variables = {
        variables: {
          DATABASE_URL: {
            sensitivity: 'credential',
            hasDefault: false,
            isRequired: true,
            accessPoints: [
              {
                id: 'env-ap-1',
                method: 'process.env',
                file: 'src/config.ts',
                line: 5,
                language: 'typescript',
              },
            ],
          },
          NODE_ENV: {
            sensitivity: 'config',
            hasDefault: true,
            defaultValue: 'development',
            isRequired: false,
          },
        },
      };
      
      fs.writeFileSync(
        path.join(envDir, 'variables.json'),
        JSON.stringify(variables, null, 2)
      );

      const result = await migrateFromJson({ rootDir: tempDir });

      expect(result.success).toBe(true);
      expect(result.envVariablesImported).toBe(2);

      const store = await createUnifiedStore({ rootDir: tempDir });
      const dbUrl = await store.environment.getVariable('DATABASE_URL');
      expect(dbUrl).not.toBeNull();
      expect(dbUrl!.sensitivity).toBe('credential');
      
      const accessPoints = await store.environment.getAccessPoints('DATABASE_URL');
      expect(accessPoints.length).toBe(1);
      
      await store.close();
    });
  });

  describe('Dry Run Mode', () => {
    it('should not modify database in dry run mode', async () => {
      const driftDir = createDriftDir(tempDir);
      const discoveredDir = path.join(driftDir, 'patterns', 'discovered');
      fs.mkdirSync(discoveredDir, { recursive: true });
      
      const patternFile: PatternFile = {
        version: '1.0.0',
        category: 'api',
        patterns: [
          {
            id: 'dry-run-pattern',
            name: 'Dry Run Pattern',
            confidence: { score: 0.5, level: 'medium', frequency: 0, consistency: 0, age: 0, spread: 0 },
            detector: { type: 'ast', config: {} },
            severity: 'info',
            autoFixable: false,
            locations: [],
            outliers: [],
            metadata: { firstSeen: new Date().toISOString(), lastSeen: new Date().toISOString() },
          },
        ],
        lastUpdated: new Date().toISOString(),
      };
      
      fs.writeFileSync(
        path.join(discoveredDir, 'api.json'),
        JSON.stringify(patternFile, null, 2)
      );

      const result = await migrateFromJson({ rootDir: tempDir, dryRun: true });

      expect(result.success).toBe(true);
      expect(result.patternsImported).toBe(1);

      // Verify no database was created
      const dbPath = path.join(driftDir, 'drift.db');
      expect(fs.existsSync(dbPath)).toBe(false);
    });
  });

  describe('Progress Callback', () => {
    it('should call progress callback during migration', async () => {
      const driftDir = createDriftDir(tempDir);
      fs.mkdirSync(path.join(driftDir, 'patterns'), { recursive: true });

      const progressCalls: Array<{ message: string; current: number; total: number }> = [];

      await migrateFromJson({
        rootDir: tempDir,
        onProgress: (message, current, total) => {
          progressCalls.push({ message, current, total });
        },
      });

      expect(progressCalls.length).toBeGreaterThan(0);
      expect(progressCalls[progressCalls.length - 1].message).toBe('Migration complete');
    });
  });

  describe('Error Handling', () => {
    it('should handle missing drift directory', async () => {
      const result = await migrateFromJson({ rootDir: tempDir });

      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('Drift directory not found');
    });
  });
});
