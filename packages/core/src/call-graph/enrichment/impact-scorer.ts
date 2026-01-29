/**
 * Impact Scorer
 *
 * Enterprise-grade scoring engine for vulnerability impact assessment.
 * Combines multiple factors into actionable priority scores.
 */

import type {
  FindingSeverity,
  FindingCategory,
  DataImpact,
  BlastRadius,
  PriorityScore,
  PriorityTier,
  ImpactClassification,
  BlastRadiusClassification,
  SensitiveFieldImpact,
  EntryPointInfo,
} from './types.js';
import type { SensitivityType, DataOperation } from '../../boundaries/types.js';

// ============================================================================
// Scoring Weights
// ============================================================================

/**
 * Weights for priority score calculation
 * These are tuned based on industry best practices and real-world impact
 */
const PRIORITY_WEIGHTS = {
  severity: 0.30,        // Base severity from scanner
  dataImpact: 0.35,      // Data sensitivity and reach
  blastRadius: 0.20,     // Attack surface size
  exploitability: 0.15,  // How easy to exploit
} as const;

/**
 * Severity base scores
 */
const SEVERITY_SCORES: Record<FindingSeverity, number> = {
  critical: 100,
  high: 80,
  medium: 50,
  low: 25,
  info: 10,
};

/**
 * Category exploitability modifiers
 * Based on CVSS exploitability metrics
 */
const CATEGORY_EXPLOITABILITY: Record<FindingCategory, number> = {
  injection: 95,           // Easy to exploit, high impact
  'broken-auth': 85,       // Often exploitable
  'sensitive-exposure': 70, // Depends on access
  xxe: 75,                 // Requires specific conditions
  'broken-access': 80,     // Common and impactful
  misconfig: 60,           // Varies widely
  xss: 70,                 // Requires user interaction
  deserialization: 85,     // Can be severe
  components: 65,          // Depends on vulnerability
  logging: 30,             // Usually low direct impact
  ssrf: 80,                // Can be severe
  other: 50,               // Unknown
};

/**
 * Sensitivity type impact multipliers
 */
const SENSITIVITY_MULTIPLIERS: Record<SensitivityType, number> = {
  credentials: 1.0,   // Maximum impact
  financial: 0.95,    // Near-maximum
  health: 0.90,       // Very high (HIPAA)
  pii: 0.80,          // High
  unknown: 0.30,      // Low baseline
};

/**
 * Operation risk multipliers
 */
const OPERATION_MULTIPLIERS: Record<DataOperation, number> = {
  write: 1.0,    // Can modify data
  delete: 1.0,   // Can destroy data
  read: 0.7,     // Can exfiltrate
  unknown: 0.5,  // Uncertain
};

// ============================================================================
// Impact Scorer
// ============================================================================

/**
 * Calculates comprehensive impact and priority scores
 */
export class ImpactScorer {
  /**
   * Calculate the overall priority score for a finding
   */
  calculatePriority(
    severity: FindingSeverity,
    category: FindingCategory,
    dataImpact: DataImpact,
    blastRadius: BlastRadius,
    cvss?: number
  ): PriorityScore {
    const increasingFactors: string[] = [];
    const decreasingFactors: string[] = [];

    // Calculate component scores
    const severityScore = this.calculateSeverityScore(severity, cvss);
    const dataImpactScore = dataImpact.score;
    const blastRadiusScore = blastRadius.score;
    const exploitabilityScore = this.calculateExploitabilityScore(
      category,
      blastRadius,
      increasingFactors,
      decreasingFactors
    );

    // Weighted combination
    let overall =
      severityScore * PRIORITY_WEIGHTS.severity +
      dataImpactScore * PRIORITY_WEIGHTS.dataImpact +
      blastRadiusScore * PRIORITY_WEIGHTS.blastRadius +
      exploitabilityScore * PRIORITY_WEIGHTS.exploitability;

    // Apply boosters and penalties
    overall = this.applyModifiers(
      overall,
      dataImpact,
      blastRadius,
      increasingFactors,
      decreasingFactors
    );

    // Clamp to 0-100
    overall = Math.max(0, Math.min(100, Math.round(overall)));

    return {
      overall,
      severityScore: Math.round(severityScore),
      dataImpactScore: Math.round(dataImpactScore),
      blastRadiusScore: Math.round(blastRadiusScore),
      exploitabilityScore: Math.round(exploitabilityScore),
      tier: this.calculateTier(overall, dataImpact, blastRadius),
      increasingFactors,
      decreasingFactors,
    };
  }

