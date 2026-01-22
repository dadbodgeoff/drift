/**
 * Unified File Pattern Repository Tests
 *
 * Tests for the Phase 3 unified storage implementation.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

import { UnifiedFilePatternRepository } from '../impl/unified-file-repository.js';
import type { Pattern, PatternCategory, PatternStatus } from '../types.js';
import { PatternNotFoundError, InvalidStatusTransitionError, PatternAlreadyExistsError } from '../errors.js';

// ============================================================================
// Test Helpers
// ============================================================================

function createTestPattern(overrides: Partial<Pattern> = {}): Pattern {
  const id = overrides.id || `test-pattern-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return {
    id,
    category: 'api',
    subcategory: 'rest',
    name: 'Test Pattern',
    description: 'A test pattern',
    status: 'discovered',
    detectorId: 'test-detector',
    detectorName: 'Test Detector',
    detectionMethod: 'ast',
    detector: {
      id: 'test-detector',
      name: 'Test Detector',
      version: '1.0.0',
    },
    confidence: 0.85,
    confidenceLevel: 'high',
    locations: [
      { file: 'src/test.ts', line: 10, column: 1 },
    ],
    outliers: [],
    severity: 'info',
    firstSeen: new Date().toISOString(),
    lastSeen: new Date().toISOString(),
    tags: [],
    autoFixable: false,
    metadata: {},
    ...overrides,
  };
}

async function createLegacyFormat(rootDir: string, patterns: Pattern[]): Promise<void> {
  const patternsDir = path.join(rootDir, '.drift', 'patterns');

  // Group by status and category
  const grouped = new Map<PatternStatus, Map<PatternCategory, Pattern[]>>();
  for (const status of ['discovered', 'approved', 'ignored'] as PatternStatus[]) {
    grouped.set(status, new Map());
  }

  for (const pattern of patterns) {
    if (!grouped.get(pattern.status)!.has(pattern.category)) {
      grouped.get(pattern.status)!.set(pattern.category, []);
    }
    grouped.get(pattern.status)!.get(pattern.category)!.push(pattern);
  }

  // Write legacy format files
  for (const [status, categories] of grouped.entries()) {
    const statusDir = path.join(patternsDir, status);
    await fs.mkdir(statusDir, { recursive: true });

    for (const [category, categoryPatterns] of categories.entries()) {
      if (categoryPatterns.length === 0) continue;

      const filePath = path.join(statusDir, `${category}.json`);
      const legacyFile = {
        version: '1.0.0',
        category,
        patterns: categoryPatterns.map(p => {
          const { category: _, status: __, ...rest } = p;
          return rest;
        }),
        lastUpdated: new Date().toISOString(),
      };
      await fs.writeFile(filePath, JSON.stringify(legacyFile, null, 2));
    }
  }
}

// ============================================================================
// Tests
// ============================================================================

describe('UnifiedFilePatternRepository', () => {
  let tempDir: string;
  let repository: UnifiedFilePatternRepository;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'drift-unified-test-'));
    repository = new UnifiedFilePatternRepository({
      rootDir: tempDir,
      autoSave: false,
      autoMigrate: false,
    });
  });

  afterEach(async () => {
    await repository.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('initialization', () => {
    it('should initialize empty repository', async () => {
      await repository.initialize();
      const patterns = await repository.getAll();
      expect(patterns).toHaveLength(0);
    });

    it('should create patterns directory', async () => {
      await repository.initialize();
      const patternsDir = path.join(tempDir, '.drift', 'patterns');
      const exists = await fs.access(patternsDir).then(() => true).catch(() => false);
      expect(exists).toBe(true);
    });
  });

  describe('CRUD operations', () => {
    beforeEach(async () => {
      await repository.initialize();
    });

    it('should add a pattern', async () => {
      const pattern = createTestPattern();
      await repository.add(pattern);

      const retrieved = await repository.get(pattern.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe(pattern.id);
      expect(retrieved!.name).toBe(pattern.name);
    });

    it('should throw when adding duplicate pattern', async () => {
      const pattern = createTestPattern();
      await repository.add(pattern);

      await expect(repository.add(pattern)).rejects.toThrow(PatternAlreadyExistsError);
    });

    it('should update a pattern', async () => {
      const pattern = createTestPattern();
      await repository.add(pattern);

      const updated = await repository.update(pattern.id, { name: 'Updated Name' });
      expect(updated.name).toBe('Updated Name');

      const retrieved = await repository.get(pattern.id);
      expect(retrieved!.name).toBe('Updated Name');
    });

    it('should throw when updating non-existent pattern', async () => {
      await expect(repository.update('non-existent', { name: 'Test' }))
        .rejects.toThrow(PatternNotFoundError);
    });

    it('should delete a pattern', async () => {
      const pattern = createTestPattern();
      await repository.add(pattern);

      const deleted = await repository.delete(pattern.id);
      expect(deleted).toBe(true);

      const retrieved = await repository.get(pattern.id);
      expect(retrieved).toBeNull();
    });

    it('should return false when deleting non-existent pattern', async () => {
      const deleted = await repository.delete('non-existent');
      expect(deleted).toBe(false);
    });
  });

  describe('querying', () => {
    beforeEach(async () => {
      await repository.initialize();

      // Add test patterns
      await repository.add(createTestPattern({ id: 'p1', category: 'api', status: 'discovered', confidence: 0.9 }));
      await repository.add(createTestPattern({ id: 'p2', category: 'api', status: 'approved', confidence: 0.8 }));
      await repository.add(createTestPattern({ id: 'p3', category: 'security', status: 'discovered', confidence: 0.7 }));
      await repository.add(createTestPattern({ id: 'p4', category: 'security', status: 'ignored', confidence: 0.6 }));
    });

    it('should get all patterns', async () => {
      const patterns = await repository.getAll();
      expect(patterns).toHaveLength(4);
    });

    it('should filter by category', async () => {
      const result = await repository.query({
        filter: { categories: ['api'] },
      });
      expect(result.patterns).toHaveLength(2);
      expect(result.patterns.every(p => p.category === 'api')).toBe(true);
    });

    it('should filter by status', async () => {
      const result = await repository.query({
        filter: { statuses: ['discovered'] },
      });
      expect(result.patterns).toHaveLength(2);
      expect(result.patterns.every(p => p.status === 'discovered')).toBe(true);
    });

    it('should filter by minimum confidence', async () => {
      const result = await repository.query({
        filter: { minConfidence: 0.8 },
      });
      expect(result.patterns).toHaveLength(2);
      expect(result.patterns.every(p => p.confidence >= 0.8)).toBe(true);
    });

    it('should sort by confidence descending', async () => {
      const result = await repository.query({
        sort: { field: 'confidence', direction: 'desc' },
      });
      expect(result.patterns[0].confidence).toBe(0.9);
      expect(result.patterns[3].confidence).toBe(0.6);
    });

    it('should paginate results', async () => {
      const result = await repository.query({
        pagination: { offset: 1, limit: 2 },
      });
      expect(result.patterns).toHaveLength(2);
      expect(result.total).toBe(4);
      expect(result.hasMore).toBe(true);
    });

    it('should get by category', async () => {
      const patterns = await repository.getByCategory('security');
      expect(patterns).toHaveLength(2);
    });

    it('should get by status', async () => {
      const patterns = await repository.getByStatus('approved');
      expect(patterns).toHaveLength(1);
    });

    it('should count patterns', async () => {
      const total = await repository.count();
      expect(total).toBe(4);

      const apiCount = await repository.count({ categories: ['api'] });
      expect(apiCount).toBe(2);
    });
  });

  describe('status transitions', () => {
    beforeEach(async () => {
      await repository.initialize();
    });

    it('should approve a discovered pattern', async () => {
      const pattern = createTestPattern({ status: 'discovered' });
      await repository.add(pattern);

      const approved = await repository.approve(pattern.id, 'test-user');
      expect(approved.status).toBe('approved');
      expect(approved.approvedBy).toBe('test-user');
      expect(approved.approvedAt).toBeDefined();
    });

    it('should ignore a discovered pattern', async () => {
      const pattern = createTestPattern({ status: 'discovered' });
      await repository.add(pattern);

      const ignored = await repository.ignore(pattern.id);
      expect(ignored.status).toBe('ignored');
    });

    it('should throw on invalid transition', async () => {
      const pattern = createTestPattern({ status: 'approved' });
      await repository.add(pattern);

      // Can't approve an already approved pattern
      await expect(repository.approve(pattern.id))
        .rejects.toThrow(InvalidStatusTransitionError);
    });
  });

  describe('persistence', () => {
    it('should save and load patterns', async () => {
      await repository.initialize();

      const pattern = createTestPattern({ category: 'api' });
      await repository.add(pattern);
      await repository.saveAll();

      // Create new repository instance
      const newRepo = new UnifiedFilePatternRepository({
        rootDir: tempDir,
        autoSave: false,
        autoMigrate: false,
      });
      await newRepo.initialize();

      const loaded = await newRepo.get(pattern.id);
      expect(loaded).not.toBeNull();
      expect(loaded!.id).toBe(pattern.id);
      expect(loaded!.category).toBe('api');
      expect(loaded!.status).toBe('discovered');

      await newRepo.close();
    });

    it('should save patterns in category-based files', async () => {
      await repository.initialize();

      await repository.add(createTestPattern({ id: 'api-1', category: 'api' }));
      await repository.add(createTestPattern({ id: 'sec-1', category: 'security' }));
      await repository.saveAll();

      // Check file structure
      const apiFile = path.join(tempDir, '.drift', 'patterns', 'api.json');
      const secFile = path.join(tempDir, '.drift', 'patterns', 'security.json');

      const apiExists = await fs.access(apiFile).then(() => true).catch(() => false);
      const secExists = await fs.access(secFile).then(() => true).catch(() => false);

      expect(apiExists).toBe(true);
      expect(secExists).toBe(true);

      // Verify file content
      const apiContent = JSON.parse(await fs.readFile(apiFile, 'utf-8'));
      expect(apiContent.version).toBe('2.0.0');
      expect(apiContent.category).toBe('api');
      expect(apiContent.patterns).toHaveLength(1);
      expect(apiContent.patterns[0].status).toBe('discovered');
    });

    it('should remove empty category files', async () => {
      await repository.initialize();

      const pattern = createTestPattern({ category: 'api' });
      await repository.add(pattern);
      await repository.saveAll();

      // Delete the pattern
      await repository.delete(pattern.id);
      await repository.saveAll();

      // File should be removed
      const apiFile = path.join(tempDir, '.drift', 'patterns', 'api.json');
      const exists = await fs.access(apiFile).then(() => true).catch(() => false);
      expect(exists).toBe(false);
    });
  });

  describe('migration from legacy format', () => {
    it('should migrate patterns from legacy status-based format', async () => {
      // Create legacy format
      const legacyPatterns = [
        createTestPattern({ id: 'legacy-1', category: 'api', status: 'discovered' }),
        createTestPattern({ id: 'legacy-2', category: 'api', status: 'approved' }),
        createTestPattern({ id: 'legacy-3', category: 'security', status: 'discovered' }),
      ];
      await createLegacyFormat(tempDir, legacyPatterns);

      // Create repository with auto-migrate
      const migratingRepo = new UnifiedFilePatternRepository({
        rootDir: tempDir,
        autoSave: false,
        autoMigrate: true,
        keepLegacyFiles: true,
      });
      await migratingRepo.initialize();

      // Verify patterns were migrated
      const patterns = await migratingRepo.getAll();
      expect(patterns).toHaveLength(3);

      const legacy1 = await migratingRepo.get('legacy-1');
      expect(legacy1).not.toBeNull();
      expect(legacy1!.category).toBe('api');
      expect(legacy1!.status).toBe('discovered');

      const legacy2 = await migratingRepo.get('legacy-2');
      expect(legacy2).not.toBeNull();
      expect(legacy2!.status).toBe('approved');

      await migratingRepo.close();
    });

    it('should preserve status during migration', async () => {
      const legacyPatterns = [
        createTestPattern({ id: 'p1', category: 'api', status: 'discovered' }),
        createTestPattern({ id: 'p2', category: 'api', status: 'approved' }),
        createTestPattern({ id: 'p3', category: 'api', status: 'ignored' }),
      ];
      await createLegacyFormat(tempDir, legacyPatterns);

      const migratingRepo = new UnifiedFilePatternRepository({
        rootDir: tempDir,
        autoSave: false,
        autoMigrate: true,
      });
      await migratingRepo.initialize();

      const discovered = await migratingRepo.getByStatus('discovered');
      const approved = await migratingRepo.getByStatus('approved');
      const ignored = await migratingRepo.getByStatus('ignored');

      expect(discovered).toHaveLength(1);
      expect(approved).toHaveLength(1);
      expect(ignored).toHaveLength(1);

      await migratingRepo.close();
    });
  });

  describe('storage stats', () => {
    beforeEach(async () => {
      await repository.initialize();
    });

    it('should return storage statistics', async () => {
      await repository.add(createTestPattern({ id: 'p1', category: 'api', status: 'discovered' }));
      await repository.add(createTestPattern({ id: 'p2', category: 'api', status: 'approved' }));
      await repository.add(createTestPattern({ id: 'p3', category: 'security', status: 'discovered' }));

      const stats = await repository.getStorageStats();

      expect(stats.totalPatterns).toBe(3);
      expect(stats.byCategory['api']).toBe(2);
      expect(stats.byCategory['security']).toBe(1);
      expect(stats.byStatus.discovered).toBe(2);
      expect(stats.byStatus.approved).toBe(1);
      expect(stats.byStatus.ignored).toBe(0);
      expect(stats.fileCount).toBe(2); // api.json and security.json
    });
  });

  describe('events', () => {
    beforeEach(async () => {
      await repository.initialize();
    });

    it('should emit pattern:added event', async () => {
      const events: Pattern[] = [];
      repository.on('pattern:added', (pattern) => events.push(pattern));

      const pattern = createTestPattern();
      await repository.add(pattern);

      expect(events).toHaveLength(1);
      expect(events[0].id).toBe(pattern.id);
    });

    it('should emit pattern:updated event', async () => {
      const events: Pattern[] = [];
      repository.on('pattern:updated', (pattern) => events.push(pattern));

      const pattern = createTestPattern();
      await repository.add(pattern);
      await repository.update(pattern.id, { name: 'Updated' });

      expect(events).toHaveLength(1);
      expect(events[0].name).toBe('Updated');
    });

    it('should emit pattern:approved event', async () => {
      const events: Pattern[] = [];
      repository.on('pattern:approved', (pattern) => events.push(pattern));

      const pattern = createTestPattern({ status: 'discovered' });
      await repository.add(pattern);
      await repository.approve(pattern.id);

      expect(events).toHaveLength(1);
      expect(events[0].status).toBe('approved');
    });
  });
});
