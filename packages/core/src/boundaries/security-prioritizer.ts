/**
 * Security Prioritizer
 *
 * Integrates sensitivity classification with boundary scanner results
 * to prioritize data access points by security risk.
 *
 * Separates real security threats (credentials, PII, financial data)
 * from noise (button colors, UI preferences).
 */

import {
  SensitivityClassifier,
  createSensitivityClassifier,
} from '../call-graph/enrichment/sensitivity-classifier.js';

import type {
  DataAccessPoint,
  SensitiveField,
  DataAccessMap,
  SensitivityType,
  DataOperation,
} from './types.js';
import type {
  DataRegulation,
  PriorityTier,
} from '../call-graph/enrichment/types.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Security classification for a data access point
 */
export interface SecurityClassification {
  /** Priority tier (P0 = critical, P4 = minimal) */
  tier: PriorityTier;
  /** Overall risk score (0-100) */
  riskScore: number;
  /** Sensitivity type of the most sensitive field */
  maxSensitivity: SensitivityType;
  /** Regulatory implications */
  regulations: DataRegulation[];
  /** Why this is classified at this level */
  rationale: string;
  /** Is this a real security concern vs noise? */
  isSecurityRelevant: boolean;
}

/**
 * A data access point with security classification
 */
export interface PrioritizedAccessPoint {
  /** Original access point */
  accessPoint: DataAccessPoint;
  /** Security classification */
  security: SecurityClassification;
  /** Sensitive fields accessed */
  sensitiveFields: SensitiveField[];
}

/**
 * Summary of security priorities
 */
export interface SecuritySummary {
  /** Total access points analyzed */
  totalAccessPoints: number;
  /** Access points by priority tier */
  byTier: Record<PriorityTier, number>;
  /** Access points by sensitivity type */
  bySensitivity: Record<SensitivityType, number>;
  /** Regulations implicated */
  regulations: DataRegulation[];
  /** Critical items (P0/P1) */
  criticalCount: number;
  /** High priority items (P2) */
  highCount: number;
  /** Low priority items (P3/P4) */
  lowCount: number;
  /** Noise (non-security-relevant) */
  noiseCount: number;
}

/**
 * Prioritized scan result
 */
export interface PrioritizedScanResult {
  /** All access points with security classification */
  accessPoints: PrioritizedAccessPoint[];
  /** Summary statistics */
  summary: SecuritySummary;
  /** Critical items only (P0/P1) */
  critical: PrioritizedAccessPoint[];
  /** High priority items (P2) */
  high: PrioritizedAccessPoint[];
  /** Low priority items (P3/P4) */
  low: PrioritizedAccessPoint[];
  /** Noise (non-security-relevant) */
  noise: PrioritizedAccessPoint[];
}

// ============================================================================
// Risk Scoring
// ============================================================================

/**
 * Operation risk multipliers
 */
const OPERATION_MULTIPLIERS: Record<DataOperation, number> = {
  write: 1.0,    // Can modify/create sensitive data
  delete: 1.0,   // Can destroy sensitive data
  read: 0.8,     // Can exfiltrate sensitive data
  unknown: 0.5,  // Uncertain risk
};

/**
 * Tables that are typically NOT security-relevant (noise)
 */
const NOISE_TABLE_PATTERNS = [
  /^settings$/i,
  /^preferences$/i,
  /^themes$/i,
  /^ui_/i,
  /^display_/i,
  /^layout/i,
  /^color/i,
  /^style/i,
  /^cache$/i,
  /^temp$/i,
  /^tmp$/i,
  /^migrations$/i,
  /^schema_/i,
  /^_prisma/i,
  /^__/,  // Internal tables
];

/**
 * Fields that are typically NOT security-relevant (noise)
 */
const NOISE_FIELD_PATTERNS = [
  /^color$/i,
  /^theme$/i,
  /^font/i,
  /^size$/i,
  /^width$/i,
  /^height$/i,
  /^position$/i,
  /^layout$/i,
  /^display$/i,
  /^visible$/i,
  /^enabled$/i,
  /^active$/i,
  /^created_at$/i,
  /^updated_at$/i,
  /^deleted_at$/i,
  /^version$/i,
  /^sort_order$/i,
  /^order$/i,
  /^index$/i,
];

