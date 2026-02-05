/**
 * @drift/detectors - Pattern detectors for Drift
 *
 * This package provides modular, pluggable pattern detectors:
 * - Registry: Detector registration and lazy loading
 * - Base: Abstract detector classes
 * - 15 categories of detectors (101 total)
 *
 * Usage:
 * ```typescript
 * import { createAllDetectorsArray, BaseDetector } from '@drift/detectors';
 * 
 * const detectors = createAllDetectorsArray();
 * for (const detector of detectors) {
 *   const result = await detector.detect(context);
 * }
 * ```
 */

// Export version
export const VERSION = '0.0.1';

// Registry exports
export * from './registry/index.js';

// Base exports (core interfaces)
export * from './base/index.js';

// Contract exports (BE↔FE mismatch detection)
export * from './contracts/index.js';

// ============================================================================
// Detector Factory Imports
// ============================================================================

// API Detectors
import {
  createAccessibilityDetectors,
  createSemanticHtmlDetector,
  createAriaRolesDetector,
  createKeyboardNavDetector,
  createFocusManagementDetector,
  createHeadingHierarchyDetector,
  createAltTextDetector,
  analyzeSemanticHtml,
  analyzeAriaRoles,
  analyzeKeyboardNav,
  analyzeFocusManagement,
  analyzeHeadingHierarchy,
  analyzeAltText,
  // Learning detectors
  createAriaRolesLearningDetector,
  createKeyboardNavLearningDetector,
  createAltTextLearningDetector,
  createSemanticHtmlLearningDetector,
  createFocusManagementLearningDetector,
  createHeadingHierarchyLearningDetector,
  // Semantic detectors
  createSemanticHtmlSemanticDetector,
  createAriaRolesSemanticDetector,
  createKeyboardNavSemanticDetector,
  createFocusManagementSemanticDetector,
  createHeadingHierarchySemanticDetector,
  createAltTextSemanticDetector,
} from './accessibility/index.js';
import {
  createRouteStructureDetector,
  createHttpMethodsDetector,
  createResponseEnvelopeDetector,
  createErrorFormatDetector,
  createPaginationDetector,
  createClientPatternsDetector,
  createRetryPatternsDetector,
  // Analysis functions for direct use
  analyzeRouteStructure,
  analyzeHttpMethods,
  analyzeResponseEnvelope,
  analyzeErrorFormat,
  analyzePagination,
  analyzeClientPatterns,
  analyzeRetryPatterns,
} from './api/index.js';

// Auth Detectors
import {
  createAuthMiddlewareDetector,
  createTokenHandlingDetector,
  createPermissionChecksDetector,
  createRbacPatternsDetector,
  createResourceOwnershipDetector,
  createAuditLoggingDetector,
  createAllAuthDetectors,
  analyzeAuthMiddleware,
  analyzeTokenHandling,
  analyzePermissions,
  analyzeRbac,
  analyzeOwnership,
  analyzeAuditLogging,
  // Learning detectors
  createTokenHandlingLearningDetector,
  createAuthMiddlewareLearningDetector,
  createPermissionChecksLearningDetector,
  createRBACPatternsLearningDetector,
  createResourceOwnershipLearningDetector,
  createAuditLoggingLearningDetector,
  // Semantic detectors
  createAuditSemanticDetector,
  createAuthMiddlewareSemanticDetector,
  createOwnershipSemanticDetector,
  createPermissionChecksSemanticDetector,
  createRBACSemanticDetector,
  createTokenHandlingSemanticDetector,
} from './auth/index.js';

