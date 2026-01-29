/**
 * Wrapper Exclusion Rules
 *
 * Filters out false positives from wrapper detection.
 * Excludes simple utilities, direct framework usage, and other non-patterns.
 */

import type { WrapperFunction, WrapperCluster, SupportedLanguage } from '../types.js';

// =============================================================================
// Types
// =============================================================================

export interface ExclusionRule {
  id: string;
  name: string;
  description: string;
  applies: (wrapper: WrapperFunction) => boolean;
}

export interface ExclusionResult {
  excluded: WrapperFunction[];
  included: WrapperFunction[];
  reasons: Map<string, string>;
}

// =============================================================================
// Exclusion Rules
// =============================================================================

/**
 * Built-in exclusion rules
 */
export const EXCLUSION_RULES: ExclusionRule[] = [
  // 1. Test utilities - not real patterns
  {
    id: 'test-utilities',
    name: 'Test Utilities',
    description: 'Exclude test helper functions and mocks',
    applies: (w) => {
      const testPatterns = [
        /^mock/i,
        /^stub/i,
        /^fake/i,
        /^spy/i,
        /^render.*test/i,
        /^setup.*test/i,
        /^create.*mock/i,
        /test.*helper/i,
        /test.*util/i,
        /__test__/,
        /\.test\./,
        /\.spec\./,
      ];
      return testPatterns.some((p) => p.test(w.name) || p.test(w.file));
    },
  },

  // 2. Generated code - not human patterns
  {
    id: 'generated-code',
    name: 'Generated Code',
    description: 'Exclude auto-generated files',
    applies: (w) => {
      const generatedPatterns = [
        /\.generated\./,
        /\.g\./,
        /\.auto\./,
        /__generated__/,
        /node_modules/,
        /dist\//,
        /build\//,
        /\.d\.ts$/,
      ];
      return generatedPatterns.some((p) => p.test(w.file));
    },
  },

  // 3. Single-use wrappers - not patterns
  {
    id: 'single-use',
    name: 'Single Use',
    description: 'Exclude wrappers used only once (not a pattern)',
    applies: (w) => w.calledBy.length === 0,
  },

  // 4. Trivial wrappers - just re-exports
  {
    id: 'trivial-wrapper',
    name: 'Trivial Wrapper',
    description: 'Exclude wrappers that just re-export primitives',
    applies: (w) => {
      // If wrapper has only 1 primitive and no additional logic indicators
      if (w.primitiveSignature.length !== 1) {return false;}
      if (w.isFactory || w.isHigherOrder || w.isDecorator) {return false;}
      // Check if name is just the primitive name with minor variation
      const primName = w.primitiveSignature[0]?.toLowerCase() || '';
      const wrapperName = w.name.toLowerCase();
      return (
        wrapperName === primName ||
        wrapperName === `my${primName}` ||
        wrapperName === `custom${primName}` ||
        wrapperName === `${primName}wrapper`
      );
    },
  },

  // 5. Internal/private functions
  {
    id: 'internal-functions',
    name: 'Internal Functions',
    description: 'Exclude internal/private helper functions',
    applies: (w) => {
      const internalPatterns = [
        /^_/,
        /^__/,
        /^internal/i,
        /^private/i,
        /^helper$/i,
        /^util$/i,
      ];
      return internalPatterns.some((p) => p.test(w.name));
    },
  },

  // 6. Lifecycle methods - framework-specific, not custom patterns
  {
    id: 'lifecycle-methods',
    name: 'Lifecycle Methods',
    description: 'Exclude framework lifecycle methods',
    applies: (w) => {
      const lifecyclePatterns = [
        // React
        /^componentDid/,
        /^componentWill/,
        /^shouldComponent/,
        /^getDerived/,
        /^getSnapshot/,
        // Vue
        /^on(Mounted|Updated|Unmounted|BeforeMount|BeforeUpdate|BeforeUnmount)/,
        // Angular
        /^ngOn/,
        /^ngAfter/,
        /^ngDo/,
        // General
        /^constructor$/,
        /^init$/i,
        /^destroy$/i,
        /^dispose$/i,
      ];
      return lifecyclePatterns.some((p) => p.test(w.name));
    },
  },

  // 7. Event handlers that just call primitives
  {
    id: 'simple-handlers',
    name: 'Simple Event Handlers',
    description: 'Exclude simple event handlers',
    applies: (w) => {
      const handlerPatterns = [
        /^on[A-Z][a-z]+$/,
        /^handle[A-Z][a-z]+$/,
      ];
      // Only exclude if it's a simple handler (depth 1, single primitive)
      return (
        handlerPatterns.some((p) => p.test(w.name)) &&
        w.depth === 1 &&
        w.primitiveSignature.length === 1
      );
    },
  },
];

// =============================================================================
// Exclusion Functions
// =============================================================================

/**
 * Apply exclusion rules to wrappers
 */
