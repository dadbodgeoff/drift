/**
 * Simulation Engine
 *
 * @license BSL-1.1
 * @changeDate 2030-01-25
 * 
 * Main orchestrator for the Speculative Execution Engine.
 * Coordinates approach generation, scoring, and ranking.
 * 
 * This is an ENTERPRISE FEATURE requiring a commercial license
 * for production use. See LICENSING.md for details.
 *
 * @module simulation/simulation-engine
 */

import { ApproachGenerator } from './approach-generator.js';
import {
  FrictionScorer,
  ImpactScorer,
  PatternAlignmentScorer,
  SecurityScorer,
} from './scorers/index.js';

import type {
  SimulationTask,
  SimulationApproach,
  SimulatedApproach,
  SimulationResult,
  SimulationOptions,
  ScoringWeights,
  ApproachTradeoff,
  TaskCategory,
} from './types.js';
import type { CallGraph, CallGraphLanguage } from '../call-graph/types.js';
import type { IPatternService } from '../patterns/service.js';

// ============================================================================
// Types
// ============================================================================

export interface SimulationEngineConfig {
  projectRoot: string;
  callGraph?: CallGraph | undefined;
  patternService?: IPatternService | undefined;
  weights?: Partial<ScoringWeights> | undefined;
  options?: Partial<SimulationOptions> | undefined;
}

// ============================================================================
// Simulation Engine
// ============================================================================

/**
 * Main simulation engine that orchestrates the speculative execution
 */
export class SimulationEngine {
  private readonly config: SimulationEngineConfig;
  private readonly weights: ScoringWeights;
  private readonly options: Required<SimulationOptions>;

  private readonly approachGenerator: ApproachGenerator;
  private readonly frictionScorer: FrictionScorer;
  private readonly impactScorer: ImpactScorer;
  private readonly patternAlignmentScorer: PatternAlignmentScorer;
  private readonly securityScorer: SecurityScorer;

  constructor(config: SimulationEngineConfig) {
    this.config = config;
    
    // Merge weights with defaults
    this.weights = {
      friction: 0.30,
      impact: 0.25,
      patternAlignment: 0.30,
      security: 0.15,
      ...config.weights,
    };

    // Merge options with defaults
    this.options = {
      maxApproaches: 5,
      maxDepth: 10,
      includeSecurityAnalysis: true,
      minPatternConfidence: 0.5,
      timeout: 30000,
      enableCache: true,
      ...config.options,
    };

    // Initialize components
    this.approachGenerator = new ApproachGenerator({
      projectRoot: config.projectRoot,
      patternService: config.patternService,
      callGraph: config.callGraph,
    });

    this.frictionScorer = new FrictionScorer({
      projectRoot: config.projectRoot,
      callGraph: config.callGraph,
      patternService: config.patternService,
    });

    this.impactScorer = new ImpactScorer({
      projectRoot: config.projectRoot,
      callGraph: config.callGraph,
      maxDepth: this.options.maxDepth,
    });

    this.patternAlignmentScorer = new PatternAlignmentScorer({
      projectRoot: config.projectRoot,
      patternService: config.patternService,
      minPatternConfidence: this.options.minPatternConfidence,
    });

    this.securityScorer = new SecurityScorer({
      projectRoot: config.projectRoot,
      callGraph: config.callGraph,
      maxDepth: this.options.maxDepth,
    });
  }

