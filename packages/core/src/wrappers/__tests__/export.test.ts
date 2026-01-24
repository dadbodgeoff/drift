import { describe, it, expect } from 'vitest';
import {
  exportToJson,
  buildExportResult,
  parseJsonExport,
  validateExport,
} from '../export/json.js';
import type { WrapperAnalysisResult, WrapperFunction, WrapperCluster, DetectedPrimitive } from '../types.js';

// =============================================================================
// Test Helpers
// =============================================================================

function createMockResult(): WrapperAnalysisResult {
  const wrapper: WrapperFunction = {
    name: 'useAuth',
    qualifiedName: 'hooks.useAuth',
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
  };

  const primitive: DetectedPrimitive = {
    name: 'useState',
    framework: 'react',
    category: 'state',
    source: { type: 'import', confidence: 1.0 },
    importPath: 'react',
    usageCount: 15,
    language: 'typescript',
  };

  const cluster: WrapperCluster = {
    id: 'cluster-auth',
    name: 'Authentication Hooks',
    description: 'Hooks for authentication state management',
    primitiveSignature: ['useEffect', 'useState'],
    wrappers: [wrapper],
    confidence: 0.85,
    category: 'authentication',
    avgDepth: 1,
    maxDepth: 1,
    totalUsages: 10,
    fileSpread: 3,
    suggestedNames: ['useAuth', 'useSession'],
  };

  return {
    frameworks: [
      {
        name: 'react',
        version: '18.2.0',
        primitiveCount: 5,
        language: 'typescript',
      },
    ],
    primitives: [primitive],
    wrappers: [wrapper],
    clusters: [cluster],
    factories: [],
    decoratorWrappers: [],
    asyncWrappers: [],
    summary: {
      totalWrappers: 1,
      totalClusters: 1,
      avgDepth: 1,
      maxDepth: 1,
      mostWrappedPrimitive: 'useState',
      mostUsedWrapper: 'useAuth',
      wrappersByLanguage: {
        typescript: 1,
        python: 0,
        java: 0,
        csharp: 0,
        php: 0,
      },
      wrappersByCategory: {
        'state-management': 0,
        'data-fetching': 0,
        'side-effects': 0,
        'authentication': 1,
        'authorization': 0,
        'validation': 0,
        'dependency-injection': 0,
        'middleware': 0,
        'testing': 0,
        'logging': 0,
        'caching': 0,
        'error-handling': 0,
        'async-utilities': 0,
        'form-handling': 0,
        'routing': 0,
        'factory': 0,
        'decorator': 0,
        'utility': 0,
        'other': 0,
      },
    },
  };
}

// =============================================================================
// exportToJson Tests
// =============================================================================

describe('exportToJson', () => {
  it('should export full result to JSON', () => {
    const result = createMockResult();
    const json = exportToJson(result);

    expect(json).toBeTruthy();
    const parsed = JSON.parse(json);

    expect(parsed.version).toBe('1.0.0');
    expect(parsed.exportedAt).toBeTruthy();
    expect(parsed.project.language).toBe('typescript');
    expect(parsed.frameworks).toHaveLength(1);
    expect(parsed.primitives).toHaveLength(1);
    expect(parsed.wrappers).toHaveLength(1);
    expect(parsed.clusters).toHaveLength(1);
    expect(parsed.summary).toBeTruthy();
  });

  it('should support pretty printing', () => {
    const result = createMockResult();
    const json = exportToJson(result, { prettyPrint: true });

    expect(json).toContain('\n');
    expect(json).toContain('  '); // Default indent
  });

  it('should support custom indent size', () => {
    const result = createMockResult();
    const json = exportToJson(result, { prettyPrint: true, indentSize: 4 });

    expect(json).toContain('    '); // 4-space indent
  });

  it('should exclude wrappers when option is false', () => {
    const result = createMockResult();
    const json = exportToJson(result, { includeWrappers: false });
    const parsed = JSON.parse(json);

    expect(parsed.wrappers).toBeUndefined();
    expect(parsed.primitives).toBeDefined();
    expect(parsed.clusters).toBeDefined();
  });

  it('should exclude primitives when option is false', () => {
    const result = createMockResult();
    const json = exportToJson(result, { includePrimitives: false });
    const parsed = JSON.parse(json);

    expect(parsed.primitives).toBeUndefined();
    expect(parsed.wrappers).toBeDefined();
  });

  it('should exclude clusters when option is false', () => {
    const result = createMockResult();
    const json = exportToJson(result, { includeClusters: false });
    const parsed = JSON.parse(json);

    expect(parsed.clusters).toBeUndefined();
    expect(parsed.wrappers).toBeDefined();
  });

  it('should exclude summary when option is false', () => {
    const result = createMockResult();
    const json = exportToJson(result, { includeSummary: false });
    const parsed = JSON.parse(json);

    expect(parsed.summary).toBeUndefined();
    expect(parsed.wrappers).toBeDefined();
  });
});

