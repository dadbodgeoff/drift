import { describe, it, expect } from 'vitest';
import {
  clusterToPattern,
  wrapperToLocation,
  clustersToPatterns,
  generatePatternId,
  extractPatternMetadata,
  isWrapperPattern,
  extractWrapperInfo,
} from '../integration/pattern-adapter.js';
import type { WrapperCluster, WrapperFunction } from '../types.js';
import type { Pattern } from '../../patterns/types.js';

// =============================================================================
// Test Helpers
// =============================================================================

function createWrapper(overrides: Partial<WrapperFunction> = {}): WrapperFunction {
  const name = overrides.name ?? 'useAuth';
  return {
    name,
    qualifiedName: overrides.qualifiedName ?? `hooks.${name}`,
    file: 'src/hooks/useAuth.ts',
    line: 10,
    language: 'typescript',
    directPrimitives: ['useState', 'useEffect'],
    transitivePrimitives: [],
    primitiveSignature: ['useEffect', 'useState'],
    depth: 1,
    callsWrappers: [],
    calledBy: ['LoginPage', 'ProfilePage'],
    isFactory: false,
    isHigherOrder: false,
    isDecorator: false,
    isAsync: false,
    ...overrides,
  };
}

function createCluster(overrides: Partial<WrapperCluster> = {}): WrapperCluster {
  return {
    id: 'auth-hooks',
    name: 'Authentication Hooks',
    description: 'Hooks for authentication state management',
    primitiveSignature: ['useEffect', 'useState'],
    wrappers: [createWrapper()],
    confidence: 0.85,
    category: 'authentication',
    avgDepth: 1.2,
    maxDepth: 2,
    totalUsages: 15,
    fileSpread: 3,
    suggestedNames: ['useAuth', 'useSession'],
    ...overrides,
  };
}

// =============================================================================
// clusterToPattern Tests
// =============================================================================

describe('clusterToPattern', () => {
  it('should convert a cluster to a pattern', () => {
    const cluster = createCluster();
    const pattern = clusterToPattern(cluster);

    expect(pattern.id).toBe('wrapper-auth-hooks');
    expect(pattern.name).toBe('Authentication Hooks');
    expect(pattern.category).toBe('auth');
    expect(pattern.subcategory).toBe('auth-wrapper');
    expect(pattern.confidence).toBe(0.85);
    expect(pattern.detectorId).toBe('wrapper-detector');
    expect(pattern.detectorName).toBe('Framework Wrapper Detector');
    expect(pattern.detectionMethod).toBe('semantic');
  });

  it('should include wrapper details in description', () => {
    const cluster = createCluster();
    const pattern = clusterToPattern(cluster, { includeDetails: true });

    expect(pattern.description).toContain('Wraps: useEffect, useState');
    expect(pattern.description).toContain('Wrappers: 1');
    expect(pattern.description).toContain('Avg depth: 1.2');
  });

  it('should exclude details when option is false', () => {
    const cluster = createCluster();
    const pattern = clusterToPattern(cluster, { includeDetails: false });

    expect(pattern.description).not.toContain('Wraps:');
    expect(pattern.description).toBe('Hooks for authentication state management');
  });

  it('should use custom ID prefix', () => {
    const cluster = createCluster();
    const pattern = clusterToPattern(cluster, { idPrefix: 'custom-' });

    expect(pattern.id).toBe('custom-auth-hooks');
  });

  it('should use custom severity', () => {
    const cluster = createCluster();
    const pattern = clusterToPattern(cluster, { defaultSeverity: 'warning' });

    expect(pattern.severity).toBe('warning');
  });

  it('should add appropriate tags', () => {
    const cluster = createCluster();
    const pattern = clusterToPattern(cluster);

    expect(pattern.tags).toContain('wrapper');
    expect(pattern.tags).toContain('wrapper-authentication');
    expect(pattern.tags).toContain('wraps-useEffect');
    expect(pattern.tags).toContain('wraps-useState');
  });

  it('should convert wrapper locations to pattern locations', () => {
    const cluster = createCluster({
      wrappers: [
        createWrapper({ name: 'useAuth', file: 'src/hooks/useAuth.ts', line: 10 }),
        createWrapper({ name: 'useSession', file: 'src/hooks/useSession.ts', line: 20 }),
      ],
    });
    const pattern = clusterToPattern(cluster);

    expect(pattern.locations).toHaveLength(2);
    expect(pattern.locations[0]?.file).toBe('src/hooks/useAuth.ts');
    expect(pattern.locations[0]?.line).toBe(10);
    expect(pattern.locations[1]?.file).toBe('src/hooks/useSession.ts');
    expect(pattern.locations[1]?.line).toBe(20);
  });

  it('should store wrapper metadata in detector config', () => {
    const cluster = createCluster();
    const pattern = clusterToPattern(cluster);

    const config = pattern.detector.config as Record<string, unknown>;
    expect(config['primitiveSignature']).toEqual(['useEffect', 'useState']);
    expect(config['avgDepth']).toBe(1.2);
    expect(config['maxDepth']).toBe(2);
    expect(config['totalUsages']).toBe(15);
    expect(config['fileSpread']).toBe(3);
  });

  it('should map wrapper categories to pattern categories', () => {
    const categories: Array<{ wrapper: WrapperCluster['category']; pattern: string }> = [
      { wrapper: 'state-management', pattern: 'components' },
      { wrapper: 'data-fetching', pattern: 'api' },
      { wrapper: 'authentication', pattern: 'auth' },
      { wrapper: 'error-handling', pattern: 'errors' },
      { wrapper: 'logging', pattern: 'logging' },
      { wrapper: 'testing', pattern: 'testing' },
      { wrapper: 'caching', pattern: 'performance' },
      { wrapper: 'factory', pattern: 'structural' },
    ];

    for (const { wrapper, pattern: expectedCategory } of categories) {
      const cluster = createCluster({ category: wrapper });
      const result = clusterToPattern(cluster);
      expect(result.category).toBe(expectedCategory);
    }
  });
});

