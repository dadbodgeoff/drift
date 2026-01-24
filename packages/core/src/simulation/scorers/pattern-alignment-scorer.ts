/**
 * Pattern Alignment Scorer
 *
 * Calculates how well an approach aligns with existing codebase patterns:
 * - Alignment score
 * - Aligned patterns
 * - Conflicting patterns
 * - Whether it creates new patterns
 * - Whether it would be an outlier
 *
 * @module simulation/scorers/pattern-alignment-scorer
 */

import type { IPatternService } from '../../patterns/service.js';
import type { Pattern } from '../../patterns/types.js';
import type {
  SimulationApproach,
  PatternAlignmentMetrics,
  AlignedPattern,
  ConflictingPattern,
  TaskCategory,
} from '../types.js';

// ============================================================================
// Types
// ============================================================================

export interface PatternAlignmentScorerConfig {
  projectRoot: string;
  patternService?: IPatternService | undefined;
  minPatternConfidence?: number | undefined;
}

// ============================================================================
// Category Mapping
// ============================================================================

// Map task categories to pattern categories (using string to avoid type issues)
const TASK_TO_PATTERN_CATEGORY: Record<TaskCategory, string[]> = {
  'rate-limiting': ['api'],
  'authentication': ['auth', 'security'],
  'authorization': ['auth', 'security'],
  'api-endpoint': ['api', 'structural'],
  'data-access': ['data-access', 'structural'],
  'error-handling': ['errors', 'structural'],
  'caching': ['performance', 'data-access'],
  'logging': ['logging', 'structural'],
  'testing': ['testing'],
  'validation': ['api', 'types'],
  'middleware': ['structural'],
  'refactoring': ['structural'],
  'generic': ['structural'],
};

// ============================================================================
// Pattern Alignment Scorer
// ============================================================================

/**
 * Scores how well an approach aligns with existing patterns
 */
export class PatternAlignmentScorer {
  private readonly config: PatternAlignmentScorerConfig;

  constructor(config: PatternAlignmentScorerConfig) {
    this.config = config;
  }

  /**
   * Calculate pattern alignment metrics for an approach
   */
  async score(
    approach: SimulationApproach,
    taskCategory: TaskCategory
  ): Promise<PatternAlignmentMetrics> {
    // If no pattern service, return default metrics
    if (!this.config.patternService) {
      return this.getDefaultMetrics(approach);
    }

    // Get relevant patterns for the task category
    const relevantPatterns = await this.getRelevantPatterns(taskCategory);

    // Find aligned patterns
    const alignedPatterns = this.findAlignedPatterns(approach, relevantPatterns);

    // Find conflicting patterns
    const conflictingPatterns = this.findConflictingPatterns(approach, relevantPatterns);

    // Calculate alignment score
    const alignmentScore = this.calculateAlignmentScore(
      alignedPatterns,
      conflictingPatterns,
      relevantPatterns.length
    );

    // Determine if this creates a new pattern
    const createsNewPattern = this.wouldCreateNewPattern(approach, relevantPatterns);

    // Determine if this would be an outlier
    const wouldBeOutlier = this.wouldBeOutlier(approach, relevantPatterns);

    // Suggest patterns to follow
    const suggestedPatterns = this.suggestPatterns(approach, relevantPatterns);

    return {
      alignmentScore,
      alignedPatterns,
      conflictingPatterns,
      createsNewPattern,
      wouldBeOutlier,
      suggestedPatterns,
    };
  }

  // ==========================================================================
  // Pattern Retrieval
  // ==========================================================================

  /**
   * Get patterns relevant to the task category
   */
  private async getRelevantPatterns(taskCategory: TaskCategory): Promise<Pattern[]> {
    if (!this.config.patternService) {
      return [];
    }

    const patternCategories = TASK_TO_PATTERN_CATEGORY[taskCategory] ?? ['structural'];
    const patterns: Pattern[] = [];

    for (const category of patternCategories) {
      try {
        const result = await this.config.patternService.listByCategory(
          category as any,
          { limit: 20 }
        );
        
        // Get full pattern details
        for (const summary of result.items) {
          const pattern = await this.config.patternService.getPattern(summary.id);
          if (pattern && pattern.confidence >= (this.config.minPatternConfidence ?? 0.5)) {
            patterns.push(pattern);
          }
        }
      } catch {
        // Ignore errors
      }
    }

    return patterns;
  }

  // ==========================================================================
  // Alignment Analysis
  // ==========================================================================

