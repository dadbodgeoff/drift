import { describe, it, expect } from 'vitest';
import {
  applyExclusions,
  applyClusterExclusions,
  getLanguageExclusions,
  createExclusionRule,
  excludeByName,
  excludeByFile,
  EXCLUSION_RULES,
  type ExclusionRule,
} from '../clustering/exclusions.js';
import type { WrapperFunction, WrapperCluster } from '../types.js';

// =============================================================================
// Test Helpers
// =============================================================================

function createWrapper(overrides: Partial<WrapperFunction> = {}): WrapperFunction {
  const name = overrides.name ?? 'testWrapper';
  return {
    name,
    qualifiedName: overrides.qualifiedName ?? `test.${name}`,
    file: 'src/test.ts',
    line: 10,
    language: 'typescript',
    directPrimitives: ['useState'],
    transitivePrimitives: [],
    primitiveSignature: ['useState'],
    depth: 1,
    callsWrappers: [],
    calledBy: ['caller1'],
    isFactory: false,
    isHigherOrder: false,
    isDecorator: false,
    isAsync: false,
    ...overrides,
  };
}

function createCluster(overrides: Partial<WrapperCluster> = {}): WrapperCluster {
  return {
    id: 'cluster-1',
    name: 'Test Cluster',
    description: 'A test cluster',
    primitiveSignature: ['useState'],
    wrappers: [createWrapper()],
    confidence: 0.8,
    category: 'state-management',
    avgDepth: 1,
    maxDepth: 1,
    totalUsages: 5,
    fileSpread: 1,
    suggestedNames: ['useTest'],
    ...overrides,
  };
}

// =============================================================================
// applyExclusions Tests
// =============================================================================

describe('applyExclusions', () => {
  it('should exclude test utilities by name', () => {
    const wrappers = [
      createWrapper({ name: 'mockFetch', qualifiedName: 'test.mockFetch' }),
      createWrapper({ name: 'stubApi', qualifiedName: 'test.stubApi' }),
      createWrapper({ name: 'useAuth', qualifiedName: 'hooks.useAuth' }),
    ];

    const result = applyExclusions(wrappers);

    expect(result.included).toHaveLength(1);
    expect(result.included[0]?.name).toBe('useAuth');
    expect(result.excluded).toHaveLength(2);
    expect(result.reasons.get('test.mockFetch')).toBe('Test Utilities');
    expect(result.reasons.get('test.stubApi')).toBe('Test Utilities');
  });

  it('should exclude test utilities by file path', () => {
    const wrappers = [
      createWrapper({ name: 'useAuth', file: 'src/__tests__/auth.test.ts' }),
      createWrapper({ name: 'useData', file: 'src/hooks/useData.ts' }),
    ];

    const result = applyExclusions(wrappers);

    expect(result.included).toHaveLength(1);
    expect(result.included[0]?.name).toBe('useData');
    expect(result.excluded).toHaveLength(1);
  });

  it('should exclude generated code', () => {
    const wrappers = [
      createWrapper({ name: 'useGenerated', file: 'src/__generated__/types.ts' }),
      createWrapper({ name: 'useAuto', file: 'src/hooks.auto.ts' }),
      createWrapper({ name: 'useReal', file: 'src/hooks/useReal.ts' }),
    ];

    const result = applyExclusions(wrappers);

    expect(result.included).toHaveLength(1);
    expect(result.included[0]?.name).toBe('useReal');
    expect(result.excluded).toHaveLength(2);
  });

  it('should exclude single-use wrappers (no callers)', () => {
    const wrappers = [
      createWrapper({ name: 'useOrphan', calledBy: [] }),
      createWrapper({ name: 'usePopular', calledBy: ['a', 'b', 'c'] }),
    ];

    const result = applyExclusions(wrappers);

    expect(result.included).toHaveLength(1);
    expect(result.included[0]?.name).toBe('usePopular');
    expect(result.reasons.get('test.useOrphan')).toBe('Single Use');
  });

  it('should exclude trivial wrappers', () => {
    const wrappers = [
      createWrapper({
        name: 'useState',
        primitiveSignature: ['useState'],
        isFactory: false,
        isHigherOrder: false,
        isDecorator: false,
      }),
      createWrapper({
        name: 'myuseState',
        primitiveSignature: ['useState'],
        isFactory: false,
        isHigherOrder: false,
        isDecorator: false,
      }),
      createWrapper({
        name: 'useEnhancedState',
        primitiveSignature: ['useState'],
        isFactory: true,
      }),
    ];

    const result = applyExclusions(wrappers);

    expect(result.included).toHaveLength(1);
    expect(result.included[0]?.name).toBe('useEnhancedState');
  });

  it('should exclude internal/private functions', () => {
    const wrappers = [
      createWrapper({ name: '_privateHelper' }),
      createWrapper({ name: '__internal' }),
      createWrapper({ name: 'publicHook' }),
    ];

    const result = applyExclusions(wrappers);

    expect(result.included).toHaveLength(1);
    expect(result.included[0]?.name).toBe('publicHook');
  });

  it('should exclude lifecycle methods', () => {
    const wrappers = [
      createWrapper({ name: 'componentDidMount' }),
      createWrapper({ name: 'ngOnInit' }),
      createWrapper({ name: 'useCustomHook' }),
    ];

    const result = applyExclusions(wrappers);

    expect(result.included).toHaveLength(1);
    expect(result.included[0]?.name).toBe('useCustomHook');
  });

  it('should exclude simple event handlers', () => {
    const wrappers = [
      createWrapper({
        name: 'onClick',
        depth: 1,
        primitiveSignature: ['setState'],
      }),
      createWrapper({
        name: 'handleSubmit',
        depth: 1,
        primitiveSignature: ['fetch'],
      }),
      createWrapper({
        name: 'handleComplexSubmit',
        depth: 2,
        primitiveSignature: ['fetch', 'validate'],
      }),
    ];

    const result = applyExclusions(wrappers);

    // Complex handler should be included
    expect(result.included).toHaveLength(1);
    expect(result.included[0]?.name).toBe('handleComplexSubmit');
  });

  it('should use custom rules when provided', () => {
    const customRule: ExclusionRule = {
      id: 'custom',
      name: 'Custom Rule',
      description: 'Exclude wrappers starting with "legacy"',
      applies: (w) => w.name.startsWith('legacy'),
    };

    const wrappers = [
      createWrapper({ name: 'legacyAuth' }),
      createWrapper({ name: 'modernAuth' }),
    ];

    const result = applyExclusions(wrappers, [customRule]);

    expect(result.included).toHaveLength(1);
    expect(result.included[0]?.name).toBe('modernAuth');
    expect(result.reasons.get('test.legacyAuth')).toBe('Custom Rule');
  });
});

