/**
 * Drift Licensing System
 * 
 * Provides license management and feature gating for OSS vs Enterprise features.
 * 
 * @example
 * ```typescript
 * import { 
 *   requireFeature, 
 *   checkFeature, 
 *   getLicenseManager,
 *   FeatureNotLicensedError 
 * } from 'driftdetect-core';
 * 
 * // Check if feature is available
 * const check = await checkFeature('gate:policy-engine');
 * if (!check.allowed) {
 *   console.log(`Requires ${check.requiredTier} tier`);
 * }
 * 
 * // Require feature (throws if not licensed)
 * try {
 *   await requireFeature('gate:regression-detection');
 *   // Feature is available, proceed
 * } catch (error) {
 *   if (error instanceof FeatureNotLicensedError) {
 *     console.log(`Upgrade at ${error.upgradeUrl}`);
 *   }
 * }
 * 
 * // Guard a function
 * const result = await guardFeature('gate:impact-simulation', async () => {
 *   return runImpactSimulation();
 * });
 * if (!result.success) {
 *   console.log(result.error?.message);
 * }
 * ```
 */

// Types
export type {
  License,
  LicenseTier,
  LicenseSource,
  LicenseValidationResult,
  FeatureCheckResult,
  EnterpriseFeature,
} from './types.js';

export {
  FEATURE_TIERS,
  TIER_HIERARCHY,
} from './types.js';

// License Manager
export {
  LicenseManager,
  getLicenseManager,
  isFeatureAvailable,
  getCurrentTier,
} from './license-manager.js';

// License Validator
export {
  LicenseValidator,
  generateTestKey,
  generateTestJWT,
} from './license-validator.js';

// Feature Guards
export {
  requireFeature,
  checkFeature,
  guardFeature,
  withFeatureGate,
  RequiresFeature,
  FeatureNotLicensedError,
  formatFeatureError,
  formatFeatureCheck,
  createMCPFeatureError,
  guardMCPTool,
  requireTier,
  getLicenseStatus,
} from './feature-guard.js';

export type {
  FeatureGateOptions,
  GatedResult,
} from './feature-guard.js';