// ============================================================================
// Security Prioritizer
// ============================================================================

/**
 * Prioritizes data access points by security risk
 */
export class SecurityPrioritizer {
  private classifier: SensitivityClassifier;

  constructor() {
    this.classifier = createSensitivityClassifier();
  }

  /**
   * Prioritize all access points from a scan result
   */
  prioritize(accessMap: DataAccessMap): PrioritizedScanResult {
    const prioritized: PrioritizedAccessPoint[] = [];

    for (const accessPoint of Object.values(accessMap.accessPoints)) {
      const classification = this.classifyAccessPoint(accessPoint, accessMap);
      const sensitiveFields = this.findSensitiveFields(accessPoint, accessMap);

      prioritized.push({
        accessPoint,
        security: classification,
        sensitiveFields,
      });
    }

    // Sort by risk score (highest first)
    prioritized.sort((a, b) => b.security.riskScore - a.security.riskScore);

    // Categorize
    const critical = prioritized.filter(p => p.security.tier === 'P0' || p.security.tier === 'P1');
    const high = prioritized.filter(p => p.security.tier === 'P2');
    const low = prioritized.filter(p => p.security.tier === 'P3' || p.security.tier === 'P4');
    const noise = prioritized.filter(p => !p.security.isSecurityRelevant);

    // Build summary
    const summary = this.buildSummary(prioritized);

    return {
      accessPoints: prioritized,
      summary,
      critical,
      high,
      low,
      noise,
    };
  }

  /**
   * Classify a single access point
   */
  classifyAccessPoint(
    accessPoint: DataAccessPoint,
    accessMap: DataAccessMap
  ): SecurityClassification {
    // Check if this is noise (non-security-relevant)
    if (this.isNoise(accessPoint)) {
      return {
        tier: 'P4',
        riskScore: 5,
        maxSensitivity: 'unknown',
        regulations: [],
        rationale: 'Non-security-relevant data (UI/settings)',
        isSecurityRelevant: false,
      };
    }

    // Get table info
    const tableInfo = accessMap.tables[accessPoint.table];
    const sensitiveFields = tableInfo?.sensitiveFields ?? [];

    // Classify each field
    let maxScore = 0;
    let maxSensitivity: SensitivityType = 'unknown';
    const allRegulations = new Set<DataRegulation>();
    const rationales: string[] = [];

    // Check fields in the access point
    for (const field of accessPoint.fields) {
      const profile = this.classifier.classify(field, accessPoint.table);
      
      if (profile.baseScore > maxScore) {
        maxScore = profile.baseScore;
        maxSensitivity = profile.type;
      }

      for (const reg of profile.regulations) {
        allRegulations.add(reg);
      }

      if (profile.type !== 'unknown') {
        rationales.push(profile.rationale);
      }
    }

    // Also check sensitive fields detected in the table
    for (const sf of sensitiveFields) {
      const profile = this.classifier.classify(sf.field, sf.table ?? undefined);
      
      if (profile.baseScore > maxScore) {
        maxScore = profile.baseScore;
        maxSensitivity = profile.type;
      }

      for (const reg of profile.regulations) {
        allRegulations.add(reg);
      }
    }

    // Apply operation multiplier
    const operationMultiplier = OPERATION_MULTIPLIERS[accessPoint.operation];
    const riskScore = Math.round(maxScore * operationMultiplier);

    // Determine tier
    const tier = this.calculateTier(riskScore, maxSensitivity, accessPoint.operation);

    // Build rationale
    let rationale = rationales.length > 0 
      ? rationales[0] ?? 'Unknown sensitivity'
      : 'No sensitive data patterns detected';

    if (accessPoint.operation === 'write' || accessPoint.operation === 'delete') {
      rationale += ` (${accessPoint.operation} operation increases risk)`;
    }

    return {
      tier,
      riskScore,
      maxSensitivity,
      regulations: Array.from(allRegulations),
      rationale,
      isSecurityRelevant: maxSensitivity !== 'unknown' || riskScore > 20,
    };
  }