// Security Detectors
import {
  createComponentStructureDetector,
  createPropsPatternDetector,
  createDuplicateDetector,
  createNearDuplicateDetector,
  createStatePatternDetector,
  createCompositionDetector,
  createRefForwardingDetector,
  // Learning detectors
  createComponentStructureLearningDetector,
  createPropsPatternsLearningDetector,
  createStatePatternsLearningDetector,
  createCompositionLearningDetector,
  createDuplicateDetectionLearningDetector,
  createNearDuplicateLearningDetector,
  createRefForwardingLearningDetector,
  // Semantic detectors
  createComponentStructureSemanticDetector,
  createPropsPatternsSemanticDetector,
  createDuplicateDetectionSemanticDetector,
  createNearDuplicateSemanticDetector,
  createStatePatternsSemanticDetector,
  createCompositionSemanticDetector,
  createRefForwardingSemanticDetector,
  createModalPatternsSemanticDetector,
} from './components/index.js';
import {
  createEnvNamingDetector,
  createRequiredOptionalDetector,
  createDefaultValuesDetector,
  createFeatureFlagsDetector,
  createConfigValidationDetector,
  createEnvironmentDetectionDetector,
  createConfigDetectors,
  analyzeEnvNaming,
  analyzeRequiredOptional,
  analyzeDefaultValues,
  analyzeFeatureFlags,
  analyzeConfigValidation,
  analyzeEnvironmentDetection,
  // Learning detectors
  createFeatureFlagsLearningDetector,
  createEnvNamingLearningDetector,
  createConfigValidationLearningDetector,
  createDefaultValuesLearningDetector,
  createEnvironmentDetectionLearningDetector,
  createRequiredOptionalLearningDetector,
  // Semantic detectors
  createEnvConfigSemanticDetector,
  createFeatureFlagsSemanticDetector,
  createRequiredOptionalSemanticDetector,
  createDefaultValuesSemanticDetector,
  createConfigValidationSemanticDetector,
  createEnvironmentDetectionSemanticDetector,
} from './config/index.js';
import {
  createQueryPatternsDetector,
  createRepositoryPatternDetector,
  createTransactionPatternsDetector,
  createValidationPatternsDetector,
  createDTOPatternsDetector,
  createNPlusOneDetector,
  createConnectionPoolingDetector,
  createAllDataAccessDetectors,
  analyzeQueryPatterns,
  analyzeRepositoryPattern,
  analyzeTransactionPatterns,
  analyzeValidationPatterns,
  analyzeDTOPatterns,
  analyzeNPlusOne,
  analyzeConnectionPooling,
  // Learning detectors
  createRepositoryPatternLearningDetector,
  createQueryPatternsLearningDetector,
  createDTOPatternsLearningDetector,
  createTransactionPatternsLearningDetector,
  createConnectionPoolingLearningDetector,
  createValidationPatternsLearningDetector,
  createNPlusOneLearningDetector,
  // Semantic detectors
  createQueryPatternsSemanticDetector,
  createRepositoryPatternSemanticDetector,
  createTransactionSemanticDetector,
  createValidationSemanticDetector,
  createDTOPatternsSemanticDetector,
  createNPlusOneSemanticDetector,
  createConnectionPoolingSemanticDetector,
  // Data Boundary detectors
  createORMModelSemanticDetector,
  createQueryAccessSemanticDetector,
  createSensitiveFieldSemanticDetector,
} from './data-access/index.js';
import {
  createDocumentationDetectors,
  createJsdocPatternsDetector,
  createReadmeStructureDetector,
  createTodoPatternsDetector,
  createDeprecationDetector,
  createExampleCodeDetector,
  analyzeJsdocPatterns,
  analyzeReadmeStructure,
  analyzeTodoPatterns,
  analyzeDeprecation,
  analyzeExampleCode,
  // Learning detectors
  createJSDocPatternsLearningDetector,
  createTodoPatternsLearningDetector,
  createDeprecationLearningDetector,
  createExampleCodeLearningDetector,
  createReadmeStructureLearningDetector,
  // Semantic detectors
  createJSDocPatternsSemanticDetector,
  createReadmeStructureSemanticDetector,
  createTodoPatternsSemanticDetector,
  createDeprecationSemanticDetector,
  createExampleCodeSemanticDetector,
} from './documentation/index.js';
import {
  createExceptionHierarchyDetector,
  createErrorCodesDetector,
  createTryCatchPlacementDetector,
  createErrorPropagationDetector,
  createAsyncErrorsDetector,
  createCircuitBreakerDetector,
  createErrorLoggingDetector,
  createAllErrorDetectors,
  analyzeExceptionHierarchy,
  analyzeErrorCodes,
  analyzeTryCatchPlacement,
  analyzeErrorPropagation,
  analyzeAsyncErrors,
  analyzeCircuitBreaker,
  analyzeErrorLogging,
  // Learning detectors
  createErrorCodesLearningDetector,
  createExceptionHierarchyLearningDetector,
  createErrorLoggingLearningDetector,
  createTryCatchLearningDetector,
  createAsyncErrorsLearningDetector,
  createCircuitBreakerLearningDetector,
  createErrorPropagationLearningDetector,
  // Semantic detectors
  createExceptionHierarchySemanticDetector,
  createErrorCodesSemanticDetector,
  createTryCatchSemanticDetector,
  createErrorPropagationSemanticDetector,
  createAsyncErrorsSemanticDetector,
  createCircuitBreakerSemanticDetector,
  createErrorLoggingSemanticDetector,
} from './errors/index.js';
import {
  createStructuredFormatDetector,
  createLogLevelsDetector,
  createContextFieldsDetector,
  createCorrelationIdsDetector,
  createPIIRedactionDetector,
  createMetricNamingDetector,
  createHealthChecksDetector,
  createAllLoggingDetectors,
  analyzeStructuredFormat,
  analyzeLogLevels,
  analyzeContextFields,
  analyzeCorrelationIds,
  analyzePIIRedaction,
  analyzeMetricNaming,
  analyzeHealthChecks,
  // Learning detectors
  createLogLevelsLearningDetector,
  createMetricNamingLearningDetector,
  createStructuredFormatLearningDetector,
  createContextFieldsLearningDetector,
  createCorrelationIdsLearningDetector,
  createHealthChecksLearningDetector,
  createPIIRedactionLearningDetector,
  // Semantic detectors
  createStructuredLoggingSemanticDetector,
  createLogLevelsSemanticDetector,
  createContextFieldsSemanticDetector,
  createCorrelationIdsSemanticDetector,
  createPIIRedactionSemanticDetector,
  createMetricsSemanticDetector,
  createHealthChecksSemanticDetector,
} from './logging/index.js';
import {
  createPerformanceDetectors,
  createCodeSplittingDetector,
  createLazyLoadingDetector,
  createMemoizationDetector,
  createCachingPatternsDetector,
  createDebounceThrottleDetector,
  createBundleSizeDetector,
  analyzeCodeSplitting,
  analyzeLazyLoading,
  analyzeMemoization,
  analyzeCachingPatterns,
  analyzeDebounceThrottle,
  analyzeBundleSize,
  // Learning detectors
  createLazyLoadingLearningDetector,
  createCodeSplittingLearningDetector,
  createDebounceThrottleLearningDetector,
  createMemoizationLearningDetector,
  createCachingPatternsLearningDetector,
  createBundleSizeLearningDetector,
  // Semantic detectors
  createCodeSplittingSemanticDetector,
  createLazyLoadingSemanticDetector,
  createMemoizationSemanticDetector,
  createCachingPatternsSemanticDetector,
  createDebounceThrottleSemanticDetector,
  createBundleSizeSemanticDetector,
} from './performance/index.js';
import {
  createInputSanitizationDetector,
  createSQLInjectionDetector,
  createXSSPreventionDetector,
  createCSRFProtectionDetector,
  createCSPHeadersDetector,
  createSecretManagementDetector,
  createRateLimitingDetector,
  createSecurityDetectors,
  analyzeInputSanitization,
  analyzeSQLInjection,
  analyzeXSSPrevention,
  analyzeCSRFProtection,
  analyzeCSPHeaders,
  analyzeSecretManagement,
  analyzeRateLimiting,
  // Learning detectors
  createInputSanitizationLearningDetector,
  createRateLimitingLearningDetector,
  createCSRFProtectionLearningDetector,
  createSQLInjectionLearningDetector,
  createXSSPreventionLearningDetector,
  createCSPHeadersLearningDetector,
  createSecretManagementLearningDetector,
  // Semantic detectors
  createInputSanitizationSemanticDetector,
  createRateLimitingSemanticDetector,
  createCSRFProtectionSemanticDetector,
  createSQLInjectionSemanticDetector,
  createXSSPreventionSemanticDetector,
  createCSPHeadersSemanticDetector,
  createSecretManagementSemanticDetector,
} from './security/index.js';

// Error Detectors

// Logging Detectors

