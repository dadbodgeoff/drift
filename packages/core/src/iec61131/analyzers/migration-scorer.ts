/**
 * Migration Readiness Scorer
 * 
 * Quantifies AI migration readiness for IEC 61131-3 code.
 * Following architecture doc Part 2.2.2: Migration Readiness Scorer
 * 
 * Produces a comprehensive score that tells you:
 * 1. How ready is this code for AI-assisted migration?
 * 2. What are the risks?
 * 3. What order should blocks be migrated?
 * 4. What documentation is missing?
 */

import type {
  STPOU,
  POUMigrationScore,
  MigrationReadinessReport,
  MigrationOrderItem,
  MigrationRisk,
  MigrationBlocker,
  MigrationGrade,
  MigrationDimensionScores,
  MigrationEffortEstimate,
  SafetyAnalysisResult,
} from '../types.js';
import type { DocstringExtractionResult } from '../extractors/index.js';
import type { StateMachineExtractionResult } from '../extractors/index.js';

// ============================================================================
// CONFIGURATION
// ============================================================================

export interface MigrationScorerConfig {
  weights?: Partial<ScoringWeights>;
}

export interface ScoringWeights {
  documentation: number;
  safety: number;
  complexity: number;
  dependencies: number;
  testability: number;
}

const DEFAULT_WEIGHTS: ScoringWeights = {
  documentation: 0.25,
  safety: 0.30,
  complexity: 0.15,
  dependencies: 0.15,
  testability: 0.15,
};

// ============================================================================
// MIGRATION SCORER CLASS
// ============================================================================

export class MigrationScorer {
  private weights: ScoringWeights;

  constructor(config?: MigrationScorerConfig) {
    this.weights = { ...DEFAULT_WEIGHTS, ...config?.weights };
  }

  /**
   * Calculate migration readiness for all POUs
   */
  calculateReadiness(
    pous: STPOU[],
    docstrings: DocstringExtractionResult,
    stateMachines: StateMachineExtractionResult,
    safety: SafetyAnalysisResult,
    callGraph?: Map<string, string[]>
  ): MigrationReadinessReport {
    const pouScores: POUMigrationScore[] = [];

    for (const pou of pous) {
      const score = this.scorePOU(pou, docstrings, stateMachines, safety, callGraph);
      pouScores.push(score);
    }

    // Calculate overall score
    const overallScore = pouScores.length > 0
      ? pouScores.reduce((sum, s) => sum + s.overallScore, 0) / pouScores.length
      : 0;

    // Calculate migration order
    const migrationOrder = this.calculateMigrationOrder(pouScores, callGraph);

    // Assess risks
    const risks = this.assessRisks(pouScores, safety);

    // Estimate effort
    const estimatedEffort = this.estimateEffort(pouScores);

    return {
      overallScore,
      overallGrade: this.scoreToGrade(overallScore),
      pouScores,
      migrationOrder,
      risks,
      estimatedEffort,
    };
  }

  /**
   * Score a single POU
   */
  private scorePOU(
    pou: STPOU,
    docstrings: DocstringExtractionResult,
    stateMachines: StateMachineExtractionResult,
    safety: SafetyAnalysisResult,
    callGraph?: Map<string, string[]>
  ): POUMigrationScore {
    const dimensionScores: MigrationDimensionScores = {
      documentation: this.scoreDocumentation(pou, docstrings),
      safety: this.scoreSafety(pou, safety),
      complexity: this.scoreComplexity(pou, stateMachines),
      dependencies: this.scoreDependencies(pou, callGraph),
      testability: this.scoreTestability(pou, docstrings, stateMachines),
    };

    // Calculate weighted score
    const overallScore = 
      dimensionScores.documentation * this.weights.documentation +
      dimensionScores.safety * this.weights.safety +
      dimensionScores.complexity * this.weights.complexity +
      dimensionScores.dependencies * this.weights.dependencies +
      dimensionScores.testability * this.weights.testability;

    // Identify blockers
    const blockers = this.identifyBlockers(pou, dimensionScores, safety, stateMachines);

    // Generate warnings
    const warnings = this.generateWarnings(pou, dimensionScores);

    // Generate suggestions
    const suggestions = this.generateSuggestions(pou, dimensionScores, docstrings, stateMachines);

    return {
      pouId: pou.id,
      pouName: pou.name,
      pouType: pou.type,
      overallScore,
      dimensionScores,
      grade: this.scoreToGrade(overallScore),
      blockers,
      warnings,
      suggestions,
    };
  }