// =============================================================================
// buildExportResult Tests
// =============================================================================

describe('buildExportResult', () => {
  it('should build export result with all sections', () => {
    const result = createMockResult();
    const exported = buildExportResult(result, {
      includeWrappers: true,
      includePrimitives: true,
      includeClusters: true,
      includeSummary: true,
    });

    expect(exported.version).toBe('1.0.0');
    expect(exported.frameworks[0]?.name).toBe('react');
    expect(exported.frameworks[0]?.version).toBe('18.2.0');
    expect(exported.primitives?.[0]?.name).toBe('useState');
    expect(exported.wrappers?.[0]?.name).toBe('useAuth');
    expect(exported.clusters?.[0]?.name).toBe('Authentication Hooks');
    expect(exported.summary?.totalWrappers).toBe(1);
  });

  it('should correctly export wrapper flags', () => {
    const result = createMockResult();
    result.wrappers[0] = {
      ...result.wrappers[0]!,
      isFactory: true,
      isHigherOrder: true,
      isAsync: true,
    };

    const exported = buildExportResult(result, {
      includeWrappers: true,
      includePrimitives: false,
      includeClusters: false,
      includeSummary: false,
    });

    const wrapper = exported.wrappers?.[0];
    expect(wrapper?.flags.isFactory).toBe(true);
    expect(wrapper?.flags.isHigherOrder).toBe(true);
    expect(wrapper?.flags.isAsync).toBe(true);
    expect(wrapper?.flags.isDecorator).toBe(false);
  });

  it('should correctly export cluster metrics', () => {
    const result = createMockResult();
    const exported = buildExportResult(result, {
      includeWrappers: false,
      includePrimitives: false,
      includeClusters: true,
      includeSummary: false,
    });

    const cluster = exported.clusters?.[0];
    expect(cluster?.metrics.avgDepth).toBe(1);
    expect(cluster?.metrics.maxDepth).toBe(1);
    expect(cluster?.metrics.totalUsages).toBe(10);
    expect(cluster?.metrics.fileSpread).toBe(3);
  });

  it('should export wrapper qualified names in clusters', () => {
    const result = createMockResult();
    const exported = buildExportResult(result, {
      includeWrappers: false,
      includePrimitives: false,
      includeClusters: true,
      includeSummary: false,
    });

    const cluster = exported.clusters?.[0];
    expect(cluster?.wrappers).toContain('hooks.useAuth');
    expect(cluster?.wrapperCount).toBe(1);
  });
});

// =============================================================================
// parseJsonExport Tests
// =============================================================================

describe('parseJsonExport', () => {
  it('should parse valid JSON export', () => {
    const result = createMockResult();
    const json = exportToJson(result);
    const parsed = parseJsonExport(json);

    expect(parsed.version).toBe('1.0.0');
    expect(parsed.frameworks).toHaveLength(1);
  });

  it('should throw on invalid JSON', () => {
    expect(() => parseJsonExport('not valid json')).toThrow();
  });

  it('should throw on missing version', () => {
    const invalid = JSON.stringify({ frameworks: [] });
    expect(() => parseJsonExport(invalid)).toThrow('Invalid export format: missing version');
  });
});

