/**
 * Constraint Synthesizer
 *
 * Converts detected invariants into full Constraint objects,
 * handles deduplication, merging, and ID generation.
 */

import { createHash } from 'node:crypto';


import { CONSTRAINT_SCHEMA_VERSION as SCHEMA_VERSION } from '../types.js';

import type { ConstraintStore } from '../store/constraint-store.js';
import type {
  Constraint,
  ConstraintStatus,
  ConstraintMetadata,
  ExtractionResult,
  ExtractionStats,
  ExtractionOptions,
} from '../types.js';
import type { DetectedInvariant, InvariantDetector } from './invariant-detector.js';

// =============================================================================
// Types
// =============================================================================

export interface ConstraintSynthesizerConfig {
  store: ConstraintStore;
  detector: InvariantDetector;
}

export interface SynthesisOptions extends ExtractionOptions {
  /** Auto-approve constraints above this confidence */
  autoApproveThreshold?: number;
  /** Merge similar constraints */
  mergeSimilar?: boolean;
  /** Similarity threshold for merging (0-1) */
  similarityThreshold?: number;
}

// =============================================================================
// Constraint Synthesizer
// =============================================================================

export class ConstraintSynthesizer {
  private readonly store: ConstraintStore;
  private readonly detector: InvariantDetector;

  constructor(config: ConstraintSynthesizerConfig) {
    this.store = config.store;
    this.detector = config.detector;
  }

  /**
   * Extract and synthesize constraints from the codebase
   */
  async synthesize(options: SynthesisOptions = {}): Promise<ExtractionResult> {
    const startTime = Date.now();

    // Detect invariants
    const invariants = await this.detector.detectAll(options);

    // Convert to constraints
    const constraints = invariants.map(inv => this.toConstraint(inv, options));

    // Merge similar constraints if enabled
    const merged = options.mergeSimilar !== false
      ? this.mergeSimilarConstraints(constraints, options.similarityThreshold ?? 0.8)
      : constraints;

    // Compare with existing constraints
    const existing = this.store.getAll();
    const { discovered, updated, invalidated } = this.diffConstraints(merged, existing);

    // Save new and updated constraints
    if (discovered.length > 0) {
      await this.store.addMany(discovered);
    }

    for (const constraint of updated) {
      await this.store.update(constraint.id, constraint);
    }

    // Mark invalidated constraints
    for (const id of invalidated) {
      await this.store.ignore(id, 'No longer detected in codebase');
    }

    // Build stats
    const stats = this.buildStats(discovered, updated, invalidated, startTime);

    return {
      discovered,
      updated,
      invalidated,
      stats,
    };
  }

  /**
   * Convert a detected invariant to a full Constraint
   */
  private toConstraint(
    invariant: DetectedInvariant,
    options: SynthesisOptions
  ): Constraint {
    const now = new Date().toISOString();

    // Generate deterministic ID based on constraint content
    const id = this.generateConstraintId(invariant);

    // Determine status based on confidence
    let status: ConstraintStatus = 'discovered';
    if (options.autoApproveThreshold !== undefined &&
        invariant.constraint.confidence.score >= options.autoApproveThreshold) {
      status = 'approved';
    }

    const metadata: ConstraintMetadata = {
      createdAt: now,
      updatedAt: now,
      schemaVersion: SCHEMA_VERSION,
      tags: this.generateTags(invariant),
    };

    if (status === 'approved') {
      metadata.approvedBy = 'auto';
      metadata.approvedAt = now;
    }

    return {
      ...invariant.constraint,
      id,
      status,
      metadata,
    };
  }

  /**
   * Generate a deterministic ID for a constraint
   */
  private generateConstraintId(invariant: DetectedInvariant): string {
    const content = JSON.stringify({
      name: invariant.constraint.name,
      category: invariant.constraint.category,
      type: invariant.constraint.invariant.type,
      condition: invariant.constraint.invariant.condition,
    });

    const hash = createHash('sha256').update(content).digest('hex').slice(0, 12);
    return `constraint-${invariant.constraint.category}-${hash}`;
  }