// Testing Detectors
import {
  createFileNamingDetector,
  createDirectoryStructureDetector,
  createCoLocationDetector,
  createBarrelExportsDetector,
  createImportOrderingDetector,
  createModuleBoundariesDetector,
  createCircularDependenciesDetector,
  createPackageBoundariesDetector,
  // Learning detectors
  createFileNamingLearningDetector,
  createImportOrderingLearningDetector,
  createBarrelExportsLearningDetector,
  createModuleBoundariesLearningDetector,
  createDirectoryStructureLearningDetector,
  createCircularDepsLearningDetector,
  createCoLocationLearningDetector,
  createPackageBoundariesLearningDetector,
  // Semantic detectors
  createFileNamingSemanticDetector,
  createDirectoryStructureSemanticDetector,
  createCoLocationSemanticDetector,
  createBarrelExportsSemanticDetector,
  createImportOrderingSemanticDetector,
  createModuleBoundariesSemanticDetector,
  createCircularDepsSemanticDetector,
  createPackageBoundariesSemanticDetector,
} from './structural/index.js';
import {
  createDesignTokensDetector,
  createSpacingScaleDetector,
  createColorUsageDetector,
  createTypographyDetector,
  createClassNamingDetector,
  createTailwindPatternsDetector,
  createZIndexScaleDetector,
  createResponsiveDetector,
  // Learning detectors
  createClassNamingLearningDetector,
  createColorUsageLearningDetector,
  createDesignTokensLearningDetector,
  createResponsiveLearningDetector,
  createSpacingScaleLearningDetector,
  createTailwindPatternsLearningDetector,
  createTypographyLearningDetector,
  createZIndexScaleLearningDetector,
  // Semantic detectors
  createClassNamingSemanticDetector,
  createColorUsageSemanticDetector,
  createDesignTokensSemanticDetector,
  createResponsiveSemanticDetector,
  createSpacingScaleSemanticDetector,
  createTailwindPatternsSemanticDetector,
  createTypographySemanticDetector,
  createZIndexScaleSemanticDetector,
} from './styling/index.js';
import {
  createTestFileNamingDetector,
  createTestCoLocationDetector,
  createTestStructureDetector,
  createMockPatternsDetector,
  createFixturePatternsDetector,
  createDescribeNamingDetector,
  createSetupTeardownDetector,
  createAllTestingDetectors,
  analyzeTestFileNaming,
  analyzeTestStructure,
  analyzeMockPatterns,
  analyzeFixturePatterns,
  analyzeDescribeNaming,
  analyzeSetupTeardown,
  // Learning detectors
  createDescribeNamingLearningDetector,
  createTestStructureLearningDetector,
  createMockPatternsLearningDetector,
  createFixturePatternsLearningDetector,
  createSetupTeardownLearningDetector,
  createTestFileNamingLearningDetector,
  createTestCoLocationLearningDetector,
  // Semantic detectors
  createTestFileNamingSemanticDetector,
  createTestCoLocationSemanticDetector,
  createTestStructureSemanticDetector,
  createMockPatternsSemanticDetector,
  createFixturePatternsSemanticDetector,
  createDescribeNamingSemanticDetector,
  createSetupTeardownSemanticDetector,
} from './testing/index.js';

// Data Access Detectors

// Config Detectors

// Types Detectors
import {
  createFileLocationDetector,
  createNamingConventionsDetector,
  createInterfaceVsTypeDetector,
  createGenericPatternsDetector,
  createUtilityTypesDetector,
  createTypeAssertionsDetector,
  createAnyUsageDetector,
  createTypesDetectors,
  analyzeFileLocation,
  analyzeNamingConventions,
  analyzeInterfaceVsType,
  analyzeGenericPatterns,
  analyzeUtilityTypes,
  analyzeTypeAssertions,
  analyzeAnyUsage,
  // Learning detectors
  createInterfaceVsTypeLearningDetector,
  createTypeNamingConventionsLearningDetector,
  createUtilityTypesLearningDetector,
  createGenericPatternsLearningDetector,
  createAnyUsageLearningDetector,
  createTypeFileLocationLearningDetector,
  createTypeAssertionsLearningDetector,
  // Semantic detectors
  createFileLocationSemanticDetector,
  createNamingConventionsSemanticDetector,
  createInterfaceVsTypeSemanticDetector,
  createGenericPatternsSemanticDetector,
  createUtilityTypesSemanticDetector,
  createTypeAssertionsSemanticDetector,
  createAnyUsageSemanticDetector,
} from './types/index.js';

// Structural Detectors

// Component Detectors

// Styling Detectors

// Accessibility Detectors

// Documentation Detectors

// Performance Detectors

import type { BaseDetector } from './base/index.js';

// ============================================================================
// Re-export Factory Functions
// ============================================================================

// API
export {
  createRouteStructureDetector,
  createHttpMethodsDetector,
  createResponseEnvelopeDetector,
  createErrorFormatDetector,
  createPaginationDetector,
  createClientPatternsDetector,
  createRetryPatternsDetector,
  analyzeRouteStructure,
  analyzeHttpMethods,
  analyzeResponseEnvelope,
  analyzeErrorFormat,
  analyzePagination,
  analyzeClientPatterns,
  analyzeRetryPatterns,
};

// Auth
export {
  createAuthMiddlewareDetector,
  createTokenHandlingDetector,
  createPermissionChecksDetector,
  createRbacPatternsDetector,
  createResourceOwnershipDetector,
  createAuditLoggingDetector,
  createAllAuthDetectors,
  analyzeAuthMiddleware,
  analyzeTokenHandling,
  analyzePermissions,
  analyzeRbac,
  analyzeOwnership,
  analyzeAuditLogging,
};

// Security
export {
  createInputSanitizationDetector,
  createSQLInjectionDetector,
  createXSSPreventionDetector,
  createCSRFProtectionDetector,
  createCSPHeadersDetector,
  createSecretManagementDetector,
  createRateLimitingDetector,
  createSecurityDetectors,
  analyzeInputSanitization,
  analyzeSQLInjection,
  analyzeXSSPrevention,
  analyzeCSRFProtection,
  analyzeCSPHeaders,
  analyzeSecretManagement,
  analyzeRateLimiting,
};

// Errors
export {
  createExceptionHierarchyDetector,
  createErrorCodesDetector,
  createTryCatchPlacementDetector,
  createErrorPropagationDetector,
  createAsyncErrorsDetector,
  createCircuitBreakerDetector,
  createErrorLoggingDetector,
  createAllErrorDetectors,
  analyzeExceptionHierarchy,
  analyzeErrorCodes,
  analyzeTryCatchPlacement,
  analyzeErrorPropagation,
  analyzeAsyncErrors,
  analyzeCircuitBreaker,
  analyzeErrorLogging,
};

// Logging
export {
  createStructuredFormatDetector,
  createLogLevelsDetector,
  createContextFieldsDetector,
  createCorrelationIdsDetector,
  createPIIRedactionDetector,
  createMetricNamingDetector,
  createHealthChecksDetector,
  createAllLoggingDetectors,
  analyzeStructuredFormat,
  analyzeLogLevels,
  analyzeContextFields,
  analyzeCorrelationIds,
  analyzePIIRedaction,
  analyzeMetricNaming,
  analyzeHealthChecks,
};

// Testing
export {
  createTestFileNamingDetector,
  createTestCoLocationDetector,
  createTestStructureDetector,
  createMockPatternsDetector,
  createFixturePatternsDetector,
  createDescribeNamingDetector,
  createSetupTeardownDetector,
  createAllTestingDetectors,
  analyzeTestFileNaming,
  analyzeTestStructure,
  analyzeMockPatterns,
  analyzeFixturePatterns,
  analyzeDescribeNaming,
  analyzeSetupTeardown,
};

// Data Access
export {
  createQueryPatternsDetector,
  createRepositoryPatternDetector,
  createTransactionPatternsDetector,
  createValidationPatternsDetector,
  createDTOPatternsDetector,
  createNPlusOneDetector,
  createConnectionPoolingDetector,
  createAllDataAccessDetectors,
  analyzeQueryPatterns,
  analyzeRepositoryPattern,
  analyzeTransactionPatterns,
  analyzeValidationPatterns,
  analyzeDTOPatterns,
  analyzeNPlusOne,
  analyzeConnectionPooling,
  // Data Boundary detectors
  createORMModelSemanticDetector,
  createQueryAccessSemanticDetector,
  createSensitiveFieldSemanticDetector,
};

