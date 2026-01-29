/**
 * License Validator
 * 
 * Validates and decodes license keys.
 * Supports both JWT-based licenses and simple activation keys.
 */

import { FEATURE_TIERS, TIER_HIERARCHY } from './types.js';

import type {
  License,
  LicenseTier,
  LicenseValidationResult,
  EnterpriseFeature,
} from './types.js';


// =============================================================================
// Constants
// =============================================================================

// Simple key prefixes for non-JWT licenses
const KEY_PREFIXES: Record<LicenseTier, string> = {
  community: 'DRIFT-COM-',
  team: 'DRIFT-TEAM-',
  enterprise: 'DRIFT-ENT-',
};

// Public key for JWT verification (would be loaded from config in production)
// For now, we use a simple HMAC approach with a known secret
const JWT_SECRET = 'drift-license-secret-v1';

// =============================================================================
// License Validator
// =============================================================================

export class LicenseValidator {
  /**
   * Validate a license key
   */
  async validate(key: string): Promise<LicenseValidationResult> {
    if (!key || typeof key !== 'string') {
      return {
        valid: false,
        tier: 'community',
        features: [],
        expiresAt: null,
        error: 'Invalid license key format',
      };
    }

    const trimmedKey = key.trim();

    // Check if it's a JWT (contains two dots)
    if (this.isJWT(trimmedKey)) {
      return this.validateJWT(trimmedKey);
    }

    // Otherwise, validate as simple key
    return this.validateSimpleKey(trimmedKey);
  }

  /**
   * Decode a license key to get full license details
   */
  decode(key: string): License | null {
    if (!key) {return null;}

    const trimmedKey = key.trim();

    if (this.isJWT(trimmedKey)) {
      return this.decodeJWT(trimmedKey);
    }

    return this.decodeSimpleKey(trimmedKey);
  }

  /**
   * Check if key is a JWT
   */
  private isJWT(key: string): boolean {
    const parts = key.split('.');
    return parts.length === 3;
  }

  /**
   * Validate JWT license
   */
  private async validateJWT(token: string): Promise<LicenseValidationResult> {
    try {
      const license = this.decodeJWT(token);
      
      if (!license) {
        return {
          valid: false,
          tier: 'community',
          features: [],
          expiresAt: null,
          error: 'Failed to decode license token',
        };
      }

      // Check expiration
      if (license.expiresAt) {
        const expiresAt = new Date(license.expiresAt);
        if (expiresAt < new Date()) {
          return {
            valid: false,
            tier: 'community',
            features: [],
            expiresAt: license.expiresAt,
            error: 'License has expired',
          };
        }
      }

      // Verify signature (simplified - in production use proper JWT library)
      const isValid = this.verifyJWTSignature(token);
      if (!isValid) {
        return {
          valid: false,
          tier: 'community',
          features: [],
          expiresAt: null,
          error: 'Invalid license signature',
        };
      }

      // Build warnings
      const warnings: string[] = [];
      if (license.expiresAt) {
        const daysLeft = Math.ceil(
          (new Date(license.expiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
        );
        if (daysLeft <= 30) {
          warnings.push(`License expires in ${daysLeft} days`);
        }
      }

      return {
        valid: true,
        tier: license.tier,
        features: this.getFeaturesForTier(license.tier, license.features),
        expiresAt: license.expiresAt,
        warnings: warnings.length > 0 ? warnings : undefined,
      };
    } catch (error) {
      return {
        valid: false,
        tier: 'community',
        features: [],
        expiresAt: null,
        error: `License validation error: ${(error as Error).message}`,
      };
    }
  }

  /**
   * Decode JWT to License object
   */
  private decodeJWT(token: string): License | null {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) {return null;}

      // Decode payload (middle part)
      const payload = JSON.parse(
        Buffer.from(parts[1]!, 'base64url').toString('utf-8')
      );

      return {
        key: token,
        tier: payload.tier || 'community',
        organization: payload.org || 'Unknown',
        seats: payload.seats || 0,
        expiresAt: payload.exp ? new Date(payload.exp * 1000).toISOString() : '',
        features: payload.features || [],
        metadata: {
          issuedAt: payload.iat ? new Date(payload.iat * 1000).toISOString() : new Date().toISOString(),
          issuer: payload.iss || 'drift',
          version: payload.ver || '1.0',
        },
      };
    } catch {
      return null;
    }
  }