export function applyExclusions(
  wrappers: WrapperFunction[],
  rules: ExclusionRule[] = EXCLUSION_RULES
): ExclusionResult {
  const excluded: WrapperFunction[] = [];
  const included: WrapperFunction[] = [];
  const reasons = new Map<string, string>();

  for (const wrapper of wrappers) {
    let isExcluded = false;
    let excludeReason = '';

    for (const rule of rules) {
      if (rule.applies(wrapper)) {
        isExcluded = true;
        excludeReason = rule.name;
        break;
      }
    }

    if (isExcluded) {
      excluded.push(wrapper);
      reasons.set(wrapper.qualifiedName, excludeReason);
    } else {
      included.push(wrapper);
    }
  }

  return { excluded, included, reasons };
}

/**
 * Apply exclusions to clusters
 */
export function applyClusterExclusions(
  clusters: WrapperCluster[],
  minClusterSize: number = 2,
  minConfidence: number = 0.3
): WrapperCluster[] {
  return clusters.filter((cluster) => {
    // Exclude clusters that are too small after exclusions
    if (cluster.wrappers.length < minClusterSize) {return false;}

    // Exclude low-confidence clusters
    if (cluster.confidence < minConfidence) {return false;}

    // Exclude clusters with only test files
    const nonTestFiles = cluster.wrappers.filter(
      (w) => !isTestFile(w.file)
    );
    if (nonTestFiles.length === 0) {return false;}

    return true;
  });
}

/**
 * Check if file is a test file
 */
function isTestFile(filePath: string): boolean {
  const testPatterns = [
    /\.test\.[jt]sx?$/,
    /\.spec\.[jt]sx?$/,
    /_test\.(py|go|java|cs|php)$/,
    /Test\.(java|cs)$/,
    /Tests?\//,
    /__tests__\//,
    /test_.*\.py$/,
  ];

  return testPatterns.some((pattern) => pattern.test(filePath));
}

// =============================================================================
// Language-Specific Exclusions
// =============================================================================

/**
 * Get language-specific exclusion rules
 */
export function getLanguageExclusions(language: SupportedLanguage): ExclusionRule[] {
  const baseRules = [...EXCLUSION_RULES];

  switch (language) {
    case 'typescript':
      return [
        ...baseRules,
        {
          id: 'react-internal',
          name: 'React Internals',
          description: 'Exclude React internal patterns',
          applies: (w) => /^__REACT_/.test(w.name),
        },
      ];

    case 'python':
      return [
        ...baseRules,
        {
          id: 'dunder-methods',
          name: 'Dunder Methods',
          description: 'Exclude Python dunder methods',
          applies: (w) => /^__.*__$/.test(w.name),
        },
        {
          id: 'pytest-fixtures',
          name: 'Pytest Fixtures',
          description: 'Exclude pytest fixture functions (detected by naming)',
          applies: (w) =>
            /^fixture_/.test(w.name) || /_fixture$/.test(w.name),
        },
      ];

    case 'java':
      return [
        ...baseRules,
        {
          id: 'spring-config',
          name: 'Spring Configuration',
          description: 'Exclude Spring configuration methods',
          applies: (w) =>
            /^(configure|init|destroy|afterPropertiesSet)$/i.test(w.name) ||
            /Config(uration)?$/.test(w.file),
        },
      ];

    case 'csharp':
      return [
        ...baseRules,
        {
          id: 'aspnet-config',
          name: 'ASP.NET Configuration',
          description: 'Exclude ASP.NET configuration methods',
          applies: (w) =>
            /^Configure(Services|App)?$/.test(w.name) ||
            /^Add[A-Z]/.test(w.name),
        },
      ];

    case 'php':
      return [
        ...baseRules,
        {
          id: 'laravel-magic',
          name: 'Laravel Magic Methods',
          description: 'Exclude Laravel magic methods',
          applies: (w) =>
            /^(boot|register|handle)$/.test(w.name) ||
            /^scope[A-Z]/.test(w.name),
        },
      ];

    default:
      return baseRules;
  }
}

// =============================================================================
// Custom Rule Builder
// =============================================================================

/**
 * Create a custom exclusion rule
 */
export function createExclusionRule(
  id: string,
  name: string,
  description: string,
  predicate: (wrapper: WrapperFunction) => boolean
): ExclusionRule {
  return {
    id,
    name,
    description,
    applies: predicate,
  };
}

/**
 * Create a name-based exclusion rule
 */
export function excludeByName(
  id: string,
  name: string,
  patterns: (string | RegExp)[]
): ExclusionRule {
  const regexPatterns = patterns.map((p) =>
    typeof p === 'string' ? new RegExp(p, 'i') : p
  );

  return {
    id,
    name,
    description: `Exclude wrappers matching: ${patterns.join(', ')}`,
    applies: (w) => regexPatterns.some((p) => p.test(w.name)),
  };
}

/**
 * Create a file-based exclusion rule
 */
export function excludeByFile(
  id: string,
  name: string,
  patterns: (string | RegExp)[]
): ExclusionRule {
  const regexPatterns = patterns.map((p) =>
    typeof p === 'string' ? new RegExp(p, 'i') : p
  );

  return {
    id,
    name,
    description: `Exclude files matching: ${patterns.join(', ')}`,
    applies: (w) => regexPatterns.some((p) => p.test(w.file)),
  };
}
