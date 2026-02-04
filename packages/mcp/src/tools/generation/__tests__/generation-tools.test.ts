/**
 * Integration tests for generation tools
 * Tests drift_suggest_changes, drift_validate_change, drift_explain
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

import { handleExplain } from '../explain.js';
import { handleSuggestChanges } from '../suggest-changes.js';
import { handleValidateChange } from '../validate-change.js';

import type { PatternStore, BoundaryStore, ManifestStore, CallGraphStore } from 'driftdetect-core';

// Mock stores
const createMockPatternStore = (): PatternStore => ({
  initialize: vi.fn().mockResolvedValue(undefined),
  getAll: vi.fn().mockReturnValue([
    {
      id: 'test-pattern-1',
      name: 'Test Pattern',
      category: 'api',
      locations: [{ file: 'src/api/users.ts', line: 10 }],
      outliers: [],
      confidence: { score: 0.9, factors: [] },
      status: 'approved',
    },
  ]),
  get: vi.fn(),
  save: vi.fn(),
  delete: vi.fn(),
  getByCategory: vi.fn(),
  getByStatus: vi.fn(),
} as unknown as PatternStore);

const createMockBoundaryStore = (): BoundaryStore => ({
  initialize: vi.fn().mockResolvedValue(undefined),
  getAll: vi.fn().mockReturnValue([]),
  getFileAccess: vi.fn().mockReturnValue([]),
  getAccessMap: vi.fn().mockReturnValue({ accessPoints: {}, sensitiveFields: [] }),
  getSensitiveAccess: vi.fn().mockReturnValue([]),
  getRules: vi.fn().mockReturnValue(null),
  checkAllViolations: vi.fn().mockReturnValue([]),
} as unknown as BoundaryStore);

const createMockManifestStore = (): ManifestStore => ({
  load: vi.fn().mockResolvedValue(undefined),
  save: vi.fn(),
  get: vi.fn(),
} as unknown as ManifestStore);

const createMockCallGraphStore = (): CallGraphStore => ({
  initialize: vi.fn().mockResolvedValue(undefined),
  getGraph: vi.fn().mockReturnValue(null),
} as unknown as CallGraphStore);

describe('Generation Tools', () => {
  let patternStore: PatternStore;
  let boundaryStore: BoundaryStore;
  let manifestStore: ManifestStore;
  let callGraphStore: CallGraphStore;
  const projectRoot = '/tmp/test-project';

  beforeEach(() => {
    patternStore = createMockPatternStore();
    boundaryStore = createMockBoundaryStore();
    manifestStore = createMockManifestStore();
    callGraphStore = createMockCallGraphStore();
  });

  describe('drift_suggest_changes', () => {
    it('should return suggestions for a file', async () => {
      const result = await handleSuggestChanges(
        { pattern: patternStore, boundary: boundaryStore },
        projectRoot,
        { target: 'src/api/users.ts' }
      );

      expect(result).toHaveProperty('content');
      expect(Array.isArray(result.content)).toBe(true);
      expect(result.content.length).toBeGreaterThan(0);
      expect(result.content[0]).toHaveProperty('type', 'text');
    });

    it('should handle file not found gracefully', async () => {
      const result = await handleSuggestChanges(
        { pattern: patternStore, boundary: boundaryStore },
        projectRoot,
        { target: 'nonexistent/file.ts' }
      );

      expect(result).toHaveProperty('content');
      const text = result.content[0]?.text || '';
      expect(text).toContain('not found');
    });

    it('should filter by issue type', async () => {
      const result = await handleSuggestChanges(
        { pattern: patternStore, boundary: boundaryStore },
        projectRoot,
        { target: 'src/api/users.ts', issue: 'security' }
      );

      expect(result).toHaveProperty('content');
    });
  });

  describe('drift_validate_change', () => {
    it('should validate code content', async () => {
      const result = await handleValidateChange(
        patternStore,
        projectRoot,
        { 
          file: 'src/api/users.ts',
          content: 'export function getUser(id: string) { return db.users.findOne(id); }'
        }
      );

      expect(result).toHaveProperty('content');
      expect(Array.isArray(result.content)).toBe(true);
    });

    it('should handle missing file gracefully', async () => {
      const result = await handleValidateChange(
        patternStore,
        projectRoot,
        { file: 'nonexistent/file.ts' }
      );

      expect(result).toHaveProperty('content');
    });

    it('should support strict mode', async () => {
      const result = await handleValidateChange(
        patternStore,
        projectRoot,
        { 
          file: 'src/api/users.ts',
          content: 'const x = 1;',
          strictMode: true
        }
      );

      expect(result).toHaveProperty('content');
    });
  });

  describe('drift_explain', () => {
    it('should explain a file target', async () => {
      const result = await handleExplain(
        { pattern: patternStore, manifest: manifestStore, boundary: boundaryStore, callGraph: callGraphStore },
        projectRoot,
        { target: 'src/api/users.ts' }
      );

      expect(result).toHaveProperty('content');
      expect(Array.isArray(result.content)).toBe(true);
    });

    it('should handle symbol target gracefully', async () => {
      const result = await handleExplain(
        { pattern: patternStore, manifest: manifestStore, boundary: boundaryStore, callGraph: callGraphStore },
        projectRoot,
        { target: 'getUser' }
      );

      expect(result).toHaveProperty('content');
      const text = result.content[0]?.text || '';
      expect(text).toContain('Symbol search not yet implemented');
    });

    it('should support different depths', async () => {
      const summaryResult = await handleExplain(
        { pattern: patternStore, manifest: manifestStore, boundary: boundaryStore, callGraph: callGraphStore },
        projectRoot,
        { target: 'src/api/users.ts', depth: 'summary' }
      );

      const detailedResult = await handleExplain(
        { pattern: patternStore, manifest: manifestStore, boundary: boundaryStore, callGraph: callGraphStore },
        projectRoot,
        { target: 'src/api/users.ts', depth: 'detailed' }
      );

      expect(summaryResult).toHaveProperty('content');
      expect(detailedResult).toHaveProperty('content');
    });

    it('should support focus areas', async () => {
      const result = await handleExplain(
        { pattern: patternStore, manifest: manifestStore, boundary: boundaryStore, callGraph: callGraphStore },
        projectRoot,
        { target: 'src/api/users.ts', focus: 'security' }
      );

      expect(result).toHaveProperty('content');
    });
  });
});