// =============================================================================
// applyClusterExclusions Tests
// =============================================================================

describe('applyClusterExclusions', () => {
  it('should exclude clusters below minimum size', () => {
    const clusters = [
      createCluster({ wrappers: [createWrapper()] }),
      createCluster({
        wrappers: [createWrapper(), createWrapper({ name: 'w2' })],
      }),
    ];

    const result = applyClusterExclusions(clusters, 2);

    expect(result).toHaveLength(1);
    expect(result[0]?.wrappers).toHaveLength(2);
  });

  it('should exclude low-confidence clusters', () => {
    const clusters = [
      createCluster({ confidence: 0.2 }),
      createCluster({ confidence: 0.8 }),
    ];

    const result = applyClusterExclusions(clusters, 1, 0.5);

    expect(result).toHaveLength(1);
    expect(result[0]?.confidence).toBe(0.8);
  });

  it('should exclude clusters with only test files', () => {
    const clusters = [
      createCluster({
        wrappers: [
          createWrapper({ file: 'src/__tests__/hook.test.ts' }),
          createWrapper({ file: 'src/hooks.spec.ts' }),
        ],
      }),
      createCluster({
        wrappers: [
          createWrapper({ file: 'src/hooks/useAuth.ts' }),
          createWrapper({ file: 'src/hooks/useData.ts' }),
        ],
      }),
    ];

    const result = applyClusterExclusions(clusters, 1, 0);

    expect(result).toHaveLength(1);
    expect(result[0]?.wrappers[0]?.file).toBe('src/hooks/useAuth.ts');
  });
});

// =============================================================================
// getLanguageExclusions Tests
// =============================================================================