  /**
   * Calculate data impact score
   */
  calculateDataImpactScore(
    sensitiveFields: SensitiveFieldImpact[],
    tables: string[],
    maxDepth: number,
    attackSurfaceSize: number
  ): { score: number; classification: ImpactClassification } {
    if (sensitiveFields.length === 0 && tables.length === 0) {
      return { score: 0, classification: 'none' };
    }

    let score = 0;

    // Base score from sensitive fields
    for (const field of sensitiveFields) {
      const sensitivityMultiplier = SENSITIVITY_MULTIPLIERS[field.field.sensitivityType];
      const operationMultiplier = Math.max(
        ...field.operations.map((op) => OPERATION_MULTIPLIERS[op])
      );

      // Field impact: base score * sensitivity * operation * path factor
      const pathFactor = Math.min(1, 1 / Math.sqrt(field.shortestPath + 1));
      const fieldScore = field.impactScore * sensitivityMultiplier * operationMultiplier * pathFactor;

      score += fieldScore;
    }

    // Normalize by number of fields (diminishing returns)
    if (sensitiveFields.length > 0) {
      score = score / Math.sqrt(sensitiveFields.length);
    }

    // Boost for multiple tables (broader exposure)
    if (tables.length > 1) {
      score *= 1 + Math.log10(tables.length) * 0.2;
    }

    // Depth penalty (deeper = harder to exploit)
    if (maxDepth > 3) {
      score *= 1 - (maxDepth - 3) * 0.05;
    }

    // Attack surface boost
    if (attackSurfaceSize > 10) {
      score *= 1 + Math.log10(attackSurfaceSize / 10) * 0.1;
    }

    // Clamp and classify
    score = Math.max(0, Math.min(100, Math.round(score)));

    return {
      score,
      classification: this.classifyImpact(score),
    };
  }

  /**
   * Calculate blast radius score
   */
  calculateBlastRadiusScore(
    entryPoints: EntryPointInfo[],
    affectedFunctionsCount: number,
    linesOfCode: number
  ): { score: number; classification: BlastRadiusClassification } {
    if (entryPoints.length === 0) {
      return { score: 10, classification: 'contained' };
    }

    let score = 0;

    // Entry point analysis
    const publicEntryPoints = entryPoints.filter((ep) => ep.isPublic);
    const unauthEntryPoints = entryPoints.filter((ep) => !ep.requiresAuth);
    const publicUnauthEntryPoints = entryPoints.filter((ep) => ep.isPublic && !ep.requiresAuth);

    // Public + unauthenticated = highest risk
    if (publicUnauthEntryPoints.length > 0) {
      score += 50 + Math.min(30, publicUnauthEntryPoints.length * 10);
    } else if (publicEntryPoints.length > 0) {
      score += 30 + Math.min(20, publicEntryPoints.length * 5);
    } else if (unauthEntryPoints.length > 0) {
      score += 20 + Math.min(15, unauthEntryPoints.length * 3);
    } else {
      score += 10 + Math.min(10, entryPoints.length * 2);
    }

    // Affected functions factor
    if (affectedFunctionsCount > 0) {
      score += Math.min(20, Math.log10(affectedFunctionsCount + 1) * 10);
    }

    // Lines of code factor (larger blast = higher risk)
    if (linesOfCode > 100) {
      score += Math.min(10, Math.log10(linesOfCode / 100) * 5);
    }

    // Clamp and classify
    score = Math.max(0, Math.min(100, Math.round(score)));

    return {
      score,
      classification: this.classifyBlastRadius(score, publicUnauthEntryPoints.length > 0),
    };
  }

  /**
   * Calculate severity score with CVSS override
   */
  private calculateSeverityScore(severity: FindingSeverity, cvss?: number): number {
    if (cvss !== undefined) {
      // CVSS is 0-10, convert to 0-100
      return cvss * 10;
    }
    return SEVERITY_SCORES[severity];
  }