  // ==========================================================================
  // DIMENSION SCORERS
  // ==========================================================================

  /**
   * Score documentation quality (25% weight)
   */
  private scoreDocumentation(pou: STPOU, docstrings: DocstringExtractionResult): number {
    let score = 0;
    const maxScore = 100;

    // Find docstring for this POU
    const pouDoc = docstrings.docstrings.find(d => 
      d.associatedBlock === pou.name || d.file === pou.location.file
    );

    // Has any documentation? (+20)
    if (pouDoc || pou.documentation) {
      score += 20;
    }

    // Has summary/description? (+15)
    if (pouDoc?.summary || pou.documentation?.summary) {
      score += 15;
    }

    // Has parameter documentation? (+20)
    const inputVars = pou.variables.filter(v => v.section === 'VAR_INPUT');
    if (inputVars.length === 0) {
      score += 20; // No inputs = full score
    } else {
      const documentedInputs = inputVars.filter(v => v.comment);
      score += (documentedInputs.length / inputVars.length) * 20;
    }

    // Has history/changelog? (+15)
    if (pouDoc?.history && pouDoc.history.length > 0) {
      score += 15;
    }

    // Has inline comments? (+15)
    const commentedVars = pou.variables.filter(v => v.comment);
    const commentRatio = pou.variables.length > 0 
      ? commentedVars.length / pou.variables.length 
      : 1;
    score += commentRatio * 15;

    // Has safety notes where needed? (+15)
    const hasSafetyVars = pou.variables.some(v => v.isSafetyCritical);
    if (hasSafetyVars) {
      const safetyVarsWithComments = pou.variables.filter(v => v.isSafetyCritical && v.comment);
      if (safetyVarsWithComments.length > 0) {
        score += 15;
      }
    } else {
      score += 15; // No safety vars = full score
    }

    return Math.min(score, maxScore);
  }

  /**
   * Score safety understanding (30% weight - highest because most critical)
   */
  private scoreSafety(pou: STPOU, safety: SafetyAnalysisResult): number {
    let score = 100; // Start at 100, deduct for issues

    // Check for bypasses in this POU (CRITICAL - major deduction)
    const pouBypasses = safety.bypasses.filter(b => 
      b.location.file === pou.location.file
    );
    if (pouBypasses.length > 0) {
      score -= 40; // Major deduction for bypasses
    }

    // Check for undocumented interlocks
    const pouInterlocks = safety.interlocks.filter(i => 
      i.location.file === pou.location.file
    );
    const undocumentedInterlocks = pouInterlocks.filter(i => !i.relatedInterlocks.length);
    if (undocumentedInterlocks.length > 0) {
      score -= undocumentedInterlocks.length * 5;
    }

    // Check for critical warnings
    const pouWarnings = safety.criticalWarnings.filter(w => 
      w.location.file === pou.location.file
    );
    for (const warning of pouWarnings) {
      switch (warning.severity) {
        case 'critical': score -= 20; break;
        case 'high': score -= 10; break;
        case 'medium': score -= 5; break;
        case 'low': score -= 2; break;
      }
    }

    // Check for safety-critical variables without documentation
    const undocSafetyVars = pou.variables.filter(v => v.isSafetyCritical && !v.comment);
    score -= undocSafetyVars.length * 3;

    return Math.max(0, score);
  }