  /**
   * Generate tags for a constraint
   */
  private generateTags(invariant: DetectedInvariant): string[] {
    const tags: string[] = [];

    // Add source tags
    if (invariant.evidence.sources.includes('callGraph')) {
      tags.push('call-graph-derived');
    }
    if (invariant.evidence.sources.some(s => s.startsWith('pattern:'))) {
      tags.push('pattern-derived');
    }
    if (invariant.evidence.sources.includes('boundaries')) {
      tags.push('boundary-derived');
    }
    if (invariant.evidence.sources.includes('testTopology')) {
      tags.push('test-derived');
    }
    if (invariant.evidence.sources.includes('errorHandling')) {
      tags.push('error-handling-derived');
    }

    // Add confidence tags
    if (invariant.constraint.confidence.score >= 0.95) {
      tags.push('high-confidence');
    } else if (invariant.constraint.confidence.score >= 0.85) {
      tags.push('medium-confidence');
    }

    // Add violation tags
    if (invariant.violations.length === 0) {
      tags.push('no-violations');
    } else if (invariant.violations.length > 10) {
      tags.push('many-violations');
    }

    return tags;
  }

  /**
   * Merge similar constraints
   */
  private mergeSimilarConstraints(
    constraints: Constraint[],
    threshold: number
  ): Constraint[] {
    const merged: Constraint[] = [];
    const used = new Set<number>();

    for (let i = 0; i < constraints.length; i++) {
      if (used.has(i)) {continue;}

      const current = constraints[i];
      if (!current) {continue;}
      
      const similar: Constraint[] = [current];

      // Find similar constraints
      for (let j = i + 1; j < constraints.length; j++) {
        if (used.has(j)) {continue;}

        const other = constraints[j];
        if (!other) {continue;}
        
        if (this.areSimilar(current, other, threshold)) {
          similar.push(other);
          used.add(j);
        }
      }

      // Merge if multiple similar found
      if (similar.length > 1) {
        merged.push(this.mergeConstraints(similar));
      } else {
        merged.push(current);
      }

      used.add(i);
    }

    return merged;
  }

  /**
   * Check if two constraints are similar
   */
  private areSimilar(a: Constraint, b: Constraint, threshold: number): boolean {
    // Must be same category
    if (a.category !== b.category) {return false;}

    // Must be same type
    if (a.invariant.type !== b.invariant.type) {return false;}

    // Check name similarity
    const nameSimilarity = this.stringSimilarity(a.name, b.name);
    if (nameSimilarity < threshold) {return false;}

    // Check condition similarity
    const conditionSimilarity = this.stringSimilarity(
      a.invariant.condition,
      b.invariant.condition
    );

    return conditionSimilarity >= threshold;
  }

  /**
   * Calculate string similarity (Jaccard index on words)
   */
  private stringSimilarity(a: string, b: string): number {
    const wordsA = new Set(a.toLowerCase().split(/\s+/));
    const wordsB = new Set(b.toLowerCase().split(/\s+/));

    const intersection = new Set([...wordsA].filter(w => wordsB.has(w)));
    const union = new Set([...wordsA, ...wordsB]);

    return intersection.size / union.size;
  }

  /**
   * Merge multiple similar constraints into one
   */
  private mergeConstraints(constraints: Constraint[]): Constraint {
    // Use the one with highest confidence as base
    const sorted = [...constraints].sort(
      (a, b) => b.confidence.score - a.confidence.score
    );
    const base = sorted[0];
    
    if (!base) {
      throw new Error('Cannot merge empty constraint array');
    }

    // Merge evidence
    const totalEvidence = constraints.reduce(
      (sum, c) => sum + c.confidence.evidence,
      0
    );
    const totalViolations = constraints.reduce(
      (sum, c) => sum + c.confidence.violations,
      0
    );

    // Merge sources
    const allPatterns = new Set<string>();
    const allCallGraphPaths = new Set<string>();
    const allBoundaries = new Set<string>();

    for (const c of constraints) {
      c.derivedFrom.patterns.forEach(p => allPatterns.add(p));
      c.derivedFrom.callGraphPaths.forEach(p => allCallGraphPaths.add(p));
      c.derivedFrom.boundaries.forEach(b => allBoundaries.add(b));
    }

    // Merge tags
    const allTags = new Set<string>();
    for (const c of constraints) {
      c.metadata.tags?.forEach(t => allTags.add(t));
    }

    return {
      ...base,
      derivedFrom: {
        patterns: Array.from(allPatterns),
        callGraphPaths: Array.from(allCallGraphPaths),
        boundaries: Array.from(allBoundaries),
      },
      confidence: {
        ...base.confidence,
        evidence: totalEvidence,
        violations: totalViolations,
        score: totalEvidence / (totalEvidence + totalViolations),
      },
      metadata: {
        ...base.metadata,
        tags: Array.from(allTags),
        notes: `Merged from ${constraints.length} similar constraints`,
      },
    };
  }