describe('getLanguageExclusions', () => {
  it('should return base rules plus TypeScript-specific rules', () => {
    const rules = getLanguageExclusions('typescript');

    expect(rules.length).toBeGreaterThan(EXCLUSION_RULES.length);
    expect(rules.some((r) => r.id === 'react-internal')).toBe(true);
  });

  it('should return base rules plus Python-specific rules', () => {
    const rules = getLanguageExclusions('python');

    expect(rules.length).toBeGreaterThan(EXCLUSION_RULES.length);
    expect(rules.some((r) => r.id === 'dunder-methods')).toBe(true);
    expect(rules.some((r) => r.id === 'pytest-fixtures')).toBe(true);
  });

  it('should return base rules plus Java-specific rules', () => {
    const rules = getLanguageExclusions('java');

    expect(rules.length).toBeGreaterThan(EXCLUSION_RULES.length);
    expect(rules.some((r) => r.id === 'spring-config')).toBe(true);
  });

  it('should return base rules plus C#-specific rules', () => {
    const rules = getLanguageExclusions('csharp');

    expect(rules.length).toBeGreaterThan(EXCLUSION_RULES.length);
    expect(rules.some((r) => r.id === 'aspnet-config')).toBe(true);
  });

  it('should return base rules plus PHP-specific rules', () => {
    const rules = getLanguageExclusions('php');

    expect(rules.length).toBeGreaterThan(EXCLUSION_RULES.length);
    expect(rules.some((r) => r.id === 'laravel-magic')).toBe(true);
  });

  it('should exclude Python dunder methods', () => {
    const rules = getLanguageExclusions('python');
    const dunderRule = rules.find((r) => r.id === 'dunder-methods');

    expect(dunderRule).toBeDefined();
    expect(dunderRule?.applies(createWrapper({ name: '__init__' }))).toBe(true);
    expect(dunderRule?.applies(createWrapper({ name: '__str__' }))).toBe(true);
    expect(dunderRule?.applies(createWrapper({ name: 'normal_func' }))).toBe(false);
  });

  it('should exclude ASP.NET configuration methods', () => {
    const rules = getLanguageExclusions('csharp');
    const aspnetRule = rules.find((r) => r.id === 'aspnet-config');

    expect(aspnetRule).toBeDefined();
    expect(aspnetRule?.applies(createWrapper({ name: 'ConfigureServices' }))).toBe(true);
    expect(aspnetRule?.applies(createWrapper({ name: 'Configure' }))).toBe(true);
    expect(aspnetRule?.applies(createWrapper({ name: 'AddAuthentication' }))).toBe(true);
    expect(aspnetRule?.applies(createWrapper({ name: 'GetUser' }))).toBe(false);
  });
});

// =============================================================================
// Custom Rule Builder Tests
// =============================================================================

describe('createExclusionRule', () => {
  it('should create a custom exclusion rule', () => {
    const rule = createExclusionRule(
      'custom-id',
      'Custom Name',
      'Custom description',
      (w) => w.name.includes('deprecated')
    );

    expect(rule.id).toBe('custom-id');
    expect(rule.name).toBe('Custom Name');
    expect(rule.applies(createWrapper({ name: 'deprecatedHook' }))).toBe(true);
    expect(rule.applies(createWrapper({ name: 'modernHook' }))).toBe(false);
  });
});

describe('excludeByName', () => {
  it('should create a name-based exclusion rule with strings', () => {
    const rule = excludeByName('legacy', 'Legacy Code', ['legacy', 'old']);

    expect(rule.applies(createWrapper({ name: 'legacyAuth' }))).toBe(true);
    expect(rule.applies(createWrapper({ name: 'oldData' }))).toBe(true);
    expect(rule.applies(createWrapper({ name: 'newAuth' }))).toBe(false);
  });

  it('should create a name-based exclusion rule with regex', () => {
    const rule = excludeByName('versioned', 'Versioned', [/^v\d+_/]);

    expect(rule.applies(createWrapper({ name: 'v1_auth' }))).toBe(true);
    expect(rule.applies(createWrapper({ name: 'v2_data' }))).toBe(true);
    expect(rule.applies(createWrapper({ name: 'auth' }))).toBe(false);
  });
});

describe('excludeByFile', () => {
  it('should create a file-based exclusion rule', () => {
    const rule = excludeByFile('vendor', 'Vendor Code', ['vendor/', 'third-party/']);

    expect(rule.applies(createWrapper({ file: 'vendor/lib/auth.ts' }))).toBe(true);
    expect(rule.applies(createWrapper({ file: 'third-party/utils.ts' }))).toBe(true);
    expect(rule.applies(createWrapper({ file: 'src/hooks/auth.ts' }))).toBe(false);
  });
});

// =============================================================================
// Edge Cases
// =============================================================================

describe('edge cases', () => {
  it('should handle empty wrapper list', () => {
    const result = applyExclusions([]);

    expect(result.included).toHaveLength(0);
    expect(result.excluded).toHaveLength(0);
    expect(result.reasons.size).toBe(0);
  });

  it('should handle empty cluster list', () => {
    const result = applyClusterExclusions([]);

    expect(result).toHaveLength(0);
  });

  it('should handle wrappers with empty primitive signature', () => {
    const wrapper = createWrapper({ primitiveSignature: [] });
    const result = applyExclusions([wrapper]);

    // Should not crash, wrapper may or may not be excluded based on other rules
    expect(result.included.length + result.excluded.length).toBe(1);
  });

  it('should apply first matching rule only', () => {
    const wrappers = [
      createWrapper({
        name: 'mockTestHelper',
        file: 'src/__tests__/mock.test.ts',
      }),
    ];

    const result = applyExclusions(wrappers);

    // Should be excluded by first matching rule (test utilities by name)
    expect(result.excluded).toHaveLength(1);
    expect(result.reasons.get('test.mockTestHelper')).toBe('Test Utilities');
  });
});