  /**
   * Score complexity (15% weight)
   */
  private scoreComplexity(pou: STPOU, stateMachines: StateMachineExtractionResult): number {
    let score = 100;

    // Lines of code penalty
    const lines = pou.bodyEndLine - pou.bodyStartLine;
    if (lines > 500) score -= 30;
    else if (lines > 200) score -= 15;
    else if (lines > 100) score -= 5;

    // State machine complexity
    const pouStateMachines = stateMachines.stateMachines.filter(sm => 
      sm.file === pou.location.file
    );
    for (const sm of pouStateMachines) {
      // Deduct for large state machines
      if (sm.states.length > 20) score -= 20;
      else if (sm.states.length > 10) score -= 10;
      else if (sm.states.length > 5) score -= 5;

      // Deduct for verification issues
      if (sm.verification.hasDeadlocks) score -= 15;
      if (sm.verification.hasGaps) score -= 10;
      if (sm.verification.unreachableStates.length > 0) score -= 5;
    }

    // Variable count penalty
    if (pou.variables.length > 50) score -= 15;
    else if (pou.variables.length > 30) score -= 10;
    else if (pou.variables.length > 20) score -= 5;

    return Math.max(0, score);
  }

  /**
   * Score dependencies (15% weight)
   */
  private scoreDependencies(pou: STPOU, callGraph?: Map<string, string[]>): number {
    let score = 100;

    if (!callGraph) {
      return 80; // Default score if no call graph available
    }

    const dependencies = callGraph.get(pou.id) ?? [];

    // Deduct for many dependencies
    if (dependencies.length > 10) score -= 30;
    else if (dependencies.length > 5) score -= 15;
    else if (dependencies.length > 3) score -= 5;

    // Check for circular dependencies (would need more analysis)
    // For now, just penalize high dependency count

    return Math.max(0, score);
  }

  /**
   * Score testability (15% weight)
   */
  private scoreTestability(
    pou: STPOU,
    _docstrings: DocstringExtractionResult,
    stateMachines: StateMachineExtractionResult
  ): number {
    let score = 100;

    // Clear inputs/outputs? (+bonus or no penalty)
    const inputs = pou.variables.filter(v => v.section === 'VAR_INPUT');
    const outputs = pou.variables.filter(v => v.section === 'VAR_OUTPUT');
    
    if (inputs.length === 0 && outputs.length === 0) {
      score -= 20; // No clear interface
    }

    // Documented inputs/outputs?
    const documentedInputs = inputs.filter(v => v.comment);
    const documentedOutputs = outputs.filter(v => v.comment);
    
    if (inputs.length > 0) {
      const inputDocRatio = documentedInputs.length / inputs.length;
      if (inputDocRatio < 0.5) score -= 15;
    }
    if (outputs.length > 0) {
      const outputDocRatio = documentedOutputs.length / outputs.length;
      if (outputDocRatio < 0.5) score -= 15;
    }

    // State machines with clear states?
    const pouStateMachines = stateMachines.stateMachines.filter(sm => 
      sm.file === pou.location.file
    );
    for (const sm of pouStateMachines) {
      const namedStates = sm.states.filter(s => s.name);
      if (namedStates.length < sm.states.length * 0.5) {
        score -= 10; // Many unnamed states
      }
    }

    return Math.max(0, score);
  }

  // ==========================================================================
  // BLOCKERS & WARNINGS
  // ==========================================================================

  private identifyBlockers(
    pou: STPOU,
    scores: MigrationDimensionScores,
    safety: SafetyAnalysisResult,
    stateMachines: StateMachineExtractionResult
  ): MigrationBlocker[] {
    const blockers: MigrationBlocker[] = [];

    // Safety bypass is a blocker
    const pouBypasses = safety.bypasses.filter(b => 
      b.location.file === pou.location.file
    );
    for (const bypass of pouBypasses) {
      blockers.push({
        type: 'safety-bypass',
        description: `Safety bypass detected: ${bypass.name}`,
        severity: 'critical',
        remediation: 'Review with safety engineer before migration. Document bypass purpose and conditions.',
      });
    }

    // Undocumented state machine is a blocker
    const pouStateMachines = stateMachines.stateMachines.filter(sm => 
      sm.file === pou.location.file
    );
    for (const sm of pouStateMachines) {
      const unnamedStates = sm.states.filter(s => !s.name);
      if (unnamedStates.length > sm.states.length * 0.5) {
        blockers.push({
          type: 'undocumented-state-machine',
          description: `Undocumented state machine: ${sm.name} (${unnamedStates.length}/${sm.states.length} states unnamed)`,
          severity: 'high',
          remediation: 'Document state machine states before migration.',
        });
      }
    }

    // Very low documentation score is a blocker
    if (scores.documentation < 30) {
      blockers.push({
        type: 'missing-documentation',
        description: 'Critical lack of documentation',
        severity: 'high',
        remediation: 'Add documentation for inputs, outputs, and purpose before migration.',
      });
    }

    return blockers;
  }