// Config
export {
  createEnvNamingDetector,
  createRequiredOptionalDetector,
  createDefaultValuesDetector,
  createFeatureFlagsDetector,
  createConfigValidationDetector,
  createEnvironmentDetectionDetector,
  createConfigDetectors,
  analyzeEnvNaming,
  analyzeRequiredOptional,
  analyzeDefaultValues,
  analyzeFeatureFlags,
  analyzeConfigValidation,
  analyzeEnvironmentDetection,
};

// Types
export {
  createFileLocationDetector,
  createNamingConventionsDetector,
  createInterfaceVsTypeDetector,
  createGenericPatternsDetector,
  createUtilityTypesDetector,
  createTypeAssertionsDetector,
  createAnyUsageDetector,
  createTypesDetectors,
  analyzeFileLocation,
  analyzeNamingConventions,
  analyzeInterfaceVsType,
  analyzeGenericPatterns,
  analyzeUtilityTypes,
  analyzeTypeAssertions,
  analyzeAnyUsage,
};

// Structural
export {
  createFileNamingDetector,
  createDirectoryStructureDetector,
  createCoLocationDetector,
  createBarrelExportsDetector,
  createImportOrderingDetector,
  createModuleBoundariesDetector,
  createCircularDependenciesDetector,
  createPackageBoundariesDetector,
};

// Components
export {
  createComponentStructureDetector,
  createPropsPatternDetector,
  createDuplicateDetector,
  createNearDuplicateDetector,
  createStatePatternDetector,
  createCompositionDetector,
  createRefForwardingDetector,
};

// Styling
export {
  createDesignTokensDetector,
  createSpacingScaleDetector,
  createColorUsageDetector,
  createTypographyDetector,
  createClassNamingDetector,
  createTailwindPatternsDetector,
  createZIndexScaleDetector,
  createResponsiveDetector,
};

// Accessibility
export {
  createAccessibilityDetectors,
  createSemanticHtmlDetector,
  createAriaRolesDetector,
  createKeyboardNavDetector,
  createFocusManagementDetector,
  createHeadingHierarchyDetector,
  createAltTextDetector,
  analyzeSemanticHtml,
  analyzeAriaRoles,
  analyzeKeyboardNav,
  analyzeFocusManagement,
  analyzeHeadingHierarchy,
  analyzeAltText,
};

// Documentation
export {
  createDocumentationDetectors,
  createJsdocPatternsDetector,
  createReadmeStructureDetector,
  createTodoPatternsDetector,
  createDeprecationDetector,
  createExampleCodeDetector,
  analyzeJsdocPatterns,
  analyzeReadmeStructure,
  analyzeTodoPatterns,
  analyzeDeprecation,
  analyzeExampleCode,
};

// Performance
export {
  createPerformanceDetectors,
  createCodeSplittingDetector,
  createLazyLoadingDetector,
  createMemoizationDetector,
  createCachingPatternsDetector,
  createDebounceThrottleDetector,
  createBundleSizeDetector,
  analyzeCodeSplitting,
  analyzeLazyLoading,
  analyzeMemoization,
  analyzeCachingPatterns,
  analyzeDebounceThrottle,
  analyzeBundleSize,
};

// ============================================================================
// Master Factory Functions
// ============================================================================

/**
 * Create all API detectors
 */
export function createAllApiDetectors() {
  return {
    routeStructure: createRouteStructureDetector(),
    httpMethods: createHttpMethodsDetector(),
    responseEnvelope: createResponseEnvelopeDetector(),
    errorFormat: createErrorFormatDetector(),
    pagination: createPaginationDetector(),
    clientPatterns: createClientPatternsDetector(),
    retryPatterns: createRetryPatternsDetector(),
  };
}

/**
 * Create all structural detectors
 */
export function createAllStructuralDetectors() {
  return {
    fileNaming: createFileNamingDetector(),
    directoryStructure: createDirectoryStructureDetector(),
    coLocation: createCoLocationDetector(),
    barrelExports: createBarrelExportsDetector(),
    importOrdering: createImportOrderingDetector(),
    moduleBoundaries: createModuleBoundariesDetector(),
    circularDeps: createCircularDependenciesDetector(),
    packageBoundaries: createPackageBoundariesDetector(),
  };
}

/**
 * Create all component detectors
 */
export function createAllComponentDetectors() {
  return {
    componentStructure: createComponentStructureDetector(),
    propsPattern: createPropsPatternDetector(),
    duplicate: createDuplicateDetector(),
    nearDuplicate: createNearDuplicateDetector(),
    statePattern: createStatePatternDetector(),
    composition: createCompositionDetector(),
    refForwarding: createRefForwardingDetector(),
  };
}

/**
 * Create all styling detectors
 */
export function createAllStylingDetectors() {
  return {
    designTokens: createDesignTokensDetector(),
    spacingScale: createSpacingScaleDetector(),
    colorUsage: createColorUsageDetector(),
    typography: createTypographyDetector(),
    classNaming: createClassNamingDetector(),
    tailwindPatterns: createTailwindPatternsDetector(),
    zIndexScale: createZIndexScaleDetector(),
    responsive: createResponsiveDetector(),
  };
}

/**
 * Create all detectors as a flat array for easy iteration
 * NOW USES SEMANTIC DETECTORS - language-agnostic keyword-based detection
 * that works across TypeScript, JavaScript, Python, and more
 */
