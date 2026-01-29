/**
 * Audit Engine
 *
 * Core engine for pattern auditing, deduplication detection,
 * cross-validation, and recommendation generation.
 *
 * @module audit/audit-engine
 */

import * as crypto from 'node:crypto';

import { HEALTH_SCORE_WEIGHTS } from './types.js';

import type {
  AuditResult,
  AuditSummary,
  AuditOptions,
  AuditEngineConfig,
  PatternAuditResult,
  PatternCrossValidation,
  DuplicateGroup,
  CrossValidationResult,
  CrossValidationIssue,
  CategoryAuditSummary,
  AuditRecommendation,
} from './types.js';
import type { Pattern } from '../store/types.js';

// =============================================================================
// Constants
// =============================================================================

const VERSION = '1.0.0';

// =============================================================================
// Audit Engine Class
// =============================================================================

export class AuditEngine {
  private readonly config: Required<AuditEngineConfig>;

  constructor(config: AuditEngineConfig) {
    this.config = {
      rootDir: config.rootDir,
      autoApproveThreshold: config.autoApproveThreshold ?? 0.90,
      reviewThreshold: config.reviewThreshold ?? 0.70,
      duplicateSimilarityThreshold: config.duplicateSimilarityThreshold ?? 0.85,
      minLocationsForEstablished: config.minLocationsForEstablished ?? 3,
      maxOutlierRatio: config.maxOutlierRatio ?? 0.5,
    };
  }

  /**
   * Run a full audit on discovered patterns
   */
  async runAudit(
    patterns: Pattern[],
    options: AuditOptions = {}
  ): Promise<AuditResult> {
    // Filter patterns by category if specified
    let patternsToAudit = patterns;
    if (options.categories && options.categories.length > 0) {
      patternsToAudit = patterns.filter(p => 
        options.categories!.includes(p.category)
      );
    }

    // Detect duplicates
    const duplicates = await this.detectDuplicates(patternsToAudit);

    // Cross-validate patterns
    const crossValidation = await this.crossValidate(patternsToAudit, options);

    // Generate recommendations for each pattern
    const patternResults = this.generateRecommendations(
      patternsToAudit,
      crossValidation,
      duplicates
    );

    // Calculate health score
    const healthScore = this.calculateHealthScore(
      patternsToAudit,
      crossValidation,
      duplicates
    );

    // Build summary
    const summary = this.buildSummary(patternResults, duplicates, healthScore);

    // Generate scan hash
    const scanHash = this.generateScanHash(patternsToAudit);

    const result: AuditResult = {
      version: VERSION,
      generatedAt: new Date().toISOString(),
      scanHash,
      summary,
      patterns: patternResults,
      duplicates,
      crossValidation,
    };

    return result;
  }

  /**
   * Detect duplicate patterns based on location overlap
   */
  async detectDuplicates(patterns: Pattern[]): Promise<DuplicateGroup[]> {
    const duplicateGroups: DuplicateGroup[] = [];
    const processed = new Set<string>();

    for (let i = 0; i < patterns.length; i++) {
      const patternA = patterns[i]!;
      if (processed.has(patternA.id)) {continue;}

      const group: string[] = [patternA.id];
      const groupNames: string[] = [patternA.name];
      let totalOverlap = 0;
      let totalLocations = patternA.locations.length;

      // Get file set for pattern A
      const filesA = new Set(patternA.locations.map(l => `${l.file}:${l.line}`));

      for (let j = i + 1; j < patterns.length; j++) {
        const patternB = patterns[j]!;
        if (processed.has(patternB.id)) {continue;}

        // Skip if different categories (unlikely to be duplicates)
        if (patternA.category !== patternB.category) {continue;}

        // Get file set for pattern B
        const filesB = new Set(patternB.locations.map(l => `${l.file}:${l.line}`));

        // Calculate overlap
        const overlap = Array.from(filesA).filter(f => filesB.has(f)).length;
        const unionSize = new Set([...Array.from(filesA), ...Array.from(filesB)]).size;
        const similarity = unionSize > 0 ? overlap / unionSize : 0;

        if (similarity >= this.config.duplicateSimilarityThreshold) {
          group.push(patternB.id);
          groupNames.push(patternB.name);
          totalOverlap += overlap;
          totalLocations += patternB.locations.length;
          processed.add(patternB.id);
        }
      }

      if (group.length > 1) {
        processed.add(patternA.id);
        
        const avgSimilarity = totalOverlap / (totalLocations - totalOverlap || 1);
        
        duplicateGroups.push({
          id: `dup-${crypto.randomBytes(4).toString('hex')}`,
          patterns: group,
          patternNames: groupNames,
          similarity: Math.min(1, avgSimilarity),
          reason: 'High location overlap detected',
          recommendation: avgSimilarity > 0.9 ? 'merge' : 'review',
          overlappingLocations: totalOverlap,
          totalLocations,
        });
      }
    }

    return duplicateGroups;
  }