  /**
   * Diff new constraints against existing ones
   */
  private diffConstraints(
    newConstraints: Constraint[],
    existing: Constraint[]
  ): {
    discovered: Constraint[];
    updated: Constraint[];
    invalidated: string[];
  } {
    const discovered: Constraint[] = [];
    const updated: Constraint[] = [];
    const invalidated: string[] = [];

    const existingById = new Map(existing.map(c => [c.id, c]));
    const newById = new Map(newConstraints.map(c => [c.id, c]));

    // Find new and updated
    for (const constraint of newConstraints) {
      const existingConstraint = existingById.get(constraint.id);

      if (!existingConstraint) {
        discovered.push(constraint);
      } else if (this.hasChanged(constraint, existingConstraint)) {
        // Preserve status and approval info
        const updatedMetadata: ConstraintMetadata = {
          ...constraint.metadata,
          createdAt: existingConstraint.metadata.createdAt,
        };
        if (existingConstraint.metadata.approvedBy) {
          updatedMetadata.approvedBy = existingConstraint.metadata.approvedBy;
        }
        if (existingConstraint.metadata.approvedAt) {
          updatedMetadata.approvedAt = existingConstraint.metadata.approvedAt;
        }
        
        updated.push({
          ...constraint,
          status: existingConstraint.status,
          metadata: updatedMetadata,
        });
      }
    }

    // Find invalidated (existing but not in new, and not custom)
    for (const existing of existingById.values()) {
      if (!newById.has(existing.id) &&
          existing.status !== 'custom' &&
          existing.status !== 'ignored') {
        invalidated.push(existing.id);
      }
    }

    return { discovered, updated, invalidated };
  }

  /**
   * Check if a constraint has meaningfully changed
   */
  private hasChanged(newC: Constraint, oldC: Constraint): boolean {
    // Check confidence change
    const confidenceDelta = Math.abs(newC.confidence.score - oldC.confidence.score);
    if (confidenceDelta > 0.05) {return true;}

    // Check evidence change
    const evidenceDelta = Math.abs(newC.confidence.evidence - oldC.confidence.evidence);
    if (evidenceDelta > 5) {return true;}

    // Check violation change
    const violationDelta = Math.abs(newC.confidence.violations - oldC.confidence.violations);
    if (violationDelta > 3) {return true;}

    return false;
  }

  /**
   * Build extraction statistics
   */
  private buildStats(
    discovered: Constraint[],
    updated: Constraint[],
    invalidated: string[],
    startTime: number
  ): ExtractionStats {
    const byCategory: Record<string, number> = {};
    const byLanguage: Record<string, number> = {};

    for (const c of [...discovered, ...updated]) {
      byCategory[c.category] = (byCategory[c.category] ?? 0) + 1;
      byLanguage[c.language] = (byLanguage[c.language] ?? 0) + 1;
    }

    return {
      patternsAnalyzed: 0, // Would need to track this in detector
      candidatesFound: discovered.length + updated.length,
      constraintsCreated: discovered.length,
      constraintsUpdated: updated.length,
      constraintsInvalidated: invalidated.length,
      executionTimeMs: Date.now() - startTime,
      byCategory: byCategory as any,
      byLanguage: byLanguage as any,
    };
  }
}

// =============================================================================
// Factory
// =============================================================================

export function createConstraintSynthesizer(
  config: ConstraintSynthesizerConfig
): ConstraintSynthesizer {
  return new ConstraintSynthesizer(config);
}
