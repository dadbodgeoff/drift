/**
 * Default Policies
 * 
 * @license Apache-2.0
 * 
 * Built-in default policies for quality gates.
 * These provide sensible defaults for common use cases.
 */

import type { QualityPolicy } from '../types.js';

/**
 * Built-in default policies.
 */
export const DEFAULT_POLICIES: Record<string, QualityPolicy> = {
  /**
   * Default policy - balanced settings for most projects.
   */
  default: {
    id: 'default',
    name: 'Default Policy',
    description: 'Balanced quality gate settings for most projects',
    version: '1.0.0',
    scope: {},
    gates: {
      'pattern-compliance': {
        enabled: true,
        blocking: true,
        minComplianceRate: 80,
        maxNewOutliers: 0,
        categories: [],
        minPatternConfidence: 0.7,
        approvedOnly: true,
      },
      'constraint-verification': {
        enabled: true,
        blocking: true,
        enforceApproved: true,
        enforceDiscovered: false,
        minConfidence: 0.9,
        categories: [],
      },
      'regression-detection': {
        enabled: true,
        blocking: false, // Warn only by default
        maxConfidenceDrop: 5,
        maxComplianceDrop: 10,
        maxNewOutliersPerPattern: 3,
        criticalCategories: ['auth', 'security'],
        baseline: 'branch-base',
      },
      'impact-simulation': {
        enabled: true,
        blocking: false, // Warn only by default
        maxFilesAffected: 20,
        maxFunctionsAffected: 50,
        maxEntryPointsAffected: 10,
        maxFrictionScore: 60,
        analyzeSensitiveData: true,
      },
      'security-boundary': {
        enabled: true,
        blocking: true,
        allowNewSensitiveAccess: false,
        protectedTables: ['users', 'payments', 'credentials', 'tokens'],
        maxDataFlowDepth: 5,
        requiredAuthPatterns: ['authenticate', 'authorize', 'checkAuth', 'requireAuth'],
      },
      'custom-rules': {
        enabled: false,
        blocking: true,
        ruleFiles: [],
        inlineRules: [],
        useBuiltInRules: false,
      },
    },
    aggregation: {
      mode: 'any',
      requiredGates: ['pattern-compliance'],
    },
    actions: {
      onPass: [],
      onFail: [],
      onWarn: [],
    },
    metadata: {
      createdAt: '2026-01-25T00:00:00Z',
      updatedAt: '2026-01-25T00:00:00Z',
    },
  },

  /**
   * Strict policy - for main/release branches.
   */
  strict: {
    id: 'strict',
    name: 'Strict Policy',
    description: 'Strict quality gate settings for main/release branches',
    version: '1.0.0',
    scope: {
      branches: ['main', 'master', 'release/*'],
    },
    gates: {
      'pattern-compliance': {
        enabled: true,
        blocking: true,
        minComplianceRate: 90,
        maxNewOutliers: 0,
        categories: [],
        minPatternConfidence: 0.8,
        approvedOnly: true,
      },
      'constraint-verification': {
        enabled: true,
        blocking: true,
        enforceApproved: true,
        enforceDiscovered: true, // Also enforce discovered
        minConfidence: 0.85,
        categories: [],
      },
      'regression-detection': {
        enabled: true,
        blocking: true, // Block on regressions
        maxConfidenceDrop: 2,
        maxComplianceDrop: 5,
        maxNewOutliersPerPattern: 1,
        criticalCategories: ['auth', 'security', 'api'],
        baseline: 'branch-base',
      },
      'impact-simulation': {
        enabled: true,
        blocking: true, // Block on high impact
        maxFilesAffected: 15,
        maxFunctionsAffected: 30,
        maxEntryPointsAffected: 5,
        maxFrictionScore: 40,
        analyzeSensitiveData: true,
      },
      'security-boundary': {
        enabled: true,
        blocking: true,
        allowNewSensitiveAccess: false,
        protectedTables: ['users', 'payments', 'credentials', 'tokens', 'sessions'],
        maxDataFlowDepth: 3,
        requiredAuthPatterns: ['authenticate', 'authorize', 'checkAuth', 'requireAuth'],
      },
      'custom-rules': {
        enabled: true,
        blocking: true,
        ruleFiles: [],
        inlineRules: [],
        useBuiltInRules: true,
      },
    },
    aggregation: {
      mode: 'any',
      requiredGates: ['pattern-compliance', 'security-boundary'],
    },
    actions: {
      onPass: [],
      onFail: [],
      onWarn: [],
    },
    metadata: {
      createdAt: '2026-01-25T00:00:00Z',
      updatedAt: '2026-01-25T00:00:00Z',
    },
  },

  /**
   * Relaxed policy - for feature branches.
   */
  relaxed: {
    id: 'relaxed',
    name: 'Relaxed Policy',
    description: 'Relaxed quality gate settings for feature branches',
    version: '1.0.0',
    scope: {
      branches: ['feature/*', 'fix/*', 'chore/*'],
    },
    gates: {
      'pattern-compliance': {
        enabled: true,
        blocking: true,
        minComplianceRate: 70,
        maxNewOutliers: 3,
        categories: [],
        minPatternConfidence: 0.6,
        approvedOnly: true,
      },
      'constraint-verification': {
        enabled: true,
        blocking: false, // Warn only
        enforceApproved: true,
        enforceDiscovered: false,
        minConfidence: 0.9,
        categories: [],
      },
      'regression-detection': 'skip',
      'impact-simulation': {
        enabled: true,
        blocking: false, // Warn only
        maxFilesAffected: 50,
        maxFunctionsAffected: 100,
        maxEntryPointsAffected: 20,
        maxFrictionScore: 80,
        analyzeSensitiveData: false,
      },
      'security-boundary': {
        enabled: true,
        blocking: true, // Still block on security
        allowNewSensitiveAccess: true, // But allow new access
        protectedTables: ['users', 'payments', 'credentials'],
        maxDataFlowDepth: 10,
        requiredAuthPatterns: ['authenticate', 'authorize'],
      },
      'custom-rules': 'skip',
    },
    aggregation: {
      mode: 'any',
    },
    actions: {
      onPass: [],
      onFail: [],
      onWarn: [],
    },
    metadata: {
      createdAt: '2026-01-25T00:00:00Z',
      updatedAt: '2026-01-25T00:00:00Z',
    },
  },

  /**
   * CI-only policy - minimal checks for fast CI.
   */
  'ci-fast': {
    id: 'ci-fast',
    name: 'CI Fast Policy',
    description: 'Minimal checks for fast CI feedback',
    version: '1.0.0',
    scope: {},
    gates: {
      'pattern-compliance': {
        enabled: true,
        blocking: true,
        minComplianceRate: 70,
        maxNewOutliers: 5,
        categories: [],
        minPatternConfidence: 0.7,
        approvedOnly: true,
      },
      'constraint-verification': 'skip',
      'regression-detection': 'skip',
      'impact-simulation': 'skip',
      'security-boundary': 'skip',
      'custom-rules': 'skip',
    },
    aggregation: {
      mode: 'any',
    },
    actions: {
      onPass: [],
      onFail: [],
      onWarn: [],
    },
    metadata: {
      createdAt: '2026-01-25T00:00:00Z',
      updatedAt: '2026-01-25T00:00:00Z',
    },
  },
};