// =============================================================================
// validateExport Tests
// =============================================================================

describe('validateExport', () => {
  it('should validate correct export format', () => {
    const result = createMockResult();
    const json = exportToJson(result);
    const parsed = JSON.parse(json);

    expect(validateExport(parsed)).toBe(true);
  });

  it('should reject null', () => {
    expect(validateExport(null)).toBe(false);
  });

  it('should reject non-object', () => {
    expect(validateExport('string')).toBe(false);
    expect(validateExport(123)).toBe(false);
    expect(validateExport([])).toBe(false);
  });

  it('should reject missing version', () => {
    expect(validateExport({ exportedAt: '', project: {}, frameworks: [] })).toBe(false);
  });

  it('should reject missing exportedAt', () => {
    expect(validateExport({ version: '1.0.0', project: {}, frameworks: [] })).toBe(false);
  });

  it('should reject missing project', () => {
    expect(validateExport({ version: '1.0.0', exportedAt: '', frameworks: [] })).toBe(false);
  });

  it('should reject missing frameworks', () => {
    expect(validateExport({ version: '1.0.0', exportedAt: '', project: {} })).toBe(false);
  });

  it('should reject non-array frameworks', () => {
    expect(validateExport({ version: '1.0.0', exportedAt: '', project: {}, frameworks: {} })).toBe(false);
  });
});

// =============================================================================
// Edge Cases
// =============================================================================

describe('edge cases', () => {
  it('should handle empty result', () => {
    const emptyResult: WrapperAnalysisResult = {
      frameworks: [],
      primitives: [],
      wrappers: [],
      clusters: [],
      factories: [],
      decoratorWrappers: [],
      asyncWrappers: [],
      summary: {
        totalWrappers: 0,
        totalClusters: 0,
        avgDepth: 0,
        maxDepth: 0,
        mostWrappedPrimitive: 'N/A',
        mostUsedWrapper: 'N/A',
        wrappersByLanguage: {
          typescript: 0,
          python: 0,
          java: 0,
          csharp: 0,
          php: 0,
        },
        wrappersByCategory: {
          'state-management': 0,
          'data-fetching': 0,
          'side-effects': 0,
          'authentication': 0,
          'authorization': 0,
          'validation': 0,
          'dependency-injection': 0,
          'middleware': 0,
          'testing': 0,
          'logging': 0,
          'caching': 0,
          'error-handling': 0,
          'async-utilities': 0,
          'form-handling': 0,
          'routing': 0,
          'factory': 0,
          'decorator': 0,
          'utility': 0,
          'other': 0,
        },
      },
    };

    const json = exportToJson(emptyResult);
    const parsed = JSON.parse(json);

    expect(parsed.frameworks).toHaveLength(0);
    expect(parsed.wrappers).toHaveLength(0);
    expect(parsed.clusters).toHaveLength(0);
  });

  it('should handle wrapper with optional fields undefined', () => {
    const result = createMockResult();
    result.wrappers[0] = {
      ...result.wrappers[0]!,
      returnType: undefined,
      parameterSignature: undefined,
    };

    const json = exportToJson(result);
    const parsed = JSON.parse(json);

    expect(parsed.wrappers[0]).toBeDefined();
  });

  it('should handle framework without version', () => {
    const result = createMockResult();
    result.frameworks[0] = {
      ...result.frameworks[0]!,
      version: undefined,
    };

    const json = exportToJson(result);
    const parsed = JSON.parse(json);

    expect(parsed.frameworks[0].version).toBeUndefined();
  });

  it('should produce valid JSON that can be round-tripped', () => {
    const result = createMockResult();
    const json = exportToJson(result);
    const parsed = JSON.parse(json);
    const reExported = JSON.stringify(parsed);
    const reParsed = JSON.parse(reExported);

    expect(reParsed.version).toBe(parsed.version);
    expect(reParsed.frameworks).toEqual(parsed.frameworks);
  });
});