  /**
   * Run simulation for a task
   */
  async simulate(task: SimulationTask): Promise<SimulationResult> {
    const startTime = Date.now();
    const dataSources: string[] = [];

    // Track data sources
    if (this.config.callGraph) {dataSources.push('call-graph');}
    if (this.config.patternService) {dataSources.push('patterns');}

    // Step 1: Generate approaches
    const generated = await this.approachGenerator.generate(
      task,
      this.options.maxApproaches
    );

    // Step 2: Score each approach
    const simulatedApproaches: SimulatedApproach[] = [];

    for (const approach of generated.approaches) {
      const simulated = await this.scoreApproach(approach, generated.detectedCategory);
      simulatedApproaches.push(simulated);
    }

    // Step 3: Rank approaches
    this.rankApproaches(simulatedApproaches);

    // Step 4: Generate tradeoffs
    const tradeoffs = this.generateTradeoffs(simulatedApproaches);

    // Step 5: Select recommended approach
    const recommended = simulatedApproaches[0];

    // Step 6: Generate summary
    const summary = recommended 
      ? this.generateSummary(task, recommended, simulatedApproaches)
      : 'No approaches could be generated for this task.';

    // Step 7: Calculate confidence
    const confidence = this.calculateConfidence(simulatedApproaches, dataSources);

    const executionTimeMs = Date.now() - startTime;

    // If no approaches were generated, create a fallback
    if (!recommended) {
      const fallbackApproach = this.createFallbackApproach(task, generated.detectedCategory, generated.detectedLanguage);
      const fallbackSimulated = await this.scoreApproach(fallbackApproach, generated.detectedCategory);
      fallbackSimulated.rank = 1;
      simulatedApproaches.push(fallbackSimulated);
      
      return {
        task,
        approaches: simulatedApproaches,
        recommended: fallbackSimulated,
        summary: this.generateSummary(task, fallbackSimulated, simulatedApproaches),
        tradeoffs: [],
        confidence,
        metadata: {
          executionTimeMs,
          approachesSimulated: 1,
          approachesGenerated: 0,
          dataSourcesUsed: dataSources,
        },
      };
    }

    return {
      task,
      approaches: simulatedApproaches,
      recommended,
      summary,
      tradeoffs,
      confidence,
      metadata: {
        executionTimeMs,
        approachesSimulated: simulatedApproaches.length,
        approachesGenerated: generated.approaches.length,
        dataSourcesUsed: dataSources,
      },
    };
  }

  // ==========================================================================
  // Scoring
  // ==========================================================================

  /**
   * Score a single approach
   */
  private async scoreApproach(
    approach: SimulationApproach,
    category: TaskCategory
  ): Promise<SimulatedApproach> {
    // Run all scorers
    const [friction, impact, patternAlignment, security] = await Promise.all([
      this.frictionScorer.score(approach),
      this.impactScorer.score(approach),
      this.patternAlignmentScorer.score(approach, category),
      this.options.includeSecurityAnalysis
        ? this.securityScorer.score(approach)
        : Promise.resolve({
            securityRisk: 0,
            dataAccessImplications: [],
            authImplications: [],
            warnings: [],
          }),
    ]);

    // Calculate composite score (lower is better for friction/impact/security, higher for alignment)
    // Normalize all to 0-100 where higher is better
    const frictionScore = 100 - friction.overall;
    const impactScore = 100 - impact.riskScore;
    const alignmentScore = patternAlignment.alignmentScore;
    const securityScore = 100 - security.securityRisk;

    const score =
      frictionScore * this.weights.friction +
      impactScore * this.weights.impact +
      alignmentScore * this.weights.patternAlignment +
      securityScore * this.weights.security;

    // Generate reasoning
    const reasoning = this.generateReasoning(approach, friction, impact, patternAlignment, security);

    // Generate pros and cons
    const { pros, cons } = this.generateProsAndCons(friction, impact, patternAlignment, security);

    // Generate warnings
    const warnings = this.collectWarnings(impact, security);

    // Generate next steps
    const nextSteps = this.generateNextSteps(approach, patternAlignment);

    // Check constraints
    const { satisfied, unsatisfied } = this.checkConstraints(approach);

    return {
      approach,
      friction,
      impact,
      patternAlignment,
      security,
      score,
      rank: 0, // Will be set during ranking
      reasoning,
      pros,
      cons,
      warnings,
      nextSteps,
      satisfiedConstraints: satisfied,
      unsatisfiedConstraints: unsatisfied,
    };
  }

  // ==========================================================================
  // Ranking
  // ==========================================================================

  /**
   * Rank approaches by score
   */
  private rankApproaches(approaches: SimulatedApproach[]): void {
    // Sort by score (higher is better)
    approaches.sort((a, b) => b.score - a.score);

    // Assign ranks
    for (let i = 0; i < approaches.length; i++) {
      approaches[i]!.rank = i + 1;
    }
  }

  // ==========================================================================
  // Tradeoff Analysis
  // ==========================================================================