  /**
   * Find patterns that align with the approach
   */
  private findAlignedPatterns(
    approach: SimulationApproach,
    patterns: Pattern[]
  ): AlignedPattern[] {
    const aligned: AlignedPattern[] = [];

    for (const pattern of patterns) {
      const alignmentScore = this.calculatePatternAlignment(approach, pattern);
      
      if (alignmentScore >= 0.5) {
        const alignedPattern: AlignedPattern = {
          id: pattern.id,
          name: pattern.name,
          category: pattern.category,
          alignmentScore,
          reason: this.getAlignmentReason(approach, pattern, alignmentScore),
        };
        if (pattern.locations[0]?.file) {
          alignedPattern.exampleFile = pattern.locations[0].file;
        }
        aligned.push(alignedPattern);
      }
    }

    // Sort by alignment score
    return aligned.sort((a, b) => b.alignmentScore - a.alignmentScore);
  }

  /**
   * Calculate alignment between approach and pattern
   */
  private calculatePatternAlignment(approach: SimulationApproach, pattern: Pattern): number {
    let score = 0;
    let factors = 0;

    // Check if approach targets files with this pattern
    const patternFiles = new Set(pattern.locations.map(l => l.file));
    const targetOverlap = approach.targetFiles.filter(f => patternFiles.has(f)).length;
    if (targetOverlap > 0) {
      score += 0.3 * Math.min(1, targetOverlap / approach.targetFiles.length);
      factors++;
    }

    // Check if approach follows this pattern (by ID)
    if (approach.followsPatterns?.includes(pattern.id)) {
      score += 0.4;
      factors++;
    }

    // Check strategy alignment with pattern name/description
    const patternText = `${pattern.name} ${pattern.description ?? ''}`.toLowerCase();
    const strategyKeywords = this.getStrategyKeywords(approach.strategy);
    const keywordMatches = strategyKeywords.filter(k => patternText.includes(k)).length;
    if (keywordMatches > 0) {
      score += 0.3 * Math.min(1, keywordMatches / strategyKeywords.length);
      factors++;
    }

    return factors > 0 ? score / factors * factors : 0;
  }

  /**
   * Get keywords for a strategy
   */
  private getStrategyKeywords(strategy: string): string[] {
    const keywords: Record<string, string[]> = {
      middleware: ['middleware', 'pipe', 'chain', 'handler'],
      decorator: ['decorator', 'annotation', 'attribute'],
      wrapper: ['wrapper', 'wrap', 'proxy'],
      'per-route': ['route', 'endpoint', 'controller'],
      'per-function': ['function', 'method', 'handler'],
      centralized: ['central', 'single', 'unified'],
      distributed: ['distributed', 'spread', 'multiple'],
      aspect: ['aspect', 'aop', 'cross-cutting'],
      filter: ['filter', 'pipe'],
      interceptor: ['interceptor', 'intercept'],
      guard: ['guard', 'protect', 'check'],
      policy: ['policy', 'rule', 'authorize'],
      dependency: ['inject', 'dependency', 'di'],
      mixin: ['mixin', 'trait', 'compose'],
      custom: [],
    };
    return keywords[strategy] ?? [];
  }

  /**
   * Get reason for alignment
   */
  private getAlignmentReason(
    approach: SimulationApproach,
    pattern: Pattern,
    score: number
  ): string {
    if (approach.followsPatterns?.includes(pattern.id)) {
      return 'Explicitly follows this pattern';
    }
    if (score >= 0.8) {
      return 'Highly aligned with pattern structure and location';
    }
    if (score >= 0.6) {
      return 'Good alignment with pattern approach';
    }
    return 'Partial alignment with pattern';
  }

  // ==========================================================================
  // Conflict Detection
  // ==========================================================================

  /**
   * Find patterns that conflict with the approach
   */
  private findConflictingPatterns(
    approach: SimulationApproach,
    patterns: Pattern[]
  ): ConflictingPattern[] {
    const conflicts: ConflictingPattern[] = [];

    for (const pattern of patterns) {
      const conflict = this.detectConflict(approach, pattern);
      if (conflict) {
        conflicts.push(conflict);
      }
    }

    return conflicts;
  }