export async function createAllDetectorsArray(): Promise<BaseDetector[]> {
  const detectors: BaseDetector[] = [];

  // API detectors (7) - keep original, they use universal patterns
  const apiDetectors = createAllApiDetectors();
  detectors.push(
    apiDetectors.routeStructure,
    apiDetectors.httpMethods,
    apiDetectors.responseEnvelope,
    apiDetectors.errorFormat,
    apiDetectors.pagination,
    apiDetectors.clientPatterns,
    apiDetectors.retryPatterns
  );

  // Auth detectors (6) - SEMANTIC
  detectors.push(
    createAuthMiddlewareSemanticDetector(),
    createTokenHandlingSemanticDetector(),
    createPermissionChecksSemanticDetector(),
    createRBACSemanticDetector(),
    createOwnershipSemanticDetector(),
    createAuditSemanticDetector()
  );

  // Security detectors (7) - SEMANTIC
  detectors.push(
    createInputSanitizationSemanticDetector(),
    createSQLInjectionSemanticDetector(),
    createXSSPreventionSemanticDetector(),
    createCSRFProtectionSemanticDetector(),
    createCSPHeadersSemanticDetector(),
    createSecretManagementSemanticDetector(),
    createRateLimitingSemanticDetector()
  );

  // Error detectors (7) - SEMANTIC
  detectors.push(
    createExceptionHierarchySemanticDetector(),
    createErrorCodesSemanticDetector(),
    createTryCatchSemanticDetector(),
    createErrorPropagationSemanticDetector(),
    createAsyncErrorsSemanticDetector(),
    createCircuitBreakerSemanticDetector(),
    createErrorLoggingSemanticDetector()
  );

  // Structural detectors (8) - SEMANTIC
  detectors.push(
    createFileNamingSemanticDetector(),
    createDirectoryStructureSemanticDetector(),
    createCoLocationSemanticDetector(),
    createBarrelExportsSemanticDetector(),
    createImportOrderingSemanticDetector(),
    createModuleBoundariesSemanticDetector(),
    createCircularDepsSemanticDetector(),
    createPackageBoundariesSemanticDetector()
  );

  // Component detectors (7) - SEMANTIC
  detectors.push(
    createComponentStructureSemanticDetector(),
    createPropsPatternsSemanticDetector(),
    createDuplicateDetectionSemanticDetector(),
    createNearDuplicateSemanticDetector(),
    createStatePatternsSemanticDetector(),
    createCompositionSemanticDetector(),
    createRefForwardingSemanticDetector()
  );

  // Modal patterns detector (1) - SEMANTIC
  detectors.push(
    createModalPatternsSemanticDetector()
  );

  // Styling detectors (8) - SEMANTIC
  detectors.push(
    createDesignTokensSemanticDetector(),
    createSpacingScaleSemanticDetector(),
    createColorUsageSemanticDetector(),
    createTypographySemanticDetector(),
    createClassNamingSemanticDetector(),
    createTailwindPatternsSemanticDetector(),
    createZIndexScaleSemanticDetector(),
    createResponsiveSemanticDetector()
  );

  // Logging detectors (7) - SEMANTIC
  detectors.push(
    createStructuredLoggingSemanticDetector(),
    createLogLevelsSemanticDetector(),
    createContextFieldsSemanticDetector(),
    createCorrelationIdsSemanticDetector(),
    createPIIRedactionSemanticDetector(),
    createMetricsSemanticDetector(),
    createHealthChecksSemanticDetector()
  );

  // Testing detectors (7) - SEMANTIC
  detectors.push(
    createTestFileNamingSemanticDetector(),
    createTestCoLocationSemanticDetector(),
    createTestStructureSemanticDetector(),
    createMockPatternsSemanticDetector(),
    createFixturePatternsSemanticDetector(),
    createDescribeNamingSemanticDetector(),
    createSetupTeardownSemanticDetector()
  );

  // Data access detectors (7) - SEMANTIC
  detectors.push(
    createQueryPatternsSemanticDetector(),
    createRepositoryPatternSemanticDetector(),
    createTransactionSemanticDetector(),
    createValidationSemanticDetector(),
    createDTOPatternsSemanticDetector(),
    createNPlusOneSemanticDetector(),
    createConnectionPoolingSemanticDetector()
  );

  // Data Boundary detectors (3) - SEMANTIC
  // These track which code accesses which database tables/fields
  detectors.push(
    createORMModelSemanticDetector(),
    createQueryAccessSemanticDetector(),
    createSensitiveFieldSemanticDetector()
  );

  // Config detectors (6) - SEMANTIC
  detectors.push(
    createEnvConfigSemanticDetector(),
    createRequiredOptionalSemanticDetector(),
    createDefaultValuesSemanticDetector(),
    createFeatureFlagsSemanticDetector(),
    createConfigValidationSemanticDetector(),
    createEnvironmentDetectionSemanticDetector()
  );

  // Types detectors (7) - SEMANTIC
  detectors.push(
    createFileLocationSemanticDetector(),
    createNamingConventionsSemanticDetector(),
    createInterfaceVsTypeSemanticDetector(),
    createGenericPatternsSemanticDetector(),
    createUtilityTypesSemanticDetector(),
    createTypeAssertionsSemanticDetector(),
    createAnyUsageSemanticDetector()
  );

  // Accessibility detectors (6) - SEMANTIC
  detectors.push(
    createSemanticHtmlSemanticDetector(),
    createAriaRolesSemanticDetector(),
    createKeyboardNavSemanticDetector(),
    createFocusManagementSemanticDetector(),
    createHeadingHierarchySemanticDetector(),
    createAltTextSemanticDetector()
  );

  // Documentation detectors (5) - SEMANTIC
  detectors.push(
    createJSDocPatternsSemanticDetector(),
    createReadmeStructureSemanticDetector(),
    createTodoPatternsSemanticDetector(),
    createDeprecationSemanticDetector(),
    createExampleCodeSemanticDetector()
  );

  // Performance detectors (6) - SEMANTIC
  detectors.push(
    createCodeSplittingSemanticDetector(),
    createLazyLoadingSemanticDetector(),
    createMemoizationSemanticDetector(),
    createCachingPatternsSemanticDetector(),
    createDebounceThrottleSemanticDetector(),
    createBundleSizeSemanticDetector()
  );

  // ============================================================================
  // ASP.NET Core / C# Detectors - SEMANTIC LEARNING
  // ============================================================================

  // ASP.NET Auth detectors - SEMANTIC
  detectors.push(
    new (await import('./auth/aspnet/authorize-attribute-semantic.js')).AuthorizeAttributeSemanticDetector(),
    new (await import('./auth/aspnet/jwt-patterns-semantic.js')).JwtPatternsSemanticDetector(),
    new (await import('./auth/aspnet/identity-patterns-semantic.js')).IdentityPatternsSemanticDetector(),
    new (await import('./auth/aspnet/policy-handlers-semantic.js')).PolicyHandlersSemanticDetector(),
    new (await import('./auth/aspnet/resource-authorization-semantic.js')).ResourceAuthorizationSemanticDetector()
  );

  // ASP.NET Data Access detectors - SEMANTIC
  detectors.push(
    new (await import('./data-access/aspnet/efcore-patterns-semantic.js')).EfCorePatternsSemanticDetector(),
    new (await import('./data-access/aspnet/repository-pattern-semantic.js')).RepositoryPatternSemanticDetector()
  );

  // ASP.NET Error detectors - SEMANTIC
  detectors.push(
    new (await import('./errors/aspnet/exception-patterns-semantic.js')).ExceptionPatternsSemanticDetector(),
    new (await import('./errors/aspnet/result-pattern-semantic.js')).ResultPatternSemanticDetector()
  );

  // ASP.NET Logging detectors - SEMANTIC
  detectors.push(
    new (await import('./logging/aspnet/ilogger-patterns-semantic.js')).ILoggerPatternsSemanticDetector()
  );

  // ASP.NET Security detectors - SEMANTIC
  detectors.push(
    new (await import('./security/aspnet/input-validation-semantic.js')).InputValidationSemanticDetector()
  );

  // ASP.NET Testing detectors - SEMANTIC
  detectors.push(
    new (await import('./testing/aspnet/xunit-patterns-semantic.js')).XUnitPatternsSemanticDetector()
  );

  // ASP.NET Config detectors - SEMANTIC
  detectors.push(
    new (await import('./config/aspnet/options-pattern-semantic.js')).OptionsPatternSemanticDetector()
  );

  // ASP.NET Types detectors - SEMANTIC
  detectors.push(
    new (await import('./types/aspnet/record-patterns-semantic.js')).RecordPatternsSemanticDetector()
  );

  // ASP.NET Performance detectors - SEMANTIC
  detectors.push(
    new (await import('./performance/aspnet/async-patterns-semantic.js')).AsyncPatternsSemanticDetector()
  );

  // ASP.NET Structural detectors - SEMANTIC
  detectors.push(
    new (await import('./structural/aspnet/di-registration-semantic.js')).DIRegistrationSemanticDetector()
  );

  // ASP.NET Documentation detectors - SEMANTIC
  detectors.push(
    new (await import('./documentation/aspnet/xml-documentation-semantic.js')).XmlDocumentationSemanticDetector()
  );

  // ============================================================================
  // Laravel / PHP Detectors - SEMANTIC LEARNING (13 semantic + extraction)
  // ============================================================================

  // Laravel Contract detectors (extraction for BE↔FE matching)
  detectors.push(
    new (await import('./contracts/laravel/laravel-endpoint-detector.js')).LaravelEndpointDetector()
  );

  // Laravel Auth detectors (extraction + semantic)
  detectors.push(
    new (await import('./auth/laravel/auth-detector.js')).LaravelAuthDetector(),
    new (await import('./auth/laravel/auth-semantic.js')).LaravelAuthSemanticDetector()
  );

  // Laravel Data Access detectors (extraction + semantic)
  detectors.push(
    new (await import('./data-access/laravel/eloquent-detector.js')).LaravelEloquentDetector(),
    new (await import('./data-access/laravel/eloquent-semantic.js')).LaravelEloquentSemanticDetector(),
    new (await import('./data-access/laravel/transaction-semantic.js')).LaravelTransactionSemanticDetector()
  );

  // Laravel Error detectors (extraction + semantic)
  detectors.push(
    new (await import('./errors/laravel/exception-detector.js')).LaravelExceptionDetector(),
    new (await import('./errors/laravel/errors-semantic.js')).LaravelErrorsSemanticDetector()
  );

  // Laravel Logging detectors (extraction + semantic)
  detectors.push(
    new (await import('./logging/laravel/logging-detector.js')).LaravelLoggingDetector(),
    new (await import('./logging/laravel/logging-semantic.js')).LaravelLoggingSemanticDetector()
  );

  // Laravel Testing detectors (extraction + semantic)
  detectors.push(
    new (await import('./testing/laravel/testing-detector.js')).LaravelTestingDetector(),
    new (await import('./testing/laravel/testing-semantic.js')).LaravelTestingSemanticDetector()
  );

  // Laravel Structural detectors (extraction + semantic)
  detectors.push(
    new (await import('./structural/laravel/di-detector.js')).LaravelDIDetector(),
    new (await import('./structural/laravel/structural-semantic.js')).LaravelStructuralSemanticDetector()
  );

  // Laravel Security detectors (extraction + semantic)
  detectors.push(
    new (await import('./security/laravel/security-detector.js')).LaravelSecurityDetector(),
    new (await import('./security/laravel/security-semantic.js')).LaravelSecuritySemanticDetector()
  );

  // Laravel Config detectors (extraction + semantic)
  detectors.push(
    new (await import('./config/laravel/config-detector.js')).LaravelConfigDetector(),
    new (await import('./config/laravel/config-semantic.js')).LaravelConfigSemanticDetector()
  );

  // Laravel Performance detectors (extraction + semantic)
  detectors.push(
    new (await import('./performance/laravel/performance-detector.js')).LaravelPerformanceDetector(),
    new (await import('./performance/laravel/performance-semantic.js')).LaravelPerformanceSemanticDetector()
  );

  // Laravel API detectors - SEMANTIC
  detectors.push(
    new (await import('./api/laravel/api-semantic.js')).LaravelAPISemanticDetector()
  );

  // Laravel Async detectors (Jobs, Events, Queues) - SEMANTIC
  detectors.push(
    new (await import('./async/laravel/async-semantic.js')).LaravelAsyncSemanticDetector()
  );

  // Laravel Validation detectors - SEMANTIC
  detectors.push(
    new (await import('./validation/laravel/validation-semantic.js')).LaravelValidationSemanticDetector()
  );

  // ============================================================================
  // Spring Boot / Java Detectors - SEMANTIC LEARNING
  // ============================================================================

  // Spring semantic detectors (12)
  detectors.push(
    new (await import('./spring/structural-semantic.js')).SpringStructuralSemanticDetector(),
    new (await import('./spring/api-semantic.js')).SpringAPISemanticDetector(),
    new (await import('./spring/auth-semantic.js')).SpringAuthSemanticDetector(),
    new (await import('./spring/data-semantic.js')).SpringDataSemanticDetector(),
    new (await import('./spring/di-semantic.js')).SpringDISemanticDetector(),
    new (await import('./spring/config-semantic.js')).SpringConfigSemanticDetector(),
    new (await import('./spring/validation-semantic.js')).SpringValidationSemanticDetector(),
    new (await import('./spring/errors-semantic.js')).SpringErrorsSemanticDetector(),
    new (await import('./spring/logging-semantic.js')).SpringLoggingSemanticDetector(),
    new (await import('./spring/testing-semantic.js')).SpringTestingSemanticDetector(),
    new (await import('./spring/transaction-semantic.js')).SpringTransactionSemanticDetector(),
    new (await import('./spring/async-semantic.js')).SpringAsyncSemanticDetector()
  );

  // Spring Contract detectors
  detectors.push(
    new (await import('./contracts/spring/spring-endpoint-detector.js')).SpringEndpointDetector()
  );

  // Spring learning detectors (12)
  detectors.push(
    new (await import('./spring/structural-learning.js')).SpringStructuralLearningDetector(),
    new (await import('./spring/api-learning.js')).SpringAPILearningDetector(),
    new (await import('./spring/auth-learning.js')).SpringAuthLearningDetector(),
    new (await import('./spring/data-learning.js')).SpringDataLearningDetector(),
    new (await import('./spring/di-learning.js')).SpringDILearningDetector(),
    new (await import('./spring/config-learning.js')).SpringConfigLearningDetector(),
    new (await import('./spring/validation-learning.js')).SpringValidationLearningDetector(),
    new (await import('./spring/errors-learning.js')).SpringErrorsLearningDetector(),
    new (await import('./spring/logging-learning.js')).SpringLoggingLearningDetector(),
    new (await import('./spring/testing-learning.js')).SpringTestingLearningDetector(),
    new (await import('./spring/transaction-learning.js')).SpringTransactionLearningDetector(),
    new (await import('./spring/async-learning.js')).SpringAsyncLearningDetector()
  );

  return detectors;
}