  /**
   * Generate tradeoff comparisons between approaches
   */
  private generateTradeoffs(approaches: SimulatedApproach[]): ApproachTradeoff[] {
    const tradeoffs: ApproachTradeoff[] = [];

    // Compare top approaches pairwise
    for (let i = 0; i < Math.min(approaches.length - 1, 3); i++) {
      for (let j = i + 1; j < Math.min(approaches.length, 4); j++) {
        const a1 = approaches[i]!;
        const a2 = approaches[j]!;

        const dimensions = [
          {
            dimension: 'Friction',
            approach1Value: 100 - a1.friction.overall,
            approach2Value: 100 - a2.friction.overall,
            better: a1.friction.overall < a2.friction.overall ? a1.approach.name : a2.approach.name,
          },
          {
            dimension: 'Impact',
            approach1Value: 100 - a1.impact.riskScore,
            approach2Value: 100 - a2.impact.riskScore,
            better: a1.impact.riskScore < a2.impact.riskScore ? a1.approach.name : a2.approach.name,
          },
          {
            dimension: 'Pattern Alignment',
            approach1Value: a1.patternAlignment.alignmentScore,
            approach2Value: a2.patternAlignment.alignmentScore,
            better: a1.patternAlignment.alignmentScore > a2.patternAlignment.alignmentScore
              ? a1.approach.name
              : a2.approach.name,
          },
          {
            dimension: 'Security',
            approach1Value: 100 - a1.security.securityRisk,
            approach2Value: 100 - a2.security.securityRisk,
            better: a1.security.securityRisk < a2.security.securityRisk
              ? a1.approach.name
              : a2.approach.name,
          },
        ];

        const comparison = this.generateComparisonText(a1, a2, dimensions);

        tradeoffs.push({
          approach1: a1.approach.name,
          approach2: a2.approach.name,
          comparison,
          winner: a1.score > a2.score ? a1.approach.name : a2.approach.name,
          dimensions,
        });
      }
    }

    return tradeoffs;
  }

  /**
   * Generate comparison text
   */
  private generateComparisonText(
    a1: SimulatedApproach,
    a2: SimulatedApproach,
    dimensions: ApproachTradeoff['dimensions']
  ): string {
    const a1Wins = dimensions.filter(d => d.better === a1.approach.name).length;
    const a2Wins = dimensions.filter(d => d.better === a2.approach.name).length;

    if (a1Wins > a2Wins) {
      return `${a1.approach.name} is better in ${a1Wins} of 4 dimensions`;
    } else if (a2Wins > a1Wins) {
      return `${a2.approach.name} is better in ${a2Wins} of 4 dimensions`;
    } else {
      return 'Both approaches are comparable across dimensions';
    }
  }

  // ==========================================================================
  // Helper Methods
  // ==========================================================================

  /**
   * Generate reasoning for an approach
   */
  private generateReasoning(
    _approach: SimulationApproach,
    friction: SimulatedApproach['friction'],
    impact: SimulatedApproach['impact'],
    alignment: SimulatedApproach['patternAlignment'],
    security: SimulatedApproach['security']
  ): string {
    const parts: string[] = [];

    // Friction assessment
    if (friction.overall < 30) {
      parts.push('Low friction implementation');
    } else if (friction.overall < 60) {
      parts.push('Moderate implementation effort');
    } else {
      parts.push('High implementation effort');
    }

    // Impact assessment
    if (impact.riskScore < 30) {
      parts.push('minimal blast radius');
    } else if (impact.riskScore < 60) {
      parts.push('moderate impact scope');
    } else {
      parts.push('significant impact scope');
    }

    // Pattern alignment
    if (alignment.alignmentScore >= 70) {
      parts.push('well-aligned with existing patterns');
    } else if (alignment.alignmentScore >= 40) {
      parts.push('partially aligned with patterns');
    } else {
      parts.push('may introduce new patterns');
    }

    // Security
    if (security.securityRisk > 50) {
      parts.push('requires security review');
    }

    return parts.join(', ') + '.';
  }

  /**
   * Generate pros and cons
   */
  private generateProsAndCons(
    friction: SimulatedApproach['friction'],
    impact: SimulatedApproach['impact'],
    alignment: SimulatedApproach['patternAlignment'],
    security: SimulatedApproach['security']
  ): { pros: string[]; cons: string[] } {
    const pros: string[] = [];
    const cons: string[] = [];

    // Friction
    if (friction.codeChurn < 30) {pros.push('Minimal code changes');}
    else if (friction.codeChurn > 60) {cons.push('Significant code changes required');}

    if (friction.testingEffort < 40) {pros.push('Easy to test');}
    else if (friction.testingEffort > 70) {cons.push('Extensive testing required');}

    if (friction.learningCurve < 30) {pros.push('Uses familiar patterns');}
    else if (friction.learningCurve > 60) {cons.push('Steep learning curve');}

    // Impact
    if (impact.filesAffected < 5) {pros.push('Localized changes');}
    else if (impact.filesAffected > 15) {cons.push('Changes spread across many files');}

    if (impact.entryPointsAffected === 0) {pros.push('No API changes');}
    else if (impact.entryPointsAffected > 5) {cons.push('Multiple API endpoints affected');}

    // Alignment
    if (alignment.alignedPatterns.length > 0) {
      pros.push(`Follows ${alignment.alignedPatterns.length} existing pattern(s)`);
    }
    if (alignment.conflictingPatterns.length > 0) {
      cons.push(`Conflicts with ${alignment.conflictingPatterns.length} pattern(s)`);
    }
    if (alignment.wouldBeOutlier) {cons.push('May become a pattern outlier');}

    // Security
    if (security.securityRisk < 20) {pros.push('Low security risk');}
    if (security.warnings.length > 0) {
      cons.push(`${security.warnings.length} security consideration(s)`);
    }

    return { pros, cons };
  }