  /**
   * Cross-validate patterns against call graph and constraints
   */
  async crossValidate(
    patterns: Pattern[],
    _options: AuditOptions
  ): Promise<CrossValidationResult> {
    const issues: CrossValidationIssue[] = [];
    let patternsMatchingCallGraph = 0;
    let patternsNotInCallGraph = 0;
    let constraintAlignmentScore = 1.0;
    const testCoverageAlignmentScore = 1.0;

    // For now, we do basic validation
    // Full call graph / constraint integration would require loading those stores
    for (const pattern of patterns) {
      // Check for patterns with no locations (orphans)
      if (pattern.locations.length === 0) {
        issues.push({
          type: 'orphan-pattern',
          severity: 'warning',
          patternId: pattern.id,
          message: `Pattern "${pattern.name}" has no locations`,
        });
        patternsNotInCallGraph++;
      } else {
        patternsMatchingCallGraph++;
      }

      // Check for high outlier ratio
      const outlierRatio = pattern.outliers.length / 
        (pattern.locations.length + pattern.outliers.length || 1);
      
      if (outlierRatio > this.config.maxOutlierRatio) {
        issues.push({
          type: 'inconsistent-data',
          severity: 'warning',
          patternId: pattern.id,
          message: `Pattern "${pattern.name}" has high outlier ratio (${(outlierRatio * 100).toFixed(0)}%)`,
        });
      }

      // Check for low confidence patterns that are approved
      if (pattern.status === 'approved' && pattern.confidence.score < 0.5) {
        issues.push({
          type: 'inconsistent-data',
          severity: 'info',
          patternId: pattern.id,
          message: `Approved pattern "${pattern.name}" has low confidence (${(pattern.confidence.score * 100).toFixed(0)}%)`,
        });
      }
    }

    // Calculate alignment scores based on issues
    const totalPatterns = patterns.length || 1;
    const issueCount = issues.filter(i => i.severity !== 'info').length;
    constraintAlignmentScore = Math.max(0, 1 - (issueCount / totalPatterns));

    return {
      patternsMatchingCallGraph,
      patternsNotInCallGraph,
      callGraphEntriesWithoutPatterns: 0, // Would need call graph data
      constraintAlignment: constraintAlignmentScore,
      testCoverageAlignment: testCoverageAlignmentScore,
      issues,
    };
  }

  /**
   * Generate recommendations for each pattern
   */
  generateRecommendations(
    patterns: Pattern[],
    crossValidation: CrossValidationResult,
    duplicates: DuplicateGroup[]
  ): PatternAuditResult[] {
    // Build lookup for duplicate groups
    const duplicateMap = new Map<string, string>();
    for (const group of duplicates) {
      for (const patternId of group.patterns) {
        duplicateMap.set(patternId, group.id);
      }
    }

    // Build lookup for cross-validation issues
    const issueMap = new Map<string, CrossValidationIssue[]>();
    for (const issue of crossValidation.issues) {
      if (issue.patternId) {
        const existing = issueMap.get(issue.patternId) || [];
        existing.push(issue);
        issueMap.set(issue.patternId, existing);
      }
    }

    return patterns.map(pattern => {
      const reasons: string[] = [];
      let recommendation: AuditRecommendation;

      const confidence = pattern.confidence.score;
      const locationCount = pattern.locations.length;
      const outlierCount = pattern.outliers.length;
      const outlierRatio = outlierCount / (locationCount + outlierCount || 1);
      const issues = issueMap.get(pattern.id) || [];
      const duplicateGroupId = duplicateMap.get(pattern.id);

      // Determine recommendation
      if (confidence >= this.config.autoApproveThreshold && 
          outlierRatio <= this.config.maxOutlierRatio &&
          locationCount >= this.config.minLocationsForEstablished &&
          issues.filter(i => i.severity === 'error').length === 0) {
        recommendation = 'auto-approve';
        reasons.push(`High confidence (${(confidence * 100).toFixed(0)}%)`);
        reasons.push(`${locationCount} consistent locations`);
        if (outlierCount === 0) {
          reasons.push('No outliers detected');
        }
      } else if (confidence >= this.config.reviewThreshold) {
        recommendation = 'review';
        reasons.push(`Moderate confidence (${(confidence * 100).toFixed(0)}%)`);
        if (outlierRatio > 0.2) {
          reasons.push(`Outlier ratio: ${(outlierRatio * 100).toFixed(0)}%`);
        }
        if (locationCount < this.config.minLocationsForEstablished) {
          reasons.push(`Only ${locationCount} locations (need ${this.config.minLocationsForEstablished}+)`);
        }
      } else {
        recommendation = 'likely-false-positive';
        reasons.push(`Low confidence (${(confidence * 100).toFixed(0)}%)`);
        if (outlierRatio > this.config.maxOutlierRatio) {
          reasons.push(`High outlier ratio (${(outlierRatio * 100).toFixed(0)}%)`);
        }
      }

      // Add issue-based reasons
      for (const issue of issues) {
        if (issue.severity === 'error' || issue.severity === 'warning') {
          reasons.push(issue.message);
        }
      }

      // Add duplicate warning
      if (duplicateGroupId) {
        reasons.push('Part of potential duplicate group');
        if (recommendation === 'auto-approve') {
          recommendation = 'review';
        }
      }

      // Build cross-validation status
      const crossValidationStatus: PatternCrossValidation = {
        inCallGraph: locationCount > 0,
        matchesConstraints: issues.filter(i => i.type === 'constraint-mismatch').length === 0,
        hasTestCoverage: true, // Would need test topology data
        issues: issues.map(i => i.message),
      };

      return {
        id: pattern.id,
        name: pattern.name,
        category: pattern.category,
        confidence,
        locationCount,
        outlierCount,
        recommendation,
        reasons,
        crossValidation: crossValidationStatus,
        ...(duplicateGroupId ? { duplicateGroupId } : {}),
      };
    });
  }