  private generateWarnings(_pou: STPOU, scores: MigrationDimensionScores): string[] {
    const warnings: string[] = [];

    if (scores.documentation < 50) {
      warnings.push('Documentation is below recommended level');
    }
    if (scores.complexity < 50) {
      warnings.push('High complexity may make migration error-prone');
    }
    if (scores.dependencies < 50) {
      warnings.push('Many dependencies - consider migration order carefully');
    }
    if (scores.testability < 50) {
      warnings.push('Low testability - verification may be difficult');
    }

    return warnings;
  }

  private generateSuggestions(
    pou: STPOU,
    scores: MigrationDimensionScores,
    _docstrings: DocstringExtractionResult,
    stateMachines: StateMachineExtractionResult
  ): string[] {
    const suggestions: string[] = [];

    // Documentation suggestions
    if (scores.documentation < 70) {
      const undocVars = pou.variables.filter(v => !v.comment);
      if (undocVars.length > 0) {
        suggestions.push(`Document ${undocVars.length} variables without comments`);
      }
      if (!pou.documentation) {
        suggestions.push('Add header documentation describing purpose and behavior');
      }
    }

    // State machine suggestions
    const pouStateMachines = stateMachines.stateMachines.filter(sm => 
      sm.file === pou.location.file
    );
    for (const sm of pouStateMachines) {
      const unnamedStates = sm.states.filter(s => !s.name);
      if (unnamedStates.length > 0) {
        suggestions.push(`Name ${unnamedStates.length} unnamed states in ${sm.name}`);
      }
      if (sm.verification.hasDeadlocks) {
        suggestions.push(`Review deadlock states in ${sm.name}`);
      }
    }

    // Complexity suggestions
    if (scores.complexity < 50) {
      suggestions.push('Consider breaking into smaller function blocks');
    }

    return suggestions;
  }

  // ==========================================================================
  // MIGRATION ORDER
  // ==========================================================================

  private calculateMigrationOrder(
    pouScores: POUMigrationScore[],
    callGraph?: Map<string, string[]>
  ): MigrationOrderItem[] {
    // Sort by:
    // 1. No blockers first
    // 2. Fewer dependencies first
    // 3. Higher score first
    const sorted = [...pouScores].sort((a, b) => {
      // Blockers last
      if (a.blockers.length !== b.blockers.length) {
        return a.blockers.length - b.blockers.length;
      }
      // Higher score first
      return b.overallScore - a.overallScore;
    });

    return sorted.map((score, index) => {
      const dependencies = callGraph?.get(score.pouId) ?? [];
      
      let reason: string;
      if (score.blockers.length > 0) {
        reason = `Has ${score.blockers.length} blocker(s) - resolve before migration`;
      } else if (dependencies.length === 0) {
        reason = 'No dependencies, well documented';
      } else if (score.overallScore >= 80) {
        reason = 'High readiness score, good documentation';
      } else {
        reason = 'Moderate readiness, review documentation';
      }

      return {
        order: index + 1,
        pouId: score.pouId,
        pouName: score.pouName,
        reason,
        dependencies,
        estimatedEffort: this.estimatePOUEffort(score),
      };
    });
  }

  // ==========================================================================
  // RISK ASSESSMENT
  // ==========================================================================