  /**
   * Collect warnings from scorers
   */
  private collectWarnings(
    impact: SimulatedApproach['impact'],
    security: SimulatedApproach['security']
  ): string[] {
    const warnings: string[] = [];

    // Impact warnings
    if (impact.breakingChanges) {
      warnings.push(...impact.breakingChangeRisks);
    }

    // Security warnings
    for (const warning of security.warnings) {
      warnings.push(`${warning.type}: ${warning.message}`);
    }

    return warnings;
  }

  /**
   * Generate next steps
   */
  private generateNextSteps(
    approach: SimulationApproach,
    alignment: SimulatedApproach['patternAlignment']
  ): string[] {
    const steps: string[] = [];

    // Pattern suggestions
    steps.push(...alignment.suggestedPatterns);

    // File-based suggestions
    if (approach.targetFiles.length > 0) {
      steps.push(`Start with: ${approach.targetFiles[0]}`);
    }

    if (approach.newFiles && approach.newFiles.length > 0) {
      steps.push(`Create: ${approach.newFiles.join(', ')}`);
    }

    // Framework notes
    if (approach.frameworkNotes) {
      steps.push(approach.frameworkNotes);
    }

    return steps.slice(0, 5);
  }

  /**
   * Check constraints satisfaction
   */
  private checkConstraints(
    _approach: SimulationApproach
  ): { satisfied: string[]; unsatisfied: string[] } {
    // For now, return empty - constraints checking would be implemented
    // based on the task constraints
    return { satisfied: [], unsatisfied: [] };
  }

  /**
   * Generate summary
   */
  private generateSummary(
    _task: SimulationTask,
    recommended: SimulatedApproach,
    all: SimulatedApproach[]
  ): string {
    const scoreDiff = all.length > 1
      ? Math.round(recommended.score - all[1]!.score)
      : 0;

    let summary = `Recommended: "${recommended.approach.name}" `;
    summary += `(score: ${Math.round(recommended.score)}/100). `;
    
    if (scoreDiff > 10) {
      summary += `Clear winner by ${scoreDiff} points. `;
    } else if (all.length > 1) {
      summary += `Close to "${all[1]!.approach.name}". `;
    }

    summary += recommended.reasoning;

    return summary;
  }

  /**
   * Calculate confidence
   */
  private calculateConfidence(
    approaches: SimulatedApproach[],
    dataSources: string[]
  ): SimulationResult['confidence'] {
    const limitations: string[] = [];

    if (!dataSources.includes('call-graph')) {
      limitations.push('No call graph - impact analysis is estimated');
    }
    if (!dataSources.includes('patterns')) {
      limitations.push('No patterns - alignment analysis is limited');
    }

    // Score based on data sources and approach count
    let score = 50;
    score += dataSources.length * 15;
    score += Math.min(20, approaches.length * 5);

    return {
      score: Math.min(100, score),
      limitations,
      dataSources,
    };
  }

  /**
   * Create a fallback approach when no strategies are available
   */
  private createFallbackApproach(
    task: SimulationTask,
    category: TaskCategory,
    language: CallGraphLanguage
  ): SimulationApproach {
    return {
      id: `fallback-${language}-${Date.now()}`,
      name: 'Generic Implementation',
      description: `A generic implementation for ${category}: ${task.description}`,
      strategy: 'custom',
      language,
      targetFiles: [],
      estimatedLinesAdded: 100,
      estimatedLinesModified: 20,
    };
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a simulation engine
 */
export function createSimulationEngine(config: SimulationEngineConfig): SimulationEngine {
  return new SimulationEngine(config);
}