  /**
   * Calculate overall health score
   */
  calculateHealthScore(
    patterns: Pattern[],
    crossValidation: CrossValidationResult,
    duplicates: DuplicateGroup[]
  ): number {
    if (patterns.length === 0) {return 100;}

    // Average confidence
    const avgConfidence = patterns.reduce((sum, p) => sum + p.confidence.score, 0) / patterns.length;

    // Approval ratio
    const approvedCount = patterns.filter(p => p.status === 'approved').length;
    const approvalRatio = approvedCount / patterns.length;

    // Compliance rate (locations vs outliers)
    const totalLocations = patterns.reduce((sum, p) => sum + p.locations.length, 0);
    const totalOutliers = patterns.reduce((sum, p) => sum + p.outliers.length, 0);
    const complianceRate = totalLocations / (totalLocations + totalOutliers || 1);

    // Cross-validation rate
    const crossValidationRate = crossValidation.patternsMatchingCallGraph / 
      (crossValidation.patternsMatchingCallGraph + crossValidation.patternsNotInCallGraph || 1);

    // Duplicate-free rate
    const patternsInDuplicates = new Set(duplicates.flatMap(d => d.patterns)).size;
    const duplicateFreeRate = 1 - (patternsInDuplicates / patterns.length);

    // Calculate weighted score
    const score = (
      avgConfidence * HEALTH_SCORE_WEIGHTS.avgConfidence +
      approvalRatio * HEALTH_SCORE_WEIGHTS.approvalRatio +
      complianceRate * HEALTH_SCORE_WEIGHTS.complianceRate +
      crossValidationRate * HEALTH_SCORE_WEIGHTS.crossValidationRate +
      duplicateFreeRate * HEALTH_SCORE_WEIGHTS.duplicateFreeRate
    ) * 100;

    return Math.round(Math.max(0, Math.min(100, score)));
  }

  /**
   * Build audit summary
   */
  private buildSummary(
    patternResults: PatternAuditResult[],
    duplicates: DuplicateGroup[],
    healthScore: number
  ): AuditSummary {
    const byCategory: Record<string, CategoryAuditSummary> = {};

    for (const result of patternResults) {
      if (!byCategory[result.category]) {
        byCategory[result.category] = {
          total: 0,
          autoApproveEligible: 0,
          flaggedForReview: 0,
          likelyFalsePositives: 0,
          avgConfidence: 0,
        };
      }

      const cat = byCategory[result.category]!;
      cat.total++;
      cat.avgConfidence += result.confidence;

      switch (result.recommendation) {
        case 'auto-approve':
          cat.autoApproveEligible++;
          break;
        case 'review':
          cat.flaggedForReview++;
          break;
        case 'likely-false-positive':
          cat.likelyFalsePositives++;
          break;
      }
    }

    // Finalize averages
    for (const cat of Object.values(byCategory)) {
      if (cat.total > 0) {
        cat.avgConfidence /= cat.total;
      }
    }

    return {
      totalPatterns: patternResults.length,
      autoApproveEligible: patternResults.filter(p => p.recommendation === 'auto-approve').length,
      flaggedForReview: patternResults.filter(p => p.recommendation === 'review').length,
      likelyFalsePositives: patternResults.filter(p => p.recommendation === 'likely-false-positive').length,
      duplicateCandidates: duplicates.length,
      healthScore,
      byCategory,
    };
  }

  /**
   * Generate a hash of the scan state for comparison
   */
  private generateScanHash(patterns: Pattern[]): string {
    const data = patterns
      .map(p => `${p.id}:${p.confidence.score}:${p.locations.length}:${p.outliers.length}`)
      .sort()
      .join('|');
    
    return crypto.createHash('sha256').update(data).digest('hex').slice(0, 16);
  }
}
