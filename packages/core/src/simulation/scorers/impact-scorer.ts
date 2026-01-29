/**
 * Impact Scorer
 *
 * Calculates impact metrics for an approach using the call graph:
 * - Files affected
 * - Functions affected
 * - Entry points affected
 * - Sensitive data paths
 * - Risk assessment
 *
 * @module simulation/scorers/impact-scorer
 */

import { ImpactAnalyzer, type ImpactAnalysisResult } from '../../call-graph/analysis/impact-analyzer.js';

import type { CallGraph } from '../../call-graph/types.js';
import type {
  SimulationApproach,
  ImpactMetrics,
  RiskLevel,
} from '../types.js';

// ============================================================================
// Types
// ============================================================================

export interface ImpactScorerConfig {
  projectRoot: string;
  callGraph?: CallGraph | undefined;
  maxDepth?: number | undefined;
}

// ============================================================================
// Impact Scorer
// ============================================================================

/**
 * Scores the impact of implementing an approach
 */
export class ImpactScorer {
  private readonly config: ImpactScorerConfig;
  private impactAnalyzer: ImpactAnalyzer | null = null;

  constructor(config: ImpactScorerConfig) {
    this.config = config;
    if (config.callGraph) {
      this.impactAnalyzer = new ImpactAnalyzer(config.callGraph);
    }
  }

  /**
   * Calculate impact metrics for an approach
   */
  async score(approach: SimulationApproach): Promise<ImpactMetrics> {
    // If no call graph, estimate from approach metadata
    if (!this.impactAnalyzer || !this.config.callGraph) {
      return this.estimateImpact(approach);
    }

    // Analyze impact of each target file
    const combinedResult = this.analyzeTargetFiles(approach.targetFiles);

    // Calculate risk score
    const riskScore = this.calculateRiskScore(combinedResult, approach);
    const riskLevel = this.getRiskLevel(riskScore);

    // Detect breaking changes
    const { breakingChanges, breakingChangeRisks } = this.detectBreakingChanges(
      combinedResult,
      approach
    );

    return {
      filesAffected: combinedResult.filesAffected,
      functionsAffected: combinedResult.functionsAffected,
      entryPointsAffected: combinedResult.entryPointsAffected,
      sensitiveDataPaths: combinedResult.sensitiveDataPaths,
      riskScore,
      riskLevel,
      breakingChanges,
      breakingChangeRisks,
      maxDepthAffected: combinedResult.maxDepth,
    };
  }

  // ==========================================================================
  // Impact Analysis
  // ==========================================================================

  /**
   * Analyze impact of all target files
   */
  private analyzeTargetFiles(targetFiles: string[]): {
    filesAffected: number;
    functionsAffected: number;
    entryPointsAffected: number;
    sensitiveDataPaths: number;
    maxDepth: number;
    results: ImpactAnalysisResult[];
  } {
    if (!this.impactAnalyzer) {
      return {
        filesAffected: targetFiles.length,
        functionsAffected: 0,
        entryPointsAffected: 0,
        sensitiveDataPaths: 0,
        maxDepth: 0,
        results: [],
      };
    }

    const results: ImpactAnalysisResult[] = [];
    const affectedFiles = new Set<string>();
    const affectedFunctions = new Set<string>();
    const affectedEntryPoints = new Set<string>();
    let sensitiveDataPaths = 0;
    let maxDepth = 0;

    for (const file of targetFiles) {
      const result = this.impactAnalyzer.analyzeFile(file, {
        maxDepth: this.config.maxDepth ?? 10,
      });
      results.push(result);

      // Collect affected items
      for (const affected of result.affected) {
        affectedFiles.add(affected.file);
        affectedFunctions.add(affected.id);
        if (affected.isEntryPoint) {
          affectedEntryPoints.add(affected.id);
        }
      }

      sensitiveDataPaths += result.sensitiveDataPaths.length;
      maxDepth = Math.max(maxDepth, result.summary.maxDepth);
    }

    return {
      filesAffected: affectedFiles.size,
      functionsAffected: affectedFunctions.size,
      entryPointsAffected: affectedEntryPoints.size,
      sensitiveDataPaths,
      maxDepth,
      results,
    };
  }

  // ==========================================================================
  // Risk Calculation
  // ==========================================================================