// =============================================================================
// wrapperToLocation Tests
// =============================================================================

describe('wrapperToLocation', () => {
  it('should convert wrapper to location', () => {
    const wrapper = createWrapper({
      name: 'useAuth',
      file: 'src/hooks/useAuth.ts',
      line: 42,
      primitiveSignature: ['useState', 'useEffect'],
      depth: 2,
    });

    const location = wrapperToLocation(wrapper);

    expect(location.file).toBe('src/hooks/useAuth.ts');
    expect(location.line).toBe(42);
    expect(location.column).toBe(1);
    expect(location.snippet).toContain('useAuth');
    expect(location.snippet).toContain('useState, useEffect');
    expect(location.snippet).toContain('depth 2');
  });
});

// =============================================================================
// clustersToPatterns Tests
// =============================================================================

describe('clustersToPatterns', () => {
  it('should convert multiple clusters to patterns', () => {
    const clusters = [
      createCluster({ id: 'cluster-1', confidence: 0.9 }),
      createCluster({ id: 'cluster-2', confidence: 0.8 }),
    ];

    const patterns = clustersToPatterns(clusters);

    expect(patterns).toHaveLength(2);
    expect(patterns[0]?.id).toBe('wrapper-cluster-1');
    expect(patterns[1]?.id).toBe('wrapper-cluster-2');
  });

  it('should filter by minimum confidence', () => {
    const clusters = [
      createCluster({ id: 'high', confidence: 0.9 }),
      createCluster({ id: 'medium', confidence: 0.6 }),
      createCluster({ id: 'low', confidence: 0.3 }),
    ];

    const patterns = clustersToPatterns(clusters, { minConfidence: 0.5 });

    expect(patterns).toHaveLength(2);
    expect(patterns.map((p) => p.id)).toContain('wrapper-high');
    expect(patterns.map((p) => p.id)).toContain('wrapper-medium');
  });

  it('should use default minConfidence of 0.5', () => {
    const clusters = [
      createCluster({ id: 'above', confidence: 0.6 }),
      createCluster({ id: 'below', confidence: 0.4 }),
    ];

    const patterns = clustersToPatterns(clusters);

    expect(patterns).toHaveLength(1);
    expect(patterns[0]?.id).toBe('wrapper-above');
  });

  it('should pass options to clusterToPattern', () => {
    const clusters = [createCluster()];
    const patterns = clustersToPatterns(clusters, {
      idPrefix: 'test-',
      defaultSeverity: 'warning',
    });

    expect(patterns[0]?.id).toBe('test-auth-hooks');
    expect(patterns[0]?.severity).toBe('warning');
  });
});

// =============================================================================
// generatePatternId Tests
// =============================================================================

describe('generatePatternId', () => {
  it('should generate ID from category and signature', () => {
    const cluster = createCluster({
      category: 'authentication',
      primitiveSignature: ['useState', 'useEffect'],
    });

    const id = generatePatternId(cluster);

    expect(id).toContain('wrapper-authentication');
    expect(id).toContain('useeffect');
    expect(id).toContain('usestate');
  });

  it('should sort primitives for consistent IDs', () => {
    const cluster1 = createCluster({
      primitiveSignature: ['useState', 'useEffect'],
    });
    const cluster2 = createCluster({
      primitiveSignature: ['useEffect', 'useState'],
    });

    expect(generatePatternId(cluster1)).toBe(generatePatternId(cluster2));
  });

  it('should truncate long IDs', () => {
    const cluster = createCluster({
      primitiveSignature: Array(20).fill('veryLongPrimitiveName'),
    });

    const id = generatePatternId(cluster);

    expect(id.length).toBeLessThanOrEqual(64);
  });
});

