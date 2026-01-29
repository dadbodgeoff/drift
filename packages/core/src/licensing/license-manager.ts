/**
 * License Manager
 * 
 * @license Apache-2.0
 * 
 * Singleton that manages license loading, validation, and caching.
 * Supports multiple license sources: environment variable, file, config.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { LicenseValidator } from './license-validator.js';
import { FEATURE_TIERS, TIER_HIERARCHY } from './types.js';

import type {
  License,
  LicenseTier,
  LicenseSource,
  LicenseValidationResult,
  EnterpriseFeature,
  FeatureCheckResult,
} from './types.js';


// =============================================================================
// Constants
// =============================================================================

const DRIFT_LICENSE_ENV = 'DRIFT_LICENSE_KEY';
const DRIFT_LICENSE_FILE = '.drift/license.key';
const DRIFT_CONFIG_FILE = '.drift/config.json';
const UPGRADE_URL = 'https://driftscan.dev/pricing';

// =============================================================================
// License Manager
// =============================================================================

export class LicenseManager {
  private static instance: LicenseManager | null = null;
  
  private license: License | null = null;
  private validationResult: LicenseValidationResult | null = null;
  private source: LicenseSource = 'none';
  private rootDir: string;
  private validator: LicenseValidator;
  private initialized = false;

  private constructor(rootDir: string) {
    this.rootDir = rootDir;
    this.validator = new LicenseValidator();
  }

  /**
   * Get the singleton instance
   */
  static getInstance(rootDir?: string): LicenseManager {
    if (!LicenseManager.instance) {
      if (!rootDir) {
        rootDir = process.cwd();
      }
      LicenseManager.instance = new LicenseManager(rootDir);
    }
    return LicenseManager.instance;
  }

  /**
   * Reset the singleton (for testing)
   */
  static reset(): void {
    LicenseManager.instance = null;
  }

  /**
   * Initialize and load license from available sources
   */
  async initialize(): Promise<LicenseValidationResult> {
    if (this.initialized && this.validationResult) {
      return this.validationResult;
    }

    // Try sources in priority order
    const licenseKey = await this.findLicenseKey();

    if (!licenseKey) {
      this.validationResult = {
        valid: true, // Community tier is always valid
        tier: 'community',
        features: [],
        expiresAt: null,
      };
      this.source = 'none';
      this.initialized = true;
      return this.validationResult;
    }

    // Validate the license key
    this.validationResult = await this.validator.validate(licenseKey);
    
    if (this.validationResult.valid) {
      this.license = this.validator.decode(licenseKey);
    }

    this.initialized = true;
    return this.validationResult;
  }

  /**
   * Find license key from available sources
   */
  private async findLicenseKey(): Promise<string | null> {
    // 1. Environment variable (highest priority)
    const envKey = process.env[DRIFT_LICENSE_ENV];
    if (envKey) {
      this.source = 'environment';
      return envKey;
    }

    // 2. License file
    try {
      const filePath = path.join(this.rootDir, DRIFT_LICENSE_FILE);
      const fileKey = await fs.readFile(filePath, 'utf-8');
      if (fileKey.trim()) {
        this.source = 'file';
        return fileKey.trim();
      }
    } catch {
      // File doesn't exist, continue
    }

    // 3. Config file
    try {
      const configPath = path.join(this.rootDir, DRIFT_CONFIG_FILE);
      const configContent = await fs.readFile(configPath, 'utf-8');
      const config = JSON.parse(configContent);
      if (config.licenseKey) {
        this.source = 'config';
        return config.licenseKey;
      }
    } catch {
      // Config doesn't exist or doesn't have license, continue
    }

    return null;
  }

  /**
   * Get current license tier
   */
  getTier(): LicenseTier {
    return this.validationResult?.tier ?? 'community';
  }

  /**
   * Get license source
   */
  getSource(): LicenseSource {
    return this.source;
  }

  /**
   * Get full license details (if available)
   */
  getLicense(): License | null {
    return this.license;
  }

  /**
   * Check if a specific feature is available
   */
  checkFeature(feature: EnterpriseFeature): FeatureCheckResult {
    const currentTier = this.getTier();
    const requiredTier = FEATURE_TIERS[feature];
    
    const currentLevel = TIER_HIERARCHY[currentTier];
    const requiredLevel = TIER_HIERARCHY[requiredTier];
    
    const allowed = currentLevel >= requiredLevel;

    return {
      allowed,
      feature,
      requiredTier,
      currentTier,
      message: allowed
        ? `Feature "${feature}" is available with your ${currentTier} license`
        : `Feature "${feature}" requires ${requiredTier} tier (current: ${currentTier})`,
      upgradeUrl: allowed ? undefined : UPGRADE_URL,
    };
  }

  /**
   * Check if current tier meets minimum requirement
   */
  hasTier(minimumTier: LicenseTier): boolean {
    const currentLevel = TIER_HIERARCHY[this.getTier()];
    const requiredLevel = TIER_HIERARCHY[minimumTier];
    return currentLevel >= requiredLevel;
  }

  /**
   * Get all features available at current tier
   */
  getAvailableFeatures(): EnterpriseFeature[] {
    const currentTier = this.getTier();
    const currentLevel = TIER_HIERARCHY[currentTier];

    return (Object.entries(FEATURE_TIERS) as [EnterpriseFeature, LicenseTier][])
      .filter(([_, tier]) => TIER_HIERARCHY[tier] <= currentLevel)
      .map(([feature]) => feature);
  }

  /**
   * Get features that would be unlocked by upgrading
   */
  getUpgradeFeatures(targetTier: LicenseTier): EnterpriseFeature[] {
    const currentLevel = TIER_HIERARCHY[this.getTier()];
    const targetLevel = TIER_HIERARCHY[targetTier];

    if (targetLevel <= currentLevel) {
      return [];
    }

    return (Object.entries(FEATURE_TIERS) as [EnterpriseFeature, LicenseTier][])
      .filter(([_, tier]) => {
        const tierLevel = TIER_HIERARCHY[tier];
        return tierLevel > currentLevel && tierLevel <= targetLevel;
      })
      .map(([feature]) => feature);
  }

  /**
   * Check license expiration
   */
  isExpired(): boolean {
    if (!this.license?.expiresAt) {
      return false;
    }
    return new Date(this.license.expiresAt) < new Date();
  }

  /**
   * Get days until expiration
   */
  getDaysUntilExpiration(): number | null {
    if (!this.license?.expiresAt) {
      return null;
    }
    const expiresAt = new Date(this.license.expiresAt);
    const now = new Date();
    const diffMs = expiresAt.getTime() - now.getTime();
    return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  }

  /**
   * Get validation warnings (e.g., expiring soon)
   */
  getWarnings(): string[] {
    const warnings: string[] = [];
    
    const daysLeft = this.getDaysUntilExpiration();
    if (daysLeft !== null && daysLeft <= 30 && daysLeft > 0) {
      warnings.push(`License expires in ${daysLeft} days`);
    }

    if (this.validationResult?.warnings) {
      warnings.push(...this.validationResult.warnings);
    }

    return warnings;
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Get the license manager instance
 */
export function getLicenseManager(rootDir?: string): LicenseManager {
  return LicenseManager.getInstance(rootDir);
}

/**
 * Quick check if a feature is available
 */
export async function isFeatureAvailable(
  feature: EnterpriseFeature,
  rootDir?: string
): Promise<boolean> {
  const manager = getLicenseManager(rootDir);
  await manager.initialize();
  return manager.checkFeature(feature).allowed;
}

/**
 * Get current license tier
 */
export async function getCurrentTier(rootDir?: string): Promise<LicenseTier> {
  const manager = getLicenseManager(rootDir);
  await manager.initialize();
  return manager.getTier();
}