  /**
   * Calculate exploitability score
   */
  private calculateExploitabilityScore(
    category: FindingCategory,
    blastRadius: BlastRadius,
    increasingFactors: string[],
    decreasingFactors: string[]
  ): number {
    let score = CATEGORY_EXPLOITABILITY[category];

    // Public entry points increase exploitability
    const publicEntryPoints = blastRadius.entryPoints.filter((ep) => ep.isPublic);
    if (publicEntryPoints.length > 0) {
      score += 10;
      increasingFactors.push('Publicly accessible entry points');
    }

    // No auth required increases exploitability
    const noAuthEntryPoints = blastRadius.entryPoints.filter((ep) => !ep.requiresAuth);
    if (noAuthEntryPoints.length > 0) {
      score += 15;
      increasingFactors.push('No authentication required');
    }

    // Deep call chains decrease exploitability
    const avgPathLength = blastRadius.entryPoints.reduce(
      (sum, ep) => sum + ep.pathToVulnerability.length,
      0
    ) / Math.max(1, blastRadius.entryPoints.length);

    if (avgPathLength > 5) {
      score -= 10;
      decreasingFactors.push('Deep call chain (harder to reach)');
    }

    return Math.max(0, Math.min(100, score));
  }

  /**
   * Apply modifiers based on specific conditions
   */
  private applyModifiers(
    score: number,
    dataImpact: DataImpact,
    blastRadius: BlastRadius,
    increasingFactors: string[],
    decreasingFactors: string[]
  ): number {
    // Regulatory implications boost
    if (dataImpact.regulations.length > 0) {
      const regBoost = Math.min(15, dataImpact.regulations.length * 5);
      score += regBoost;
      increasingFactors.push(`Regulatory implications: ${dataImpact.regulations.join(', ')}`);
    }

    // Credentials exposure is always critical
    const hasCredentials = dataImpact.sensitiveFields.some(
      (f) => f.field.sensitivityType === 'credentials'
    );
    if (hasCredentials) {
      score = Math.max(score, 85);
      increasingFactors.push('Credentials exposure detected');
    }

    // Financial data exposure
    const hasFinancial = dataImpact.sensitiveFields.some(
      (f) => f.field.sensitivityType === 'financial'
    );
    if (hasFinancial) {
      score += 10;
      increasingFactors.push('Financial data exposure');
    }

    // Health data (HIPAA)
    const hasHealth = dataImpact.sensitiveFields.some(
      (f) => f.field.sensitivityType === 'health'
    );
    if (hasHealth) {
      score += 10;
      increasingFactors.push('Protected health information (HIPAA)');
    }

    // No data access reduces priority
    if (dataImpact.tables.length === 0) {
      score *= 0.7;
      decreasingFactors.push('No database access detected');
    }

    // Contained blast radius reduces priority
    if (blastRadius.classification === 'contained') {
      score *= 0.8;
      decreasingFactors.push('Contained blast radius');
    }

    return score;
  }

  /**
   * Calculate priority tier
   */
  private calculateTier(
    score: number,
    dataImpact: DataImpact,
    blastRadius: BlastRadius
  ): PriorityTier {
    // P0: Critical - immediate action required
    if (score >= 90) {return 'P0';}
    if (
      score >= 80 &&
      dataImpact.sensitiveFields.some((f) => f.field.sensitivityType === 'credentials')
    ) {
      return 'P0';
    }
    if (
      score >= 75 &&
      blastRadius.entryPoints.some((ep) => ep.isPublic && !ep.requiresAuth)
    ) {
      return 'P0';
    }

    // P1: High - fix within 24 hours
    if (score >= 75) {return 'P1';}
    if (score >= 65 && dataImpact.classification === 'catastrophic') {return 'P1';}

    // P2: Medium - fix within 1 week
    if (score >= 50) {return 'P2';}
    if (score >= 40 && dataImpact.regulations.length > 0) {return 'P2';}

    // P3: Low - fix within 1 month
    if (score >= 25) {return 'P3';}

    // P4: Minimal - fix when convenient
    return 'P4';
  }

  /**
   * Classify impact level
   */
  private classifyImpact(score: number): ImpactClassification {
    if (score >= 90) {return 'catastrophic';}
    if (score >= 70) {return 'severe';}
    if (score >= 50) {return 'significant';}
    if (score >= 30) {return 'moderate';}
    if (score >= 10) {return 'minimal';}
    return 'none';
  }

  /**
   * Classify blast radius
   */
  private classifyBlastRadius(
    score: number,
    hasPublicUnauth: boolean
  ): BlastRadiusClassification {
    if (hasPublicUnauth && score >= 70) {return 'critical';}
    if (score >= 70) {return 'high';}
    if (score >= 50) {return 'medium';}
    if (score >= 25) {return 'low';}
    return 'contained';
  }
}

/**
 * Create a new impact scorer
 */
export function createImpactScorer(): ImpactScorer {
  return new ImpactScorer();
}