  /**
   * Check if an access point is noise (non-security-relevant)
   */
  private isNoise(accessPoint: DataAccessPoint): boolean {
    // Check table name
    for (const pattern of NOISE_TABLE_PATTERNS) {
      if (pattern.test(accessPoint.table)) {
        return true;
      }
    }

    // Check if ALL fields are noise
    if (accessPoint.fields.length > 0) {
      const allFieldsNoise = accessPoint.fields.every(field => {
        for (const pattern of NOISE_FIELD_PATTERNS) {
          if (pattern.test(field)) {
            return true;
          }
        }
        return false;
      });

      if (allFieldsNoise) {
        return true;
      }
    }

    // Unknown tables with low confidence are likely noise
    if (accessPoint.table === 'unknown' && accessPoint.confidence < 0.5) {
      return true;
    }

    return false;
  }

  /**
   * Calculate priority tier from risk score and context
   */
  private calculateTier(
    riskScore: number,
    sensitivity: SensitivityType,
    operation: DataOperation
  ): PriorityTier {
    // P0: Critical - credentials or financial with write/delete
    if (sensitivity === 'credentials' && (operation === 'write' || operation === 'delete')) {
      return 'P0';
    }
    if (sensitivity === 'financial' && operation === 'write') {
      return 'P0';
    }
    if (riskScore >= 90) {
      return 'P0';
    }

    // P1: High - credentials read, financial, health
    if (sensitivity === 'credentials') {
      return 'P1';
    }
    if (sensitivity === 'financial' || sensitivity === 'health') {
      return 'P1';
    }
    if (riskScore >= 75) {
      return 'P1';
    }

    // P2: Medium - PII
    if (sensitivity === 'pii') {
      return 'P2';
    }
    if (riskScore >= 50) {
      return 'P2';
    }

    // P3: Low
    if (riskScore >= 25) {
      return 'P3';
    }

    // P4: Minimal
    return 'P4';
  }

  /**
   * Find sensitive fields related to an access point
   */
  private findSensitiveFields(
    accessPoint: DataAccessPoint,
    accessMap: DataAccessMap
  ): SensitiveField[] {
    const result: SensitiveField[] = [];

    // Check table's sensitive fields
    const tableInfo = accessMap.tables[accessPoint.table];
    if (tableInfo?.sensitiveFields) {
      result.push(...tableInfo.sensitiveFields);
    }

    // Check global sensitive fields for this table
    for (const sf of accessMap.sensitiveFields) {
      if (sf.table === accessPoint.table && !result.find(r => r.field === sf.field)) {
        result.push(sf);
      }
    }

    return result;
  }

  /**
   * Build summary statistics
   */
  private buildSummary(prioritized: PrioritizedAccessPoint[]): SecuritySummary {
    const byTier: Record<PriorityTier, number> = { P0: 0, P1: 0, P2: 0, P3: 0, P4: 0 };
    const bySensitivity: Record<SensitivityType, number> = {
      credentials: 0,
      financial: 0,
      health: 0,
      pii: 0,
      unknown: 0,
    };
    const regulations = new Set<DataRegulation>();
    let noiseCount = 0;

    for (const p of prioritized) {
      byTier[p.security.tier]++;
      bySensitivity[p.security.maxSensitivity]++;
      
      for (const reg of p.security.regulations) {
        regulations.add(reg);
      }

      if (!p.security.isSecurityRelevant) {
        noiseCount++;
      }
    }

    return {
      totalAccessPoints: prioritized.length,
      byTier,
      bySensitivity,
      regulations: Array.from(regulations),
      criticalCount: byTier.P0 + byTier.P1,
      highCount: byTier.P2,
      lowCount: byTier.P3 + byTier.P4,
      noiseCount,
    };
  }

  /**
   * Get the underlying classifier for custom patterns
   */
  getClassifier(): SensitivityClassifier {
    return this.classifier;
  }
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create a new security prioritizer
 */
export function createSecurityPrioritizer(): SecurityPrioritizer {
  return new SecurityPrioritizer();
}