/**
 * Create all detectors grouped by category
 * NOW USES SEMANTIC DETECTORS
 */
export function createAllDetectors() {
  return {
    api: createAllApiDetectors(), // Keep original - universal patterns
    auth: createAllAuthSemanticDetectors(),
    security: createAllSecuritySemanticDetectors(),
    errors: createAllErrorSemanticDetectors(),
    structural: createAllStructuralSemanticDetectors(),
    components: createAllComponentSemanticDetectors(),
    styling: createAllStylingSemanticDetectors(),
    logging: createAllLoggingSemanticDetectors(),
    testing: createAllTestingSemanticDetectors(),
    dataAccess: createAllDataAccessSemanticDetectors(),
    config: createAllConfigSemanticDetectors(),
    types: createAllTypesSemanticDetectors(),
    accessibility: createAllAccessibilitySemanticDetectors(),
    documentation: createAllDocumentationSemanticDetectors(),
    performance: createAllPerformanceSemanticDetectors(),
  };
}

// ============================================================================
// Learning Detector Factory Functions
// ============================================================================

/**
 * Create all auth learning detectors
 */
export function createAllAuthLearningDetectors() {
  return [
    createAuthMiddlewareLearningDetector(),
    createTokenHandlingLearningDetector(),
    createPermissionChecksLearningDetector(),
    createRBACPatternsLearningDetector(),
    createResourceOwnershipLearningDetector(),
    createAuditLoggingLearningDetector(),
  ];
}