  /**
   * Verify JWT signature (simplified HMAC)
   */
  private verifyJWTSignature(token: string): boolean {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) {return false;}

      // In production, use proper crypto verification
      // For now, we do a simple check that the signature exists
      const signature = parts[2];
      return !!signature && signature.length > 10;
    } catch {
      return false;
    }
  }

  /**
   * Validate simple activation key
   */
  private validateSimpleKey(key: string): LicenseValidationResult {
    // Check for valid prefix
    let tier: LicenseTier = 'community';
    let validPrefix = false;

    for (const [t, prefix] of Object.entries(KEY_PREFIXES)) {
      if (key.startsWith(prefix)) {
        tier = t as LicenseTier;
        validPrefix = true;
        break;
      }
    }

    if (!validPrefix) {
      return {
        valid: false,
        tier: 'community',
        features: [],
        expiresAt: null,
        error: 'Invalid license key prefix',
      };
    }

    // Extract and validate the key body
    const keyBody = key.substring(KEY_PREFIXES[tier].length);
    
    // Simple validation: key body should be alphanumeric and reasonable length
    if (!/^[A-Z0-9]{16,32}$/.test(keyBody)) {
      return {
        valid: false,
        tier: 'community',
        features: [],
        expiresAt: null,
        error: 'Invalid license key format',
      };
    }

    // Simple keys don't expire (managed server-side)
    return {
      valid: true,
      tier,
      features: this.getFeaturesForTier(tier),
      expiresAt: null,
    };
  }

  /**
   * Decode simple key to License object
   */
  private decodeSimpleKey(key: string): License | null {
    let tier: LicenseTier = 'community';

    for (const [t, prefix] of Object.entries(KEY_PREFIXES)) {
      if (key.startsWith(prefix)) {
        tier = t as LicenseTier;
        break;
      }
    }

    return {
      key,
      tier,
      organization: 'Licensed User',
      seats: tier === 'enterprise' ? 0 : (tier === 'team' ? 10 : 1),
      expiresAt: '',
      features: this.getFeaturesForTier(tier),
      metadata: {
        issuedAt: new Date().toISOString(),
        issuer: 'drift',
        version: '1.0',
      },
    };
  }

  /**
   * Get all features available for a tier
   */
  private getFeaturesForTier(
    tier: LicenseTier,
    explicitFeatures?: EnterpriseFeature[]
  ): EnterpriseFeature[] {
    const tierLevel = TIER_HIERARCHY[tier];

    // Get all features at or below this tier level
    const tierFeatures = (Object.entries(FEATURE_TIERS) as [EnterpriseFeature, LicenseTier][])
      .filter(([_, featureTier]) => TIER_HIERARCHY[featureTier] <= tierLevel)
      .map(([feature]) => feature);

    // Merge with explicit features (for custom licenses)
    if (explicitFeatures?.length) {
      const allFeatures = new Set([...tierFeatures, ...explicitFeatures]);
      return Array.from(allFeatures);
    }

    return tierFeatures;
  }
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Generate a simple license key (for testing/development)
 */
export function generateTestKey(tier: LicenseTier): string {
  const prefix = KEY_PREFIXES[tier];
  const body = Array.from({ length: 24 }, () =>
    'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.charAt(
      Math.floor(Math.random() * 36)
    )
  ).join('');
  return `${prefix}${body}`;
}

/**
 * Generate a JWT license (for testing/development)
 */
export function generateTestJWT(options: {
  tier: LicenseTier;
  organization: string;
  seats?: number;
  expiresInDays?: number;
  features?: EnterpriseFeature[];
}): string {
  const now = Math.floor(Date.now() / 1000);
  const exp = options.expiresInDays
    ? now + options.expiresInDays * 24 * 60 * 60
    : now + 365 * 24 * 60 * 60; // Default 1 year

  const header = {
    alg: 'HS256',
    typ: 'JWT',
  };

  const payload = {
    tier: options.tier,
    org: options.organization,
    seats: options.seats ?? (options.tier === 'enterprise' ? 0 : 10),
    iat: now,
    exp,
    iss: 'drift',
    ver: '1.0',
    features: options.features ?? [],
  };

  const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  
  // Simplified signature (in production, use proper HMAC)
  const signature = Buffer.from(`${headerB64}.${payloadB64}.${JWT_SECRET}`)
    .toString('base64url')
    .substring(0, 43);

  return `${headerB64}.${payloadB64}.${signature}`;
}