  /**
   * Detect if approach conflicts with a pattern
   */
  private detectConflict(
    approach: SimulationApproach,
    pattern: Pattern
  ): ConflictingPattern | null {
    // Check for strategy conflicts
    const conflictingStrategies: Record<string, string[]> = {
      centralized: ['distributed', 'per-route', 'per-function'],
      distributed: ['centralized'],
      middleware: ['per-function'],
      decorator: ['wrapper'],
    };

    const patternText = `${pattern.name} ${pattern.description ?? ''}`.toLowerCase();
    const approachConflicts = conflictingStrategies[approach.strategy] ?? [];

    for (const conflictStrategy of approachConflicts) {
      const conflictKeywords = this.getStrategyKeywords(conflictStrategy);
      if (conflictKeywords.some(k => patternText.includes(k))) {
        return {
          id: pattern.id,
          name: pattern.name,
          category: pattern.category,
          conflictReason: `Pattern uses ${conflictStrategy} approach, but approach uses ${approach.strategy}`,
          severity: 'warning',
        };
      }
    }

    // Check for file overlap with different approach
    const patternFiles = new Set(pattern.locations.map(l => l.file));
    const overlappingFiles = approach.targetFiles.filter(f => patternFiles.has(f));
    
    if (overlappingFiles.length > 0 && pattern.outliers.length > 0) {
      // Pattern has outliers in overlapping files - potential conflict
      const outlierFiles = new Set(pattern.outliers.map(o => o.file));
      const conflictFiles = overlappingFiles.filter(f => outlierFiles.has(f));
      
      if (conflictFiles.length > 0) {
        return {
          id: pattern.id,
          name: pattern.name,
          category: pattern.category,
          conflictReason: `Files ${conflictFiles.join(', ')} already have pattern outliers`,
          severity: 'info',
        };
      }
    }

    return null;
  }

  // ==========================================================================
  // Score Calculation
  // ==========================================================================

  /**
   * Calculate overall alignment score
   */
  private calculateAlignmentScore(
    aligned: AlignedPattern[],
    conflicts: ConflictingPattern[],
    totalPatterns: number
  ): number {
    if (totalPatterns === 0) {
      return 50; // Neutral when no patterns exist
    }

    // Base score from aligned patterns
    let score = 0;
    for (const pattern of aligned) {
      score += pattern.alignmentScore * 20;
    }

    // Penalty for conflicts
    for (const conflict of conflicts) {
      if (conflict.severity === 'error') {
        score -= 30;
      } else if (conflict.severity === 'warning') {
        score -= 15;
      } else {
        score -= 5;
      }
    }

    // Normalize to 0-100
    return Math.max(0, Math.min(100, 50 + score));
  }

  // ==========================================================================
  // Pattern Prediction
  // ==========================================================================

  /**
   * Determine if approach would create a new pattern
   */
  private wouldCreateNewPattern(approach: SimulationApproach, patterns: Pattern[]): boolean {
    // If no similar patterns exist, this would create a new one
    if (patterns.length === 0) {
      return true;
    }

    // Check if any pattern matches the approach strategy
    const strategyKeywords = this.getStrategyKeywords(approach.strategy);
    for (const pattern of patterns) {
      const patternText = `${pattern.name} ${pattern.description ?? ''}`.toLowerCase();
      if (strategyKeywords.some(k => patternText.includes(k))) {
        return false;
      }
    }

    return true;
  }

  /**
   * Determine if approach would be an outlier
   */
  private wouldBeOutlier(approach: SimulationApproach, patterns: Pattern[]): boolean {
    // If creating new pattern, not an outlier
    if (this.wouldCreateNewPattern(approach, patterns)) {
      return false;
    }

    // Check if approach deviates from existing patterns
    for (const pattern of patterns) {
      const alignment = this.calculatePatternAlignment(approach, pattern);
      if (alignment >= 0.3 && alignment < 0.7) {
        // Partial alignment suggests potential outlier
        return true;
      }
    }

    return false;
  }

  /**
   * Suggest patterns to follow
   */
  private suggestPatterns(approach: SimulationApproach, patterns: Pattern[]): string[] {
    const suggestions: string[] = [];

    // Find high-confidence patterns that could apply
    for (const pattern of patterns) {
      if (pattern.confidence >= 0.8 && pattern.status === 'approved') {
        const alignment = this.calculatePatternAlignment(approach, pattern);
        if (alignment < 0.5) {
          suggestions.push(`Consider following "${pattern.name}" pattern`);
        }
      }
    }

    return suggestions.slice(0, 3);
  }

  // ==========================================================================
  // Default Metrics
  // ==========================================================================

  /**
   * Get default metrics when pattern service is not available
   */
  private getDefaultMetrics(_approach: SimulationApproach): PatternAlignmentMetrics {
    return {
      alignmentScore: 50, // Neutral
      alignedPatterns: [],
      conflictingPatterns: [],
      createsNewPattern: true,
      wouldBeOutlier: false,
      suggestedPatterns: [],
    };
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a pattern alignment scorer
 */
export function createPatternAlignmentScorer(
  config: PatternAlignmentScorerConfig
): PatternAlignmentScorer {
  return new PatternAlignmentScorer(config);
}
