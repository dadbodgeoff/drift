/**
 * Variant Manager Tests
 *
 * Tests for the VariantManager class that manages intentional deviations
 * from patterns.
 *
 * @requirements 26.1 - THE Variant_System SHALL allow creating named variants of patterns
 * @requirements 26.2 - THE Variant SHALL specify scope: global, directory, or file
 * @requirements 26.3 - THE Variant SHALL include a reason explaining why it's intentional
 * @requirements 26.5 - THE Variant_System SHALL store variants in .drift/patterns/variants/
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

import {
  VariantManager,
  VariantNotFoundError,
  InvalidVariantInputError,
  VariantManagerError,
  type CreateVariantInput,
  type UpdateVariantInput,
} from './variant-manager.js';

import type { PatternLocation, PatternVariant, VariantScope } from '../store/types.js';

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Create a temporary directory for testing
 */
async function createTempDir(): Promise<string> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'variant-manager-test-'));
  return tempDir;
}

/**
 * Clean up a temporary directory
 */
async function cleanupTempDir(tempDir: string): Promise<void> {
  try {
    await fs.rm(tempDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

/**
 * Create a valid variant input for testing
 */
function createValidInput(overrides: Partial<CreateVariantInput> = {}): CreateVariantInput {
  return {
    patternId: 'pattern-123',
    name: 'Test Variant',
    reason: 'This is an intentional deviation for testing',
    scope: 'file',
    scopeValue: 'src/components/Button.tsx',
    locations: [
      { file: 'src/components/Button.tsx', line: 10, column: 5 },
    ],
    ...overrides,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('VariantManager', () => {
  let tempDir: string;
  let manager: VariantManager;

  beforeEach(async () => {
    tempDir = await createTempDir();
    manager = new VariantManager({ rootDir: tempDir });
    await manager.initialize();
  });

  afterEach(async () => {
    manager.dispose();
    await cleanupTempDir(tempDir);
  });

  // ==========================================================================
  // Initialization Tests
  // ==========================================================================

  describe('initialization', () => {
    it('should initialize successfully', async () => {
      expect(manager.isInitialized()).toBe(true);
    });

    it('should create variants directory on initialization', async () => {
      const variantsDir = path.join(tempDir, '.drift', 'patterns', 'variants');
      const stats = await fs.stat(variantsDir);
      expect(stats.isDirectory()).toBe(true);
    });

    it('should load existing variants on initialization', async () => {
      // Create a variant
      const variant = manager.create(createValidInput());
      await manager.saveAll();

      // Create a new manager and initialize
      const newManager = new VariantManager({ rootDir: tempDir });
      await newManager.initialize();

      expect(newManager.get(variant.id)).toBeDefined();
      expect(newManager.get(variant.id)?.name).toBe('Test Variant');

      newManager.dispose();
    });
  });

  // ==========================================================================
  // Create Tests
  // ==========================================================================

  describe('create', () => {
    /**
     * @requirements 26.1 - Create named variants of patterns
     */
    it('should create a variant with valid input', () => {
      const input = createValidInput();
      const variant = manager.create(input);

      expect(variant.id).toBeDefined();
      expect(variant.patternId).toBe(input.patternId);
      expect(variant.name).toBe(input.name);
      expect(variant.reason).toBe(input.reason);
      expect(variant.scope).toBe(input.scope);
      expect(variant.scopeValue).toBe(input.scopeValue);
      expect(variant.locations).toEqual(input.locations);
      expect(variant.active).toBe(true);
      expect(variant.createdAt).toBeDefined();
    });

    /**
     * @requirements 26.2 - Specify scope: global, directory, or file
     */
    it('should create a variant with global scope', () => {
      const input = createValidInput({
        scope: 'global',
        scopeValue: undefined,
      });
      const variant = manager.create(input);

      expect(variant.scope).toBe('global');
      expect(variant.scopeValue).toBeUndefined();
    });

    /**
     * @requirements 26.2 - Specify scope: global, directory, or file
     */
    it('should create a variant with directory scope', () => {
      const input = createValidInput({
        scope: 'directory',
        scopeValue: 'src/components',
      });
      const variant = manager.create(input);

      expect(variant.scope).toBe('directory');
      expect(variant.scopeValue).toBe('src/components');
    });

    /**
     * @requirements 26.2 - Specify scope: global, directory, or file
     */
    it('should create a variant with file scope', () => {
      const input = createValidInput({
        scope: 'file',
        scopeValue: 'src/components/Button.tsx',
      });
      const variant = manager.create(input);

      expect(variant.scope).toBe('file');
      expect(variant.scopeValue).toBe('src/components/Button.tsx');
    });

    /**
     * @requirements 26.3 - Include reason explaining why it's intentional
     */
    it('should require a reason', () => {
      const input = createValidInput({ reason: '' });

      expect(() => manager.create(input)).toThrow(InvalidVariantInputError);
    });

    it('should require a pattern ID', () => {
      const input = createValidInput({ patternId: '' });

      expect(() => manager.create(input)).toThrow(InvalidVariantInputError);
    });

    it('should require a name', () => {
      const input = createValidInput({ name: '' });

      expect(() => manager.create(input)).toThrow(InvalidVariantInputError);
    });

    it('should require scope value for non-global scopes', () => {
      const input = createValidInput({
        scope: 'file',
        scopeValue: '',
      });

      expect(() => manager.create(input)).toThrow(InvalidVariantInputError);
    });

    it('should not require scope value for global scope', () => {
      const input = createValidInput({
        scope: 'global',
        scopeValue: undefined,
      });

      const variant = manager.create(input);
      expect(variant.scope).toBe('global');
    });

    it('should require at least one location', () => {
      const input = createValidInput({ locations: [] });

      expect(() => manager.create(input)).toThrow(InvalidVariantInputError);
    });

    it('should generate unique IDs for variants', () => {
      const variant1 = manager.create(createValidInput());
      const variant2 = manager.create(createValidInput());

      expect(variant1.id).not.toBe(variant2.id);
    });

    it('should emit variant:created event', () => {
      let emittedEvent: any = null;
      manager.on('variant:created', (event) => {
        emittedEvent = event;
      });

      const variant = manager.create(createValidInput());

      expect(emittedEvent).toBeDefined();
      expect(emittedEvent.variantId).toBe(variant.id);
      expect(emittedEvent.patternId).toBe(variant.patternId);
    });
  });

  // ==========================================================================
  // Get Tests
  // ==========================================================================

  describe('get', () => {
    it('should return a variant by ID', () => {
      const created = manager.create(createValidInput());
      const retrieved = manager.get(created.id);

      expect(retrieved).toEqual(created);
    });

    it('should return undefined for non-existent ID', () => {
      const retrieved = manager.get('non-existent-id');

      expect(retrieved).toBeUndefined();
    });

    it('should throw for non-existent ID with getOrThrow', () => {
      expect(() => manager.getOrThrow('non-existent-id')).toThrow(VariantNotFoundError);
    });
  });

  // ==========================================================================
  // Has Tests
  // ==========================================================================

  describe('has', () => {
    it('should return true for existing variant', () => {
      const variant = manager.create(createValidInput());

      expect(manager.has(variant.id)).toBe(true);
    });

    it('should return false for non-existent variant', () => {
      expect(manager.has('non-existent-id')).toBe(false);
    });
  });

  // ==========================================================================
  // Update Tests
  // ==========================================================================

  describe('update', () => {
    it('should update variant name', () => {
      const variant = manager.create(createValidInput());
      const updated = manager.update(variant.id, { name: 'Updated Name' });

      expect(updated.name).toBe('Updated Name');
      expect(updated.id).toBe(variant.id);
    });

    it('should update variant reason', () => {
      const variant = manager.create(createValidInput());
      const updated = manager.update(variant.id, { reason: 'Updated reason' });

      expect(updated.reason).toBe('Updated reason');
    });

    it('should update variant scope', () => {
      const variant = manager.create(createValidInput({
        scope: 'file',
        scopeValue: 'src/file.ts',
      }));
      const updated = manager.update(variant.id, {
        scope: 'directory',
        scopeValue: 'src',
      });

      expect(updated.scope).toBe('directory');
      expect(updated.scopeValue).toBe('src');
    });

    it('should update variant locations', () => {
      const variant = manager.create(createValidInput());
      const newLocations: PatternLocation[] = [
        { file: 'src/new-file.ts', line: 20, column: 10 },
      ];
      const updated = manager.update(variant.id, { locations: newLocations });

      expect(updated.locations).toEqual(newLocations);
    });

    it('should not allow changing ID', () => {
      const variant = manager.create(createValidInput());
      const updated = manager.update(variant.id, { name: 'New Name' });

      expect(updated.id).toBe(variant.id);
    });

    it('should not allow changing pattern ID', () => {
      const variant = manager.create(createValidInput());
      const updated = manager.update(variant.id, { name: 'New Name' });

      expect(updated.patternId).toBe(variant.patternId);
    });

    it('should throw for non-existent variant', () => {
      expect(() => manager.update('non-existent-id', { name: 'New Name' })).toThrow(
        VariantNotFoundError
      );
    });

    it('should emit variant:updated event', () => {
      let emittedEvent: any = null;
      manager.on('variant:updated', (event) => {
        emittedEvent = event;
      });

      const variant = manager.create(createValidInput());
      manager.update(variant.id, { name: 'Updated Name' });

      expect(emittedEvent).toBeDefined();
      expect(emittedEvent.variantId).toBe(variant.id);
    });
  });

  // ==========================================================================
  // Delete Tests
  // ==========================================================================

  describe('delete', () => {
    it('should delete a variant', () => {
      const variant = manager.create(createValidInput());
      const deleted = manager.delete(variant.id);

      expect(deleted).toBe(true);
      expect(manager.has(variant.id)).toBe(false);
    });

    it('should return false for non-existent variant', () => {
      const deleted = manager.delete('non-existent-id');

      expect(deleted).toBe(false);
    });

    it('should emit variant:deleted event', () => {
      let emittedEvent: any = null;
      manager.on('variant:deleted', (event) => {
        emittedEvent = event;
      });

      const variant = manager.create(createValidInput());
      manager.delete(variant.id);

      expect(emittedEvent).toBeDefined();
      expect(emittedEvent.variantId).toBe(variant.id);
    });
  });

  // ==========================================================================
  // Activation/Deactivation Tests
  // ==========================================================================

  describe('activate/deactivate', () => {
    it('should deactivate a variant', () => {
      const variant = manager.create(createValidInput());
      const deactivated = manager.deactivate(variant.id);

      expect(deactivated.active).toBe(false);
    });

    it('should activate a deactivated variant', () => {
      const variant = manager.create(createValidInput());
      manager.deactivate(variant.id);
      const activated = manager.activate(variant.id);

      expect(activated.active).toBe(true);
    });

    it('should emit variant:deactivated event', () => {
      let emittedEvent: any = null;
      manager.on('variant:deactivated', (event) => {
        emittedEvent = event;
      });

      const variant = manager.create(createValidInput());
      manager.deactivate(variant.id);

      expect(emittedEvent).toBeDefined();
      expect(emittedEvent.variantId).toBe(variant.id);
    });

    it('should emit variant:activated event', () => {
      let emittedEvent: any = null;
      manager.on('variant:activated', (event) => {
        emittedEvent = event;
      });

      const variant = manager.create(createValidInput());
      manager.deactivate(variant.id);
      manager.activate(variant.id);

      expect(emittedEvent).toBeDefined();
      expect(emittedEvent.variantId).toBe(variant.id);
    });
  });

  // ==========================================================================
  // Query Tests
  // ==========================================================================

  describe('query', () => {
    beforeEach(() => {
      // Create test variants
      manager.create(createValidInput({
        patternId: 'pattern-1',
        name: 'Variant 1',
        scope: 'global',
        scopeValue: undefined,
      }));
      manager.create(createValidInput({
        patternId: 'pattern-1',
        name: 'Variant 2',
        scope: 'directory',
        scopeValue: 'src/components',
      }));
      manager.create(createValidInput({
        patternId: 'pattern-2',
        name: 'Variant 3',
        scope: 'file',
        scopeValue: 'src/utils/helpers.ts',
        locations: [{ file: 'src/utils/helpers.ts', line: 5, column: 1 }],
      }));
    });

    it('should return all variants with empty query', () => {
      const results = manager.query();

      expect(results.length).toBe(3);
    });

    it('should filter by pattern ID', () => {
      const results = manager.query({ patternId: 'pattern-1' });

      expect(results.length).toBe(2);
      expect(results.every((v) => v.patternId === 'pattern-1')).toBe(true);
    });

    it('should filter by pattern IDs', () => {
      const results = manager.query({ patternIds: ['pattern-1', 'pattern-2'] });

      expect(results.length).toBe(3);
    });

    it('should filter by scope', () => {
      const results = manager.query({ scope: 'global' });

      expect(results.length).toBe(1);
      expect(results[0].scope).toBe('global');
    });

    it('should filter by multiple scopes', () => {
      const results = manager.query({ scope: ['global', 'directory'] });

      expect(results.length).toBe(2);
    });

    it('should filter by active status', () => {
      const variant = manager.getAll()[0];
      manager.deactivate(variant.id);

      const activeResults = manager.query({ active: true });
      const inactiveResults = manager.query({ active: false });

      expect(activeResults.length).toBe(2);
      expect(inactiveResults.length).toBe(1);
    });

    it('should filter by file path', () => {
      const results = manager.query({ file: 'src/utils/helpers.ts' });

      // Should include global variant and file-scoped variant
      expect(results.length).toBe(2);
    });

    it('should filter by directory path', () => {
      const results = manager.query({ directory: 'src/components' });

      // Should include global variant and directory-scoped variant
      expect(results.length).toBe(2);
    });

    it('should search in name and reason', () => {
      const results = manager.query({ search: 'Variant 1' });

      expect(results.length).toBe(1);
      expect(results[0].name).toBe('Variant 1');
    });
  });

  // ==========================================================================
  // Convenience Query Methods Tests
  // ==========================================================================

  describe('convenience query methods', () => {
    beforeEach(() => {
      manager.create(createValidInput({ patternId: 'pattern-1', scope: 'global', scopeValue: undefined }));
      manager.create(createValidInput({ patternId: 'pattern-1', scope: 'file', scopeValue: 'src/file.ts', locations: [{ file: 'src/file.ts', line: 1, column: 1 }] }));
      manager.create(createValidInput({ patternId: 'pattern-2', scope: 'directory', scopeValue: 'src' }));
    });

    it('should get all variants', () => {
      expect(manager.getAll().length).toBe(3);
    });

    it('should get active variants', () => {
      const variant = manager.getAll()[0];
      manager.deactivate(variant.id);

      expect(manager.getActive().length).toBe(2);
    });

    it('should get inactive variants', () => {
      const variant = manager.getAll()[0];
      manager.deactivate(variant.id);

      expect(manager.getInactive().length).toBe(1);
    });

    it('should get variants by pattern ID', () => {
      expect(manager.getByPatternId('pattern-1').length).toBe(2);
    });

    it('should get active variants by pattern ID', () => {
      const variants = manager.getByPatternId('pattern-1');
      manager.deactivate(variants[0].id);

      expect(manager.getActiveByPatternId('pattern-1').length).toBe(1);
    });

    it('should get variants by scope', () => {
      expect(manager.getByScope('global').length).toBe(1);
      expect(manager.getByScope('file').length).toBe(1);
      expect(manager.getByScope('directory').length).toBe(1);
    });

    it('should get variants by file', () => {
      // global + file + directory (src/file.ts is in src/)
      expect(manager.getByFile('src/file.ts').length).toBe(3);
    });

    it('should get active variants by file', () => {
      const globalVariant = manager.getByScope('global')[0];
      manager.deactivate(globalVariant.id);

      // file + directory (src/file.ts is in src/)
      expect(manager.getActiveByFile('src/file.ts').length).toBe(2);
    });
  });

  // ==========================================================================
  // Coverage Checking Tests
  // ==========================================================================

  describe('coverage checking', () => {
    /**
     * @requirements 26.4 - WHEN a variant is created, THE Enforcement_System SHALL stop flagging matching code
     */
    it('should detect coverage by global variant', () => {
      // Global variants cover all files - provide a dummy location for validation
      manager.create(createValidInput({
        patternId: 'pattern-1',
        scope: 'global',
        scopeValue: undefined,
        locations: [{ file: 'dummy.ts', line: 1, column: 1 }],
      }));

      const location: PatternLocation = {
        file: 'any/file.ts',
        line: 10,
        column: 5,
      };

      expect(manager.isLocationCovered('pattern-1', location)).toBe(true);
    });

    it('should detect coverage by directory variant', () => {
      manager.create(createValidInput({
        patternId: 'pattern-1',
        scope: 'directory',
        scopeValue: 'src/components',
        locations: [{ file: 'src/components/index.ts', line: 1, column: 1 }],
      }));

      const coveredLocation: PatternLocation = {
        file: 'src/components/Button.tsx',
        line: 10,
        column: 5,
      };

      const uncoveredLocation: PatternLocation = {
        file: 'src/utils/helpers.ts',
        line: 10,
        column: 5,
      };

      expect(manager.isLocationCovered('pattern-1', coveredLocation)).toBe(true);
      expect(manager.isLocationCovered('pattern-1', uncoveredLocation)).toBe(false);
    });

    it('should detect coverage by file variant', () => {
      manager.create(createValidInput({
        patternId: 'pattern-1',
        scope: 'file',
        scopeValue: 'src/components/Button.tsx',
        locations: [{ file: 'src/components/Button.tsx', line: 1, column: 1 }],
      }));

      const coveredLocation: PatternLocation = {
        file: 'src/components/Button.tsx',
        line: 10,
        column: 5,
      };

      const uncoveredLocation: PatternLocation = {
        file: 'src/components/Card.tsx',
        line: 10,
        column: 5,
      };

      expect(manager.isLocationCovered('pattern-1', coveredLocation)).toBe(true);
      expect(manager.isLocationCovered('pattern-1', uncoveredLocation)).toBe(false);
    });

    it('should detect coverage by specific location', () => {
      // Create a variant with multiple specific locations
      // This tests that when multiple locations are specified,
      // only those exact locations are covered
      manager.create(createValidInput({
        patternId: 'pattern-1',
        scope: 'file',
        scopeValue: 'src/components/Button.tsx',
        locations: [
          { file: 'src/components/Button.tsx', line: 10, column: 5 },
          { file: 'src/components/Button.tsx', line: 15, column: 3 },
        ],
      }));

      const coveredLocation: PatternLocation = {
        file: 'src/components/Button.tsx',
        line: 10,
        column: 5,
      };

      const anotherCoveredLocation: PatternLocation = {
        file: 'src/components/Button.tsx',
        line: 15,
        column: 3,
      };

      const uncoveredLocation: PatternLocation = {
        file: 'src/components/Button.tsx',
        line: 20,
        column: 5,
      };

      expect(manager.isLocationCovered('pattern-1', coveredLocation)).toBe(true);
      expect(manager.isLocationCovered('pattern-1', anotherCoveredLocation)).toBe(true);
      expect(manager.isLocationCovered('pattern-1', uncoveredLocation)).toBe(false);
    });

    it('should not detect coverage by inactive variant', () => {
      const variant = manager.create(createValidInput({
        patternId: 'pattern-1',
        scope: 'global',
        scopeValue: undefined,
        locations: [{ file: 'dummy.ts', line: 1, column: 1 }],
      }));
      manager.deactivate(variant.id);

      const location: PatternLocation = {
        file: 'any/file.ts',
        line: 10,
        column: 5,
      };

      expect(manager.isLocationCovered('pattern-1', location)).toBe(false);
    });

    it('should not detect coverage for different pattern', () => {
      manager.create(createValidInput({
        patternId: 'pattern-1',
        scope: 'global',
        scopeValue: undefined,
        locations: [{ file: 'dummy.ts', line: 1, column: 1 }],
      }));

      const location: PatternLocation = {
        file: 'any/file.ts',
        line: 10,
        column: 5,
      };

      expect(manager.isLocationCovered('pattern-2', location)).toBe(false);
    });

    it('should get covering variant', () => {
      const variant = manager.create(createValidInput({
        patternId: 'pattern-1',
        scope: 'global',
        scopeValue: undefined,
        locations: [{ file: 'dummy.ts', line: 1, column: 1 }],
      }));

      const location: PatternLocation = {
        file: 'any/file.ts',
        line: 10,
        column: 5,
      };

      const covering = manager.getCoveringVariant('pattern-1', location);
      expect(covering).toBeDefined();
      expect(covering?.id).toBe(variant.id);
    });

    it('should return undefined when no covering variant', () => {
      const location: PatternLocation = {
        file: 'any/file.ts',
        line: 10,
        column: 5,
      };

      const covering = manager.getCoveringVariant('pattern-1', location);
      expect(covering).toBeUndefined();
    });
  });

  // ==========================================================================
  // Persistence Tests
  // ==========================================================================

  describe('persistence', () => {
    /**
     * @requirements 26.5 - Store variants in .drift/patterns/variants/
     */
    it('should save variants to disk', async () => {
      manager.create(createValidInput());
      await manager.saveAll();

      const indexPath = path.join(tempDir, '.drift', 'patterns', 'variants', 'index.json');
      const content = await fs.readFile(indexPath, 'utf-8');
      const data = JSON.parse(content);

      expect(data.variants.length).toBe(1);
      expect(data.version).toBeDefined();
      expect(data.lastUpdated).toBeDefined();
    });

    it('should load variants from disk', async () => {
      const variant = manager.create(createValidInput());
      await manager.saveAll();

      // Create a new manager and load
      const newManager = new VariantManager({ rootDir: tempDir });
      await newManager.initialize();

      expect(newManager.get(variant.id)).toBeDefined();
      expect(newManager.get(variant.id)?.name).toBe(variant.name);

      newManager.dispose();
    });

    it('should create backup before save', async () => {
      manager.create(createValidInput());
      await manager.saveAll();

      // Modify and save again
      manager.create(createValidInput({ name: 'Second Variant' }));
      await manager.saveAll();

      const backupDir = path.join(tempDir, '.drift', 'patterns', 'variants', '.backups');
      const backups = await fs.readdir(backupDir);

      expect(backups.length).toBeGreaterThan(0);
    });

    it('should emit file:saved event', async () => {
      let emittedEvent: any = null;
      manager.on('file:saved', (event) => {
        emittedEvent = event;
      });

      manager.create(createValidInput());
      await manager.saveAll();

      expect(emittedEvent).toBeDefined();
      expect(emittedEvent.data?.count).toBe(1);
    });
  });

  // ==========================================================================
  // Statistics Tests
  // ==========================================================================

  describe('statistics', () => {
    beforeEach(() => {
      manager.create(createValidInput({ patternId: 'pattern-1', scope: 'global', scopeValue: undefined }));
      manager.create(createValidInput({ patternId: 'pattern-1', scope: 'file', scopeValue: 'src/file.ts' }));
      manager.create(createValidInput({ patternId: 'pattern-2', scope: 'directory', scopeValue: 'src' }));
    });

    it('should return correct total count', () => {
      const stats = manager.getStats();

      expect(stats.total).toBe(3);
    });

    it('should return correct active/inactive counts', () => {
      const variant = manager.getAll()[0];
      manager.deactivate(variant.id);

      const stats = manager.getStats();

      expect(stats.active).toBe(2);
      expect(stats.inactive).toBe(1);
    });

    it('should return correct counts by scope', () => {
      const stats = manager.getStats();

      expect(stats.byScope.global).toBe(1);
      expect(stats.byScope.file).toBe(1);
      expect(stats.byScope.directory).toBe(1);
    });

    it('should return correct counts by pattern', () => {
      const stats = manager.getStats();

      expect(stats.byPattern['pattern-1']).toBe(2);
      expect(stats.byPattern['pattern-2']).toBe(1);
    });

    it('should return correct patterns with variants count', () => {
      const stats = manager.getStats();

      expect(stats.patternsWithVariants).toBe(2);
    });
  });
});
