/**
 * Drift Licensing System - Types
 * 
 * @license Apache-2.0
 * 
 * Defines the license tiers and feature flags for OSS vs Enterprise.
 */

// =============================================================================
// License Tiers
// =============================================================================

export type LicenseTier = 'community' | 'team' | 'enterprise';

export interface License {
  /** License key (JWT or simple key) */
  key: string;
  
  /** License tier */
  tier: LicenseTier;
  
  /** Organization name */
  organization: string;
  
  /** Licensed seats (0 = unlimited for enterprise) */
  seats: number;
  
  /** Expiration date (ISO string) */
  expiresAt: string;
  
  /** Features explicitly enabled */
  features: EnterpriseFeature[];
  
  /** License metadata */
  metadata: {
    issuedAt: string;
    issuer: string;
    version: string;
  };
}

// =============================================================================
// Feature Flags
// =============================================================================

/**
 * All gated features in Drift.
 * 
 * PHILOSOPHY: Solo devs and small teams can use Drift completely free.
 * Enterprise pays for managing patterns across teams at scale.
 * 
 * FREE (Community):
 * - All scanning, pattern detection, analysis
 * - drift check --ci with all output formats (json, github, gitlab, sarif)
 * - Basic thresholds and fail conditions
 * - Single-repo usage with full functionality
 * 
 * TEAM/ENTERPRISE: Scale and governance features only.
 */
export type EnterpriseFeature =
  // Quality Gate Features (Team) - Advanced policy management
  | 'gate:policy-engine'           // Multiple policies, branch/path scoping
  | 'gate:regression-detection'    // Regression detection across time
  | 'gate:custom-rules'            // Custom rules engine
  
  // Quality Gate Features (Enterprise) - Deep analysis
  | 'gate:impact-simulation'       // Impact simulation gate
  | 'gate:security-boundary'       // Security boundary gate
  
  // Governance Features (Enterprise) - Multi-team/repo management
  | 'governance:multi-repo'        // Multi-repo pattern governance
  | 'governance:team-analytics'    // Per-team metrics and scores
  | 'governance:audit-trail'       // Full audit trail for compliance
  
  // Integration Features (Enterprise) - External system connections
  | 'integration:webhooks'         // Webhook callbacks
  | 'integration:jira'             // Jira integration
  | 'integration:slack'            // Slack notifications
  
  // Advanced Features (Enterprise) - Customization at scale
  | 'advanced:self-hosted-models'  // Air-gapped model support
  | 'advanced:custom-detectors'    // Custom pattern detectors
  | 'advanced:api-access'          // REST API access
  
  // Dashboard Features
  | 'dashboard:team-view'          // Team-level dashboard (Enterprise)
  | 'dashboard:trends'             // Historical trend analysis (Team)
  | 'dashboard:export'             // Export reports (Team)
;

/**
 * Feature tier mapping - which tier unlocks which features
 * 
 * NOTE: Basic CI features are NOT gated:
 * - drift check --ci
 * - --format json/github/gitlab/sarif  
 * - --fail-on thresholds
 * 
 * These are all FREE for everyone. We only gate scale/governance features.
 */
export const FEATURE_TIERS: Record<EnterpriseFeature, LicenseTier> = {
  // Team tier features - Advanced policy management
  'gate:policy-engine': 'team',
  'gate:regression-detection': 'team',
  'gate:custom-rules': 'team',
  'dashboard:trends': 'team',
  'dashboard:export': 'team',
  
  // Enterprise tier features - Deep analysis
  'gate:impact-simulation': 'enterprise',
  'gate:security-boundary': 'enterprise',
  
  // Enterprise tier features - Multi-team governance
  'governance:multi-repo': 'enterprise',
  'governance:team-analytics': 'enterprise',
  'governance:audit-trail': 'enterprise',
  
  // Enterprise tier features - External integrations
  'integration:webhooks': 'enterprise',
  'integration:jira': 'enterprise',
  'integration:slack': 'enterprise',
  
  // Enterprise tier features - Customization at scale
  'advanced:self-hosted-models': 'enterprise',
  'advanced:custom-detectors': 'enterprise',
  'advanced:api-access': 'enterprise',
  
  // Enterprise tier features - Team dashboard
  'dashboard:team-view': 'enterprise',
};

/**
 * Tier hierarchy for comparison
 */
export const TIER_HIERARCHY: Record<LicenseTier, number> = {
  community: 0,
  team: 1,
  enterprise: 2,
};

// =============================================================================
// License Validation
// =============================================================================

export interface LicenseValidationResult {
  valid: boolean;
  tier: LicenseTier;
  features: EnterpriseFeature[];
  expiresAt: string | null;
  error?: string | undefined;
  warnings?: string[] | undefined;
}

export interface FeatureCheckResult {
  allowed: boolean;
  feature: EnterpriseFeature;
  requiredTier: LicenseTier;
  currentTier: LicenseTier;
  message: string;
  upgradeUrl?: string | undefined;
}

// =============================================================================
// License Sources
// =============================================================================

export type LicenseSource = 
  | 'environment'    // DRIFT_LICENSE_KEY env var
  | 'file'           // .drift/license.key file
  | 'config'         // .drift/config.json licenseKey field
  | 'none';          // No license found (community tier)
