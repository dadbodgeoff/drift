/**
 * Feature Guard
 * 
 * Provides decorators and functions to gate features behind license tiers.
 * Use these to protect enterprise features in CLI commands, MCP tools, etc.
 */

import { getLicenseManager } from './license-manager.js';

import type { EnterpriseFeature, LicenseTier, FeatureCheckResult } from './types.js';

// =============================================================================
// Types
// =============================================================================

export interface FeatureGateOptions {
  /** Feature to check */
  feature: EnterpriseFeature;
  /** Custom error message */
  message?: string;
  /** Whether to throw or return error result */
  throwOnDenied?: boolean;
  /** Root directory for license lookup */
  rootDir?: string;
}

export interface GatedResult<T> {
  success: boolean;
  data?: T;
  error?: FeatureCheckResult;
}

export class FeatureNotLicensedError extends Error {
  public readonly feature: EnterpriseFeature;
  public readonly requiredTier: LicenseTier;
  public readonly currentTier: LicenseTier;
  public readonly upgradeUrl: string;

  constructor(check: FeatureCheckResult) {
    super(check.message);
    this.name = 'FeatureNotLicensedError';
    this.feature = check.feature;
    this.requiredTier = check.requiredTier;
    this.currentTier = check.currentTier;
    this.upgradeUrl = check.upgradeUrl ?? 'https://driftscan.dev/pricing';
  }
}

// =============================================================================
// Guard Functions
// =============================================================================

/**
 * Check if a feature is available and throw if not
 */
export async function requireFeature(
  feature: EnterpriseFeature,
  rootDir?: string
): Promise<void> {
  const manager = getLicenseManager(rootDir);
  await manager.initialize();
  
  const check = manager.checkFeature(feature);
  
  if (!check.allowed) {
    throw new FeatureNotLicensedError(check);
  }
}

/**
 * Check if a feature is available (non-throwing)
 */
export async function checkFeature(
  feature: EnterpriseFeature,
  rootDir?: string
): Promise<FeatureCheckResult> {
  const manager = getLicenseManager(rootDir);
  await manager.initialize();
  return manager.checkFeature(feature);
}

/**
 * Guard a function with a feature check
 */
export async function guardFeature<T>(
  feature: EnterpriseFeature,
  fn: () => T | Promise<T>,
  rootDir?: string
): Promise<GatedResult<T>> {
  const check = await checkFeature(feature, rootDir);
  
  if (!check.allowed) {
    return {
      success: false,
      error: check,
    };
  }

  try {
    const data = await fn();
    return {
      success: true,
      data,
    };
  } catch (error) {
    throw error;
  }
}

/**
 * Create a feature-gated version of a function
 */
export function withFeatureGate<TArgs extends unknown[], TReturn>(
  feature: EnterpriseFeature,
  fn: (...args: TArgs) => TReturn | Promise<TReturn>,
  options?: { rootDir?: string }
): (...args: TArgs) => Promise<GatedResult<TReturn>> {
  return async (...args: TArgs): Promise<GatedResult<TReturn>> => {
    return guardFeature(feature, () => fn(...args), options?.rootDir);
  };
}

// =============================================================================
// Decorator (for class methods)
// =============================================================================

/**
 * Method decorator to gate a feature
 * 
 * @example
 * class MyService {
 *   @RequiresFeature('gate:policy-engine')
 *   async runPolicyEngine() {
 *     // Only runs if licensed
 *   }
 * }
 */
export function RequiresFeature(feature: EnterpriseFeature) {
  return function (
    _target: unknown,
    _propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: unknown[]) {
      await requireFeature(feature);
      return originalMethod.apply(this, args);
    };

    return descriptor;
  };
}

// =============================================================================
// CLI Helpers
// =============================================================================

/**
 * Format a feature gate error for CLI output
 */
export function formatFeatureError(error: FeatureNotLicensedError): string {
  const lines = [
    '',
    `⚠️  Enterprise Feature Required`,
    '',
    `Feature: ${error.feature}`,
    `Required: ${error.requiredTier} tier`,
    `Current:  ${error.currentTier} tier`,
    '',
    `Upgrade at: ${error.upgradeUrl}`,
    '',
  ];
  return lines.join('\n');
}

/**
 * Format a feature check result for CLI output
 */
export function formatFeatureCheck(check: FeatureCheckResult): string {
  if (check.allowed) {
    return `✓ ${check.feature} is available`;
  }
  
  return [
    `✗ ${check.feature} requires ${check.requiredTier} tier`,
    `  Current tier: ${check.currentTier}`,
    `  Upgrade: ${check.upgradeUrl}`,
  ].join('\n');
}

// =============================================================================
// MCP Tool Helpers
// =============================================================================

/**
 * Create an MCP error response for unlicensed feature
 */
export function createMCPFeatureError(check: FeatureCheckResult): {
  content: Array<{ type: string; text: string }>;
  isError: boolean;
} {
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        error: 'Feature not licensed',
        feature: check.feature,
        requiredTier: check.requiredTier,
        currentTier: check.currentTier,
        message: check.message,
        upgradeUrl: check.upgradeUrl,
        hint: `This feature requires a ${check.requiredTier} license. Visit ${check.upgradeUrl} to upgrade.`,
      }, null, 2),
    }],
    isError: true,
  };
}

/**
 * Guard an MCP tool handler with feature check
 */
export async function guardMCPTool<T>(
  feature: EnterpriseFeature,
  handler: () => Promise<T>,
  rootDir?: string
): Promise<T | { content: Array<{ type: string; text: string }>; isError: boolean }> {
  const check = await checkFeature(feature, rootDir);
  
  if (!check.allowed) {
    return createMCPFeatureError(check);
  }

  return handler();
}

// =============================================================================
// Tier Helpers
// =============================================================================

/**
 * Check if current license meets minimum tier
 */
export async function requireTier(
  minimumTier: LicenseTier,
  rootDir?: string
): Promise<void> {
  const manager = getLicenseManager(rootDir);
  await manager.initialize();
  
  if (!manager.hasTier(minimumTier)) {
    const currentTier = manager.getTier();
    throw new Error(
      `This operation requires ${minimumTier} tier (current: ${currentTier}). ` +
      `Upgrade at https://driftscan.dev/pricing`
    );
  }
}

/**
 * Get license status summary for display
 */
export async function getLicenseStatus(rootDir?: string): Promise<{
  tier: LicenseTier;
  organization: string | null;
  expiresAt: string | null;
  daysRemaining: number | null;
  warnings: string[];
  availableFeatures: EnterpriseFeature[];
}> {
  const manager = getLicenseManager(rootDir);
  await manager.initialize();
  
  const license = manager.getLicense();
  
  return {
    tier: manager.getTier(),
    organization: license?.organization ?? null,
    expiresAt: license?.expiresAt ?? null,
    daysRemaining: manager.getDaysUntilExpiration(),
    warnings: manager.getWarnings(),
    availableFeatures: manager.getAvailableFeatures(),
  };
}