  /**
   * Calculate overall risk score (0-100)
   */
  private calculateRiskScore(
    analysis: ReturnType<typeof this.analyzeTargetFiles>,
    approach: SimulationApproach
  ): number {
    let score = 0;

    // Files affected (0-25)
    if (analysis.filesAffected > 20) {
      score += 25;
    } else if (analysis.filesAffected > 10) {
      score += 20;
    } else if (analysis.filesAffected > 5) {
      score += 15;
    } else {
      score += analysis.filesAffected * 2;
    }

    // Entry points affected (0-30)
    if (analysis.entryPointsAffected > 10) {
      score += 30;
    } else if (analysis.entryPointsAffected > 5) {
      score += 25;
    } else if (analysis.entryPointsAffected > 2) {
      score += 15;
    } else {
      score += analysis.entryPointsAffected * 5;
    }

    // Sensitive data paths (0-30)
    if (analysis.sensitiveDataPaths > 5) {
      score += 30;
    } else if (analysis.sensitiveDataPaths > 2) {
      score += 20;
    } else if (analysis.sensitiveDataPaths > 0) {
      score += 10;
    }

    // Strategy risk (0-15)
    const strategyRisk: Record<string, number> = {
      middleware: 5,
      decorator: 5,
      wrapper: 8,
      'per-route': 10,
      'per-function': 12,
      centralized: 6,
      distributed: 12,
      aspect: 7,
      filter: 6,
      interceptor: 7,
      guard: 5,
      policy: 6,
      dependency: 8,
      mixin: 10,
      custom: 12,
    };
    score += strategyRisk[approach.strategy] ?? 10;

    return Math.min(100, Math.round(score));
  }

  /**
   * Get risk level from score
   */
  private getRiskLevel(score: number): RiskLevel {
    if (score >= 75) {return 'critical';}
    if (score >= 50) {return 'high';}
    if (score >= 25) {return 'medium';}
    return 'low';
  }

  // ==========================================================================
  // Breaking Changes Detection
  // ==========================================================================

  /**
   * Detect potential breaking changes
   */
  private detectBreakingChanges(
    analysis: ReturnType<typeof this.analyzeTargetFiles>,
    approach: SimulationApproach
  ): { breakingChanges: boolean; breakingChangeRisks: string[] } {
    const risks: string[] = [];

    // Check for entry point modifications
    if (analysis.entryPointsAffected > 0) {
      risks.push(`${analysis.entryPointsAffected} API entry points may be affected`);
    }

    // Check for sensitive data path changes
    if (analysis.sensitiveDataPaths > 0) {
      risks.push(`${analysis.sensitiveDataPaths} sensitive data paths may be affected`);
    }

    // Check strategy-specific risks
    if (approach.strategy === 'per-route' || approach.strategy === 'per-function') {
      risks.push('Distributed changes may affect API contracts');
    }

    if (approach.strategy === 'wrapper') {
      risks.push('Wrapper may change function signatures');
    }

    // Check for high depth impact
    if (analysis.maxDepth > 5) {
      risks.push(`Changes ripple ${analysis.maxDepth} levels deep in call graph`);
    }

    return {
      breakingChanges: risks.length > 0,
      breakingChangeRisks: risks,
    };
  }

  // ==========================================================================
  // Estimation (when no call graph)
  // ==========================================================================

  /**
   * Estimate impact when call graph is not available
   */
  private estimateImpact(approach: SimulationApproach): ImpactMetrics {
    const filesAffected = approach.targetFiles.length + (approach.newFiles?.length ?? 0);
    
    // Estimate functions based on files
    const functionsAffected = filesAffected * 3;

    // Estimate entry points based on strategy
    const entryPointMultiplier: Record<string, number> = {
      middleware: 0.5,
      decorator: 0.3,
      wrapper: 0.4,
      'per-route': 1.0,
      'per-function': 0.8,
      centralized: 0.2,
      distributed: 0.7,
      aspect: 0.3,
      filter: 0.4,
      interceptor: 0.4,
      guard: 0.3,
      policy: 0.3,
      dependency: 0.2,
      mixin: 0.4,
      custom: 0.5,
    };
    const multiplier = entryPointMultiplier[approach.strategy] ?? 0.5;
    const entryPointsAffected = Math.round(filesAffected * multiplier);

    // Calculate risk score
    let riskScore = 0;
    riskScore += Math.min(25, filesAffected * 3);
    riskScore += Math.min(30, entryPointsAffected * 5);
    riskScore += 10; // Base uncertainty

    const riskLevel = this.getRiskLevel(riskScore);

    return {
      filesAffected,
      functionsAffected,
      entryPointsAffected,
      sensitiveDataPaths: 0, // Unknown without call graph
      riskScore,
      riskLevel,
      breakingChanges: entryPointsAffected > 0,
      breakingChangeRisks: entryPointsAffected > 0
        ? ['Entry points may be affected (call graph not available for precise analysis)']
        : [],
      maxDepthAffected: 0,
    };
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create an impact scorer
 */
export function createImpactScorer(config: ImpactScorerConfig): ImpactScorer {
  return new ImpactScorer(config);
}
