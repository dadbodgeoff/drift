/**
 * Tests for PatternStoreAdapter
 *
 * Verifies that the adapter correctly bridges the legacy PatternStore
 * to the new IPatternRepository interface.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventEmitter } from 'node:events';

import { PatternStoreAdapter, createPatternStoreAdapter } from '../adapters/pattern-store-adapter.js';
import { createPatternServiceFromStore } from '../adapters/service-factory.js';
import type { Pattern as UnifiedPattern } from '../types.js';

// Mock PatternStore
class MockPatternStore extends EventEmitter {
  private patterns: Map<string, any> = new Map();
  private initialized = false;

  async initialize(): Promise<void> {
    this.initialized = true;
  }

  async saveAll(): Promise<void> {
    // No-op for mock
  }

  getAll(): any[] {
    return Array.from(this.patterns.values());
  }

  get(id: string): any | undefined {
    return this.patterns.get(id);
  }

  add(pattern: any): void {
    this.patterns.set(pattern.id, pattern);
    // Emit event in the same format as the real PatternStore
    this.emit('pattern:created', { patternId: pattern.id, category: pattern.category });
  }

  update(id: string, pattern: any): void {
    this.patterns.set(id, pattern);
    // Emit event in the same format as the real PatternStore
    this.emit('pattern:updated', { patternId: id, category: pattern.category });
  }

  delete(id: string): void {
    const pattern = this.patterns.get(id);
    if (pattern) {
      this.patterns.delete(id);
      // Emit event in the same format as the real PatternStore
      this.emit('pattern:deleted', { patternId: id, category: pattern.category });
    }
  }

  approve(id: string, approvedBy?: string): void {
    const pattern = this.patterns.get(id);
    if (!pattern) throw new Error('Pattern not found');
    if (pattern.status === 'approved') {
      const error = new Error('Invalid state transition');
      (error as any).name = 'InvalidStateTransitionError';
      throw error;
    }
    pattern.status = 'approved';
    pattern.metadata.approvedAt = new Date().toISOString();
    pattern.metadata.approvedBy = approvedBy;
    // Emit event in the same format as the real PatternStore
    this.emit('pattern:approved', { patternId: id, category: pattern.category });
  }

  ignore(id: string): void {
    const pattern = this.patterns.get(id);
    if (!pattern) throw new Error('Pattern not found');
    pattern.status = 'ignored';
    // Emit event in the same format as the real PatternStore
    this.emit('pattern:ignored', { patternId: id, category: pattern.category });
  }

  getStats(): { totalPatterns: number } {
    return { totalPatterns: this.patterns.size };
  }
}

// Helper to create a legacy pattern
function createLegacyPattern(overrides: Partial<any> = {}): any {
  return {
    id: `pattern-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    category: 'structural',
    subcategory: 'naming',
    name: 'Test Pattern',
    description: 'A test pattern',
    detector: {
      type: 'ast',
      config: { detectorId: 'test-detector' },
    },
    confidence: {
      score: 0.85,
      level: 'high',
      frequency: 0.85,
      consistency: 1,
      age: 0,
      spread: 5,
    },
    locations: [
      { file: 'src/test.ts', line: 10, column: 5 },
      { file: 'src/other.ts', line: 20, column: 10 },
    ],
    outliers: [],
    status: 'discovered',
    severity: 'info',
    autoFixable: false,
    metadata: {
      firstSeen: new Date().toISOString(),
      lastSeen: new Date().toISOString(),
      version: 1,
      tags: ['test'],
    },
    ...overrides,
  };
}

describe('PatternStoreAdapter', () => {
  let mockStore: MockPatternStore;
  let adapter: PatternStoreAdapter;

  beforeEach(() => {
    mockStore = new MockPatternStore();
    adapter = new PatternStoreAdapter(mockStore as any);
  });

  describe('Lifecycle', () => {
    it('should initialize the underlying store', async () => {
      const initSpy = vi.spyOn(mockStore, 'initialize');
      await adapter.initialize();
      expect(initSpy).toHaveBeenCalled();
    });

    it('should save on close', async () => {
      const saveSpy = vi.spyOn(mockStore, 'saveAll');
      await adapter.initialize();
      await adapter.close();
      expect(saveSpy).toHaveBeenCalled();
    });
  });

  describe('CRUD Operations', () => {
    beforeEach(async () => {
      await adapter.initialize();
    });

    it('should add a pattern', async () => {
      const pattern: UnifiedPattern = {
        id: 'test-1',
        category: 'structural',
        subcategory: 'naming',
        name: 'Test Pattern',
        description: 'A test pattern',
        detectorId: 'test-detector',
        detectorName: 'Test Pattern',
        detectionMethod: 'ast',
        detector: { type: 'ast', config: {} },
        confidence: 0.85,
        confidenceLevel: 'high',
        locations: [{ file: 'src/test.ts', line: 10, column: 5 }],
        outliers: [],
        status: 'discovered',
        severity: 'info',
        firstSeen: new Date().toISOString(),
        lastSeen: new Date().toISOString(),
        tags: [],
        autoFixable: false,
        metadata: {
          firstSeen: new Date().toISOString(),
          lastSeen: new Date().toISOString(),
          version: 1,
        },
      };

      await adapter.add(pattern);
      const retrieved = await adapter.get('test-1');
      expect(retrieved).not.toBeNull();
      expect(retrieved?.id).toBe('test-1');
    });

    it('should get a pattern by ID', async () => {
      const legacy = createLegacyPattern({ id: 'test-get' });
      mockStore.add(legacy);

      const pattern = await adapter.get('test-get');
      expect(pattern).not.toBeNull();
      expect(pattern?.id).toBe('test-get');
      expect(pattern?.confidence).toBe(0.85);
      expect(pattern?.confidenceLevel).toBe('high');
    });

    it('should return null for non-existent pattern', async () => {
      const pattern = await adapter.get('non-existent');
      expect(pattern).toBeNull();
    });

    it('should update a pattern', async () => {
      const legacy = createLegacyPattern({ id: 'test-update' });
      mockStore.add(legacy);

      const updated = await adapter.update('test-update', {
        name: 'Updated Name',
        confidence: 0.95,
      });

      expect(updated.name).toBe('Updated Name');
      expect(updated.confidence).toBe(0.95);
      expect(updated.confidenceLevel).toBe('high');
    });

    it('should delete a pattern', async () => {
      const legacy = createLegacyPattern({ id: 'test-delete' });
      mockStore.add(legacy);

      const result = await adapter.delete('test-delete');
      expect(result).toBe(true);

      const pattern = await adapter.get('test-delete');
      expect(pattern).toBeNull();
    });
  });

  describe('Querying', () => {
    beforeEach(async () => {
      await adapter.initialize();
      
      // Add test patterns
      mockStore.add(createLegacyPattern({
        id: 'p1',
        category: 'structural',
        status: 'discovered',
        confidence: { score: 0.9, level: 'high', frequency: 0.9, consistency: 1, age: 0, spread: 5 },
      }));
      mockStore.add(createLegacyPattern({
        id: 'p2',
        category: 'security',
        status: 'approved',
        confidence: { score: 0.7, level: 'medium', frequency: 0.7, consistency: 1, age: 0, spread: 3 },
      }));
      mockStore.add(createLegacyPattern({
        id: 'p3',
        category: 'structural',
        status: 'ignored',
        confidence: { score: 0.5, level: 'low', frequency: 0.5, consistency: 1, age: 0, spread: 2 },
      }));
    });

    it('should query all patterns', async () => {
      const result = await adapter.query({});
      expect(result.patterns.length).toBe(3);
      expect(result.total).toBe(3);
    });

    it('should filter by category', async () => {
      const result = await adapter.query({
        filter: { categories: ['structural'] },
      });
      expect(result.patterns.length).toBe(2);
      expect(result.patterns.every(p => p.category === 'structural')).toBe(true);
    });

    it('should filter by status', async () => {
      const result = await adapter.query({
        filter: { statuses: ['discovered'] },
      });
      expect(result.patterns.length).toBe(1);
      expect(result.patterns[0]?.status).toBe('discovered');
    });

    it('should filter by minimum confidence', async () => {
      const result = await adapter.query({
        filter: { minConfidence: 0.8 },
      });
      expect(result.patterns.length).toBe(1);
      expect(result.patterns[0]?.confidence).toBeGreaterThanOrEqual(0.8);
    });

    it('should sort by confidence descending', async () => {
      const result = await adapter.query({
        sort: { field: 'confidence', direction: 'desc' },
      });
      expect(result.patterns[0]?.confidence).toBeGreaterThanOrEqual(result.patterns[1]?.confidence ?? 0);
      expect(result.patterns[1]?.confidence).toBeGreaterThanOrEqual(result.patterns[2]?.confidence ?? 0);
    });

    it('should paginate results', async () => {
      const result = await adapter.query({
        pagination: { offset: 0, limit: 2 },
      });
      expect(result.patterns.length).toBe(2);
      expect(result.total).toBe(3);
      expect(result.hasMore).toBe(true);
    });

    it('should get patterns by category', async () => {
      const patterns = await adapter.getByCategory('security');
      expect(patterns.length).toBe(1);
      expect(patterns[0]?.category).toBe('security');
    });

    it('should get patterns by status', async () => {
      const patterns = await adapter.getByStatus('approved');
      expect(patterns.length).toBe(1);
      expect(patterns[0]?.status).toBe('approved');
    });

    it('should count patterns', async () => {
      const count = await adapter.count();
      expect(count).toBe(3);
    });

    it('should count patterns with filter', async () => {
      const count = await adapter.count({ categories: ['structural'] });
      expect(count).toBe(2);
    });
  });

  describe('Status Transitions', () => {
    beforeEach(async () => {
      await adapter.initialize();
      mockStore.add(createLegacyPattern({ id: 'test-status', status: 'discovered' }));
    });

    it('should approve a pattern', async () => {
      const approved = await adapter.approve('test-status', 'test-user');
      expect(approved.status).toBe('approved');
    });

    it('should ignore a pattern', async () => {
      const ignored = await adapter.ignore('test-status');
      expect(ignored.status).toBe('ignored');
    });
  });

  describe('Events', () => {
    beforeEach(async () => {
      await adapter.initialize();
    });

    it('should forward pattern:added events', async () => {
      const handler = vi.fn();
      adapter.on('pattern:added', handler);

      const legacy = createLegacyPattern({ id: 'event-test' });
      mockStore.add(legacy);

      expect(handler).toHaveBeenCalled();
      expect(handler.mock.calls[0]?.[0]?.id).toBe('event-test');
    });

    it('should forward pattern:approved events', async () => {
      const handler = vi.fn();
      adapter.on('pattern:approved', handler);

      mockStore.add(createLegacyPattern({ id: 'approve-event', status: 'discovered' }));
      mockStore.approve('approve-event');

      expect(handler).toHaveBeenCalled();
    });
  });
});

describe('createPatternStoreAdapter', () => {
  it('should create an adapter from a PatternStore', () => {
    const mockStore = new MockPatternStore();
    const adapter = createPatternStoreAdapter(mockStore as any);
    expect(adapter).toBeInstanceOf(PatternStoreAdapter);
  });
});

describe('createPatternServiceFromStore', () => {
  it('should create a PatternService from a PatternStore', async () => {
    const mockStore = new MockPatternStore();
    mockStore.add(createLegacyPattern({ id: 'service-test' }));
    
    const service = createPatternServiceFromStore(mockStore as any, '/tmp/test');
    
    // The service should work
    const pattern = await service.getPattern('service-test');
    expect(pattern).not.toBeNull();
    expect(pattern?.id).toBe('service-test');
  });

  it('should provide status through the service', async () => {
    const mockStore = new MockPatternStore();
    mockStore.add(createLegacyPattern({ id: 'status-test-1', status: 'discovered' }));
    mockStore.add(createLegacyPattern({ id: 'status-test-2', status: 'approved' }));
    
    const service = createPatternServiceFromStore(mockStore as any, '/tmp/test');
    
    const status = await service.getStatus();
    expect(status.totalPatterns).toBe(2);
    expect(status.byStatus.discovered).toBe(1);
    expect(status.byStatus.approved).toBe(1);
  });

  it('should list patterns through the service', async () => {
    const mockStore = new MockPatternStore();
    mockStore.add(createLegacyPattern({ id: 'list-test-1' }));
    mockStore.add(createLegacyPattern({ id: 'list-test-2' }));
    
    const service = createPatternServiceFromStore(mockStore as any, '/tmp/test');
    
    const result = await service.listPatterns();
    expect(result.items.length).toBe(2);
    expect(result.total).toBe(2);
  });
});