/**
 * Create all security learning detectors
 */
export function createAllSecurityLearningDetectors() {
  return [
    createInputSanitizationLearningDetector(),
    createSQLInjectionLearningDetector(),
    createXSSPreventionLearningDetector(),
    createCSRFProtectionLearningDetector(),
    createCSPHeadersLearningDetector(),
    createSecretManagementLearningDetector(),
    createRateLimitingLearningDetector(),
  ];
}

/**
 * Create all error learning detectors
 */
export function createAllErrorLearningDetectors() {
  return [
    createExceptionHierarchyLearningDetector(),
    createErrorCodesLearningDetector(),
    createTryCatchLearningDetector(),
    createErrorPropagationLearningDetector(),
    createAsyncErrorsLearningDetector(),
    createCircuitBreakerLearningDetector(),
    createErrorLoggingLearningDetector(),
  ];
}

/**
 * Create all structural learning detectors
 */
export function createAllStructuralLearningDetectors() {
  return [
    createFileNamingLearningDetector(),
    createDirectoryStructureLearningDetector(),
    createCoLocationLearningDetector(),
    createBarrelExportsLearningDetector(),
    createImportOrderingLearningDetector(),
    createModuleBoundariesLearningDetector(),
    createCircularDepsLearningDetector(),
    createPackageBoundariesLearningDetector(),
  ];
}

/**
 * Create all component learning detectors
 */
export function createAllComponentLearningDetectors() {
  return [
    createComponentStructureLearningDetector(),
    createPropsPatternsLearningDetector(),
    createDuplicateDetectionLearningDetector(),
    createNearDuplicateLearningDetector(),
    createStatePatternsLearningDetector(),
    createCompositionLearningDetector(),
    createRefForwardingLearningDetector(),
  ];
}

/**
 * Create all styling learning detectors
 */
export function createAllStylingLearningDetectors() {
  return [
    createDesignTokensLearningDetector(),
    createSpacingScaleLearningDetector(),
    createColorUsageLearningDetector(),
    createTypographyLearningDetector(),
    createClassNamingLearningDetector(),
    createTailwindPatternsLearningDetector(),
    createZIndexScaleLearningDetector(),
    createResponsiveLearningDetector(),
  ];
}

/**
 * Create all logging learning detectors
 */
export function createAllLoggingLearningDetectors() {
  return [
    createStructuredFormatLearningDetector(),
    createLogLevelsLearningDetector(),
    createContextFieldsLearningDetector(),
    createCorrelationIdsLearningDetector(),
    createPIIRedactionLearningDetector(),
    createMetricNamingLearningDetector(),
    createHealthChecksLearningDetector(),
  ];
}

/**
 * Create all testing learning detectors
 */
export function createAllTestingLearningDetectors() {
  return [
    createTestFileNamingLearningDetector(),
    createTestCoLocationLearningDetector(),
    createTestStructureLearningDetector(),
    createMockPatternsLearningDetector(),
    createFixturePatternsLearningDetector(),
    createDescribeNamingLearningDetector(),
    createSetupTeardownLearningDetector(),
  ];
}

/**
 * Create all data access learning detectors
 */
export function createAllDataAccessLearningDetectors() {
  return [
    createQueryPatternsLearningDetector(),
    createRepositoryPatternLearningDetector(),
    createTransactionPatternsLearningDetector(),
    createValidationPatternsLearningDetector(),
    createDTOPatternsLearningDetector(),
    createNPlusOneLearningDetector(),
    createConnectionPoolingLearningDetector(),
  ];
}

/**
 * Create all config learning detectors
 */
export function createAllConfigLearningDetectors() {
  return [
    createEnvNamingLearningDetector(),
    createRequiredOptionalLearningDetector(),
    createDefaultValuesLearningDetector(),
    createFeatureFlagsLearningDetector(),
    createConfigValidationLearningDetector(),
    createEnvironmentDetectionLearningDetector(),
  ];
}

/**
 * Create all types learning detectors
 */
export function createAllTypesLearningDetectors() {
  return [
    createTypeFileLocationLearningDetector(),
    createTypeNamingConventionsLearningDetector(),
    createInterfaceVsTypeLearningDetector(),
    createGenericPatternsLearningDetector(),
    createUtilityTypesLearningDetector(),
    createTypeAssertionsLearningDetector(),
    createAnyUsageLearningDetector(),
  ];
}

/**
 * Create all accessibility learning detectors
 */
export function createAllAccessibilityLearningDetectors() {
  return [
    createSemanticHtmlLearningDetector(),
    createAriaRolesLearningDetector(),
    createKeyboardNavLearningDetector(),
    createFocusManagementLearningDetector(),
    createHeadingHierarchyLearningDetector(),
    createAltTextLearningDetector(),
  ];
}

/**
 * Create all documentation learning detectors
 */
export function createAllDocumentationLearningDetectors() {
  return [
    createJSDocPatternsLearningDetector(),
    createReadmeStructureLearningDetector(),
    createTodoPatternsLearningDetector(),
    createDeprecationLearningDetector(),
    createExampleCodeLearningDetector(),
  ];
}

/**
 * Create all performance learning detectors
 */
export function createAllPerformanceLearningDetectors() {
  return [
    createCodeSplittingLearningDetector(),
    createLazyLoadingLearningDetector(),
    createMemoizationLearningDetector(),
    createCachingPatternsLearningDetector(),
    createDebounceThrottleLearningDetector(),
    createBundleSizeLearningDetector(),
  ];
}

/**
 * Get detector count by category
 */