// =============================================================================
// extractPatternMetadata Tests
// =============================================================================

describe('extractPatternMetadata', () => {
  it('should extract all metadata from cluster', () => {
    const cluster = createCluster({
      wrappers: [
        createWrapper({ name: 'useAuth' }),
        createWrapper({ name: 'useSession' }),
      ],
    });

    const metadata = extractPatternMetadata(cluster);

    expect(metadata['wrapperCategory']).toBe('authentication');
    expect(metadata['primitiveSignature']).toEqual(['useEffect', 'useState']);
    expect(metadata['wrapperCount']).toBe(2);
    expect(metadata['avgDepth']).toBe(1.2);
    expect(metadata['maxDepth']).toBe(2);
    expect(metadata['totalUsages']).toBe(15);
    expect(metadata['fileSpread']).toBe(3);
    expect(metadata['suggestedNames']).toEqual(['useAuth', 'useSession']);
    expect(metadata['wrapperNames']).toEqual(['useAuth', 'useSession']);
  });
});

// =============================================================================
// isWrapperPattern Tests
// =============================================================================

describe('isWrapperPattern', () => {
  it('should identify patterns by detector ID', () => {
    const pattern = clusterToPattern(createCluster());
    expect(isWrapperPattern(pattern)).toBe(true);
  });

  it('should identify patterns by ID prefix', () => {
    const pattern = {
      id: 'wrapper-test',
      detectorId: 'other-detector',
      tags: [],
    } as unknown as Pattern;

    expect(isWrapperPattern(pattern)).toBe(true);
  });

  it('should identify patterns by tag', () => {
    const pattern = {
      id: 'other-id',
      detectorId: 'other-detector',
      tags: ['wrapper'],
    } as unknown as Pattern;

    expect(isWrapperPattern(pattern)).toBe(true);
  });

  it('should return false for non-wrapper patterns', () => {
    const pattern = {
      id: 'api-pattern',
      detectorId: 'api-detector',
      tags: ['api'],
    } as unknown as Pattern;

    expect(isWrapperPattern(pattern)).toBe(false);
  });
});

// =============================================================================
// extractWrapperInfo Tests
// =============================================================================

describe('extractWrapperInfo', () => {
  it('should extract wrapper info from wrapper pattern', () => {
    const cluster = createCluster();
    const pattern = clusterToPattern(cluster);

    const info = extractWrapperInfo(pattern);

    expect(info).not.toBeNull();
    expect(info?.primitiveSignature).toEqual(['useEffect', 'useState']);
    expect(info?.avgDepth).toBe(1.2);
    expect(info?.maxDepth).toBe(2);
  });

  it('should return null for non-wrapper patterns', () => {
    const pattern = {
      id: 'api-pattern',
      detectorId: 'api-detector',
      tags: ['api'],
      detector: { type: 'ast', config: {} },
    } as unknown as Pattern;

    expect(extractWrapperInfo(pattern)).toBeNull();
  });

  it('should handle missing config fields gracefully', () => {
    const pattern = {
      id: 'wrapper-test',
      detectorId: 'wrapper-detector',
      tags: ['wrapper'],
      detector: { type: 'semantic', config: {} },
      subcategory: 'auth-wrapper',
    } as unknown as Pattern;

    const info = extractWrapperInfo(pattern);

    expect(info).not.toBeNull();
    expect(info?.primitiveSignature).toEqual([]);
    expect(info?.avgDepth).toBe(1);
    expect(info?.maxDepth).toBe(1);
    expect(info?.wrapperCategory).toBe('auth-wrapper');
  });
});

// =============================================================================
// Edge Cases
// =============================================================================

describe('edge cases', () => {
  it('should handle cluster with empty wrappers', () => {
    const cluster = createCluster({ wrappers: [] });
    const pattern = clusterToPattern(cluster);

    expect(pattern.locations).toHaveLength(0);
  });

  it('should handle cluster with empty primitive signature', () => {
    const cluster = createCluster({ primitiveSignature: [] });
    const pattern = clusterToPattern(cluster);

    expect(pattern.tags).toContain('wrapper');
    expect(pattern.description).toContain('Wraps: ');
  });

  it('should handle empty clusters array', () => {
    const patterns = clustersToPatterns([]);
    expect(patterns).toHaveLength(0);
  });

  it('should handle special characters in primitive names', () => {
    const cluster = createCluster({
      primitiveSignature: ['@decorator', '$special', 'normal'],
    });

    const id = generatePatternId(cluster);

    // Should sanitize special characters
    expect(id).not.toContain('@');
    expect(id).not.toContain('$');
  });
});