  private assessRisks(
    pouScores: POUMigrationScore[],
    safety: SafetyAnalysisResult
  ): MigrationRisk[] {
    const risks: MigrationRisk[] = [];

    // Safety bypass risk
    if (safety.bypasses.length > 0) {
      risks.push({
        severity: 'critical',
        category: 'safety',
        description: `${safety.bypasses.length} safety bypass(es) detected`,
        affectedPOUs: safety.bypasses.map(b => b.location.file),
        mitigation: 'Review all bypasses with safety engineer before migration',
      });
    }

    // Low documentation risk
    const lowDocPOUs = pouScores.filter(s => s.dimensionScores.documentation < 40);
    if (lowDocPOUs.length > 0) {
      risks.push({
        severity: 'high',
        category: 'documentation',
        description: `${lowDocPOUs.length} POU(s) have insufficient documentation`,
        affectedPOUs: lowDocPOUs.map(s => s.pouName),
        mitigation: 'Document POUs before migration to ensure correct translation',
      });
    }

    // High complexity risk
    const complexPOUs = pouScores.filter(s => s.dimensionScores.complexity < 40);
    if (complexPOUs.length > 0) {
      risks.push({
        severity: 'medium',
        category: 'complexity',
        description: `${complexPOUs.length} POU(s) have high complexity`,
        affectedPOUs: complexPOUs.map(s => s.pouName),
        mitigation: 'Consider refactoring or extra testing for complex POUs',
      });
    }

    // Blocked POUs risk
    const blockedPOUs = pouScores.filter(s => s.blockers.length > 0);
    if (blockedPOUs.length > 0) {
      risks.push({
        severity: 'high',
        category: 'blockers',
        description: `${blockedPOUs.length} POU(s) have migration blockers`,
        affectedPOUs: blockedPOUs.map(s => s.pouName),
        mitigation: 'Resolve all blockers before attempting migration',
      });
    }

    return risks;
  }

  // ==========================================================================
  // EFFORT ESTIMATION
  // ==========================================================================

  private estimateEffort(pouScores: POUMigrationScore[]): MigrationEffortEstimate {
    const byPOU: Record<string, number> = {};
    let totalHours = 0;

    for (const score of pouScores) {
      const hours = this.estimatePOUHours(score);
      byPOU[score.pouName] = hours;
      totalHours += hours;
    }

    return {
      totalHours,
      byPOU,
      confidence: this.calculateEffortConfidence(pouScores),
    };
  }

  private estimatePOUHours(score: POUMigrationScore): number {
    // Base hours by type
    let baseHours: number;
    switch (score.pouType) {
      case 'PROGRAM': baseHours = 8; break;
      case 'FUNCTION_BLOCK': baseHours = 4; break;
      case 'FUNCTION': baseHours = 2; break;
      default: baseHours = 4;
    }

    // Adjust by score (lower score = more time)
    const scoreMultiplier = 2 - (score.overallScore / 100);
    
    // Adjust for blockers
    const blockerMultiplier = 1 + (score.blockers.length * 0.5);

    return Math.round(baseHours * scoreMultiplier * blockerMultiplier);
  }

  private estimatePOUEffort(score: POUMigrationScore): string {
    const hours = this.estimatePOUHours(score);
    if (hours <= 2) return '1-2 hours';
    if (hours <= 4) return '2-4 hours';
    if (hours <= 8) return '4-8 hours';
    if (hours <= 16) return '1-2 days';
    return '2+ days';
  }

  private calculateEffortConfidence(pouScores: POUMigrationScore[]): number {
    // Higher average score = higher confidence in estimate
    const avgScore = pouScores.reduce((sum, s) => sum + s.overallScore, 0) / pouScores.length;
    return Math.min(0.9, avgScore / 100);
  }

  // ==========================================================================
  // UTILITIES
  // ==========================================================================

  private scoreToGrade(score: number): MigrationGrade {
    if (score >= 90) return 'A';
    if (score >= 80) return 'B';
    if (score >= 70) return 'C';
    if (score >= 60) return 'D';
    return 'F';
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

export function createMigrationScorer(config?: MigrationScorerConfig): MigrationScorer {
  return new MigrationScorer(config);
}