export function getDetectorCounts() {
  return {
    api: 7,
    auth: 6,
    security: 7,
    errors: 7,
    structural: 8,
    components: 7,
    styling: 8,
    logging: 7,
    testing: 7,
    dataAccess: 7,
    config: 6,
    types: 7,
    accessibility: 6,
    documentation: 5,
    performance: 6,
    total: 101, // All detectors wired
  };
}

// ============================================================================
// Semantic Detector Factory Functions (Language-Agnostic)
// ============================================================================

/**
 * Create all auth semantic detectors
 */
export function createAllAuthSemanticDetectors() {
  return [
    createAuthMiddlewareSemanticDetector(),
    createTokenHandlingSemanticDetector(),
    createPermissionChecksSemanticDetector(),
    createRBACSemanticDetector(),
    createOwnershipSemanticDetector(),
    createAuditSemanticDetector(),
  ];
}

/**
 * Create all security semantic detectors
 */
export function createAllSecuritySemanticDetectors() {
  return [
    createInputSanitizationSemanticDetector(),
    createSQLInjectionSemanticDetector(),
    createXSSPreventionSemanticDetector(),
    createCSRFProtectionSemanticDetector(),
    createCSPHeadersSemanticDetector(),
    createSecretManagementSemanticDetector(),
    createRateLimitingSemanticDetector(),
  ];
}

/**
 * Create all error semantic detectors
 */
export function createAllErrorSemanticDetectors() {
  return [
    createExceptionHierarchySemanticDetector(),
    createErrorCodesSemanticDetector(),
    createTryCatchSemanticDetector(),
    createErrorPropagationSemanticDetector(),
    createAsyncErrorsSemanticDetector(),
    createCircuitBreakerSemanticDetector(),
    createErrorLoggingSemanticDetector(),
  ];
}

/**
 * Create all structural semantic detectors
 */
export function createAllStructuralSemanticDetectors() {
  return [
    createFileNamingSemanticDetector(),
    createDirectoryStructureSemanticDetector(),
    createCoLocationSemanticDetector(),
    createBarrelExportsSemanticDetector(),
    createImportOrderingSemanticDetector(),
    createModuleBoundariesSemanticDetector(),
    createCircularDepsSemanticDetector(),
    createPackageBoundariesSemanticDetector(),
  ];
}

/**
 * Create all component semantic detectors
 */
export function createAllComponentSemanticDetectors() {
  return [
    createComponentStructureSemanticDetector(),
    createPropsPatternsSemanticDetector(),
    createDuplicateDetectionSemanticDetector(),
    createNearDuplicateSemanticDetector(),
    createStatePatternsSemanticDetector(),
    createCompositionSemanticDetector(),
    createRefForwardingSemanticDetector(),
    createModalPatternsSemanticDetector(),
  ];
}

/**
 * Create all styling semantic detectors
 */
export function createAllStylingSemanticDetectors() {
  return [
    createDesignTokensSemanticDetector(),
    createSpacingScaleSemanticDetector(),
    createColorUsageSemanticDetector(),
    createTypographySemanticDetector(),
    createClassNamingSemanticDetector(),
    createTailwindPatternsSemanticDetector(),
    createZIndexScaleSemanticDetector(),
    createResponsiveSemanticDetector(),
  ];
}

/**
 * Create all logging semantic detectors
 */
export function createAllLoggingSemanticDetectors() {
  return [
    createStructuredLoggingSemanticDetector(),
    createLogLevelsSemanticDetector(),
    createContextFieldsSemanticDetector(),
    createCorrelationIdsSemanticDetector(),
    createPIIRedactionSemanticDetector(),
    createMetricsSemanticDetector(),
    createHealthChecksSemanticDetector(),
  ];
}

/**
 * Create all testing semantic detectors
 */
export function createAllTestingSemanticDetectors() {
  return [
    createTestFileNamingSemanticDetector(),
    createTestCoLocationSemanticDetector(),
    createTestStructureSemanticDetector(),
    createMockPatternsSemanticDetector(),
    createFixturePatternsSemanticDetector(),
    createDescribeNamingSemanticDetector(),
    createSetupTeardownSemanticDetector(),
  ];
}

/**
 * Create all data access semantic detectors
 */
export function createAllDataAccessSemanticDetectors() {
  return [
    createQueryPatternsSemanticDetector(),
    createRepositoryPatternSemanticDetector(),
    createTransactionSemanticDetector(),
    createValidationSemanticDetector(),
    createDTOPatternsSemanticDetector(),
    createNPlusOneSemanticDetector(),
    createConnectionPoolingSemanticDetector(),
  ];
}

/**
 * Create all data boundary semantic detectors
 * These track which code accesses which database tables/fields
 */
export function createAllDataBoundarySemanticDetectors() {
  return [
    createORMModelSemanticDetector(),
    createQueryAccessSemanticDetector(),
    createSensitiveFieldSemanticDetector(),
  ];
}

/**
 * Create all config semantic detectors
 */
export function createAllConfigSemanticDetectors() {
  return [
    createEnvConfigSemanticDetector(),
    createRequiredOptionalSemanticDetector(),
    createDefaultValuesSemanticDetector(),
    createFeatureFlagsSemanticDetector(),
    createConfigValidationSemanticDetector(),
    createEnvironmentDetectionSemanticDetector(),
  ];
}

/**
 * Create all types semantic detectors
 */
export function createAllTypesSemanticDetectors() {
  return [
    createFileLocationSemanticDetector(),
    createNamingConventionsSemanticDetector(),
    createInterfaceVsTypeSemanticDetector(),
    createGenericPatternsSemanticDetector(),
    createUtilityTypesSemanticDetector(),
    createTypeAssertionsSemanticDetector(),
    createAnyUsageSemanticDetector(),
  ];
}

/**
 * Create all accessibility semantic detectors
 */
export function createAllAccessibilitySemanticDetectors() {
  return [
    createSemanticHtmlSemanticDetector(),
    createAriaRolesSemanticDetector(),
    createKeyboardNavSemanticDetector(),
    createFocusManagementSemanticDetector(),
    createHeadingHierarchySemanticDetector(),
    createAltTextSemanticDetector(),
  ];
}

/**
 * Create all documentation semantic detectors
 */
export function createAllDocumentationSemanticDetectors() {
  return [
    createJSDocPatternsSemanticDetector(),
    createReadmeStructureSemanticDetector(),
    createTodoPatternsSemanticDetector(),
    createDeprecationSemanticDetector(),
    createExampleCodeSemanticDetector(),
  ];
}

/**
 * Create all performance semantic detectors
 */
export function createAllPerformanceSemanticDetectors() {
  return [
    createCodeSplittingSemanticDetector(),
    createLazyLoadingSemanticDetector(),
    createMemoizationSemanticDetector(),
    createCachingPatternsSemanticDetector(),
    createDebounceThrottleSemanticDetector(),
    createBundleSizeSemanticDetector(),
  ];
}


// ============================================================================
// IEC 61131-3 Structured Text Detectors (Industrial Automation)
// ============================================================================

export * from './iec61131/index.js';
