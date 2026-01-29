/**
 * Impact Simulation Gate
 * 
 * @license Apache-2.0
 * 
 * Analyzes the blast radius of code changes using call graph analysis.
 * Determines how many downstream files, functions, and entry points are affected.
 * 
 * FUTURE_GATE: gate:impact-simulation (Enterprise tier)
 */

import { BaseGate } from '../base-gate.js';

import type {
  GateId,
  GateInput,
  GateResult,
  GateConfig,
  ImpactSimulationConfig,
  ImpactSimulationDetails,
  GateViolation,
  SensitiveDataPath,
  AffectedFile,
  CallGraph,
} from '../../types.js';

/**
 * Impact Simulation Gate
 * 
 * Analyzes the downstream impact of code changes.
 */
export class ImpactSimulationGate extends BaseGate {
  readonly id: GateId = 'impact-simulation';
  readonly name = 'Impact Simulation';
  readonly description = 'Analyzes blast radius of code changes';

  protected async executeGate(input: GateInput): Promise<GateResult> {
    const config = input.config as ImpactSimulationConfig;
    const callGraph = input.context.callGraph;
    
    if (!callGraph || callGraph.nodes.size === 0) {
      return this.createPassedResult(
        'No call graph available for impact analysis',
        {
          filesAffected: 0,
          functionsAffected: 0,
          entryPointsAffected: [],
          frictionScore: 0,
          breakingRisk: 'low',
          sensitiveDataPaths: [],
          affectedFiles: [],
        } as unknown as Record<string, unknown>,
        ['No call graph found. Run `drift callgraph build` first.']
      );
    }

    // Analyze impact of changed files
    const impact = this.analyzeImpact(input.files, callGraph, config);

    // Build violations from high-impact changes
    const violations = this.buildViolations(impact, config);

    // Determine pass/fail based on thresholds
    const passed = this.evaluateThresholds(impact, config);
    const score = this.calculateScore(impact, config);
    const status = passed ? (violations.length > 0 ? 'warned' : 'passed') : 'failed';

    const details: ImpactSimulationDetails = {
      filesAffected: impact.filesAffected,
      functionsAffected: impact.functionsAffected,
      entryPointsAffected: impact.entryPointsAffected,
      frictionScore: impact.frictionScore,
      breakingRisk: impact.breakingRisk,
      sensitiveDataPaths: impact.sensitiveDataPaths,
      affectedFiles: impact.affectedFiles,
    };

    const summary = this.buildSummary(impact, passed);
    const warnings = this.buildWarnings(impact, config);

    if (!passed) {
      return this.createFailedResult(summary, violations, details as unknown as Record<string, unknown>, score, warnings);
    }

    if (violations.length > 0) {
      return this.createWarnedResult(summary, violations, details as unknown as Record<string, unknown>, score, warnings);
    }

    return {
      gateId: this.id,
      gateName: this.name,
      status,
      passed,
      score,
      summary,
      violations,
      warnings,
      executionTimeMs: 0,
      details: details as unknown as Record<string, unknown>,
    };
  }

  validateConfig(config: GateConfig): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    const c = config as ImpactSimulationConfig;

    if (c.maxFilesAffected < 0) {
      errors.push('maxFilesAffected must be non-negative');
    }
    if (c.maxFunctionsAffected < 0) {
      errors.push('maxFunctionsAffected must be non-negative');
    }
    if (c.maxEntryPointsAffected < 0) {
      errors.push('maxEntryPointsAffected must be non-negative');
    }
    if (c.maxFrictionScore < 0 || c.maxFrictionScore > 100) {
      errors.push('maxFrictionScore must be between 0 and 100');
    }

    return { valid: errors.length === 0, errors };
  }

  getDefaultConfig(): ImpactSimulationConfig {
    return {
      enabled: true,
      blocking: false, // Advisory by default
      maxFilesAffected: 50,
      maxFunctionsAffected: 100,
      maxEntryPointsAffected: 10,
      maxFrictionScore: 70,
      analyzeSensitiveData: true,
    };
  }

  /**
   * Analyze impact of changed files.
   */
  private analyzeImpact(
    files: string[],
    callGraph: CallGraph,
    config: ImpactSimulationConfig
  ): {
    filesAffected: number;
    functionsAffected: number;
    entryPointsAffected: string[];
    frictionScore: number;
    breakingRisk: 'low' | 'medium' | 'high' | 'critical';
    sensitiveDataPaths: SensitiveDataPath[];
    affectedFiles: AffectedFile[];
  } {
    const affectedFiles = new Map<string, { distance: number; affectedBy: 'direct' | 'transitive' }>();
    const affectedFunctions = new Set<string>();
    const entryPointsAffected = new Set<string>();
    const sensitiveDataPaths: SensitiveDataPath[] = [];

    // Find all functions in changed files
    const changedFunctions = new Set<string>();
    for (const [nodeId, node] of callGraph.nodes) {
      if (files.some(f => node.file.endsWith(f) || f.endsWith(node.file))) {
        changedFunctions.add(nodeId);
        affectedFiles.set(node.file, { distance: 0, affectedBy: 'direct' });
      }
    }

    // Traverse call graph to find affected downstream
    const visited = new Set<string>();
    const queue: Array<{ nodeId: string; distance: number }> = [];

    // Initialize queue with callers of changed functions
    for (const edge of callGraph.edges) {
      if (changedFunctions.has(edge.to) && !changedFunctions.has(edge.from)) {
        queue.push({ nodeId: edge.from, distance: 1 });
      }
    }

    // BFS to find all affected nodes
    while (queue.length > 0) {
      const { nodeId, distance } = queue.shift()!;
      if (visited.has(nodeId)) {continue;}
      visited.add(nodeId);

      const node = callGraph.nodes.get(nodeId);
      if (!node) {continue;}

      affectedFunctions.add(nodeId);
      
      // Track affected file
      const existing = affectedFiles.get(node.file);
      if (!existing || existing.distance > distance) {
        affectedFiles.set(node.file, { distance, affectedBy: 'transitive' });
      }

      // Check if this is an entry point (no callers)
      const hasCallers = callGraph.edges.some(e => e.to === nodeId);
      if (!hasCallers) {
        entryPointsAffected.add(node.name);
      }

      // Add callers to queue
      for (const edge of callGraph.edges) {
        if (edge.to === nodeId && !visited.has(edge.from)) {
          queue.push({ nodeId: edge.from, distance: distance + 1 });
        }
      }
    }

    // Analyze sensitive data paths if enabled
    if (config.analyzeSensitiveData) {
      // Simplified - in full implementation would use SemanticDataAccessScanner
      // to find paths from changed code to sensitive data
    }

    // Calculate friction score
    const frictionScore = this.calculateFrictionScore(
      affectedFiles.size,
      affectedFunctions.size,
      entryPointsAffected.size,
      config
    );

    // Determine breaking risk
    const breakingRisk = this.classifyBreakingRisk(
      affectedFiles.size,
      affectedFunctions.size,
      entryPointsAffected.size,
      sensitiveDataPaths.length
    );

    // Convert to output format
    const affectedFilesList: AffectedFile[] = Array.from(affectedFiles.entries())
      .map(([file, info]) => ({
        file,
        affectedBy: info.affectedBy,
        distance: info.distance,
      }))
      .sort((a, b) => a.distance - b.distance);

    return {
      filesAffected: affectedFiles.size,
      functionsAffected: affectedFunctions.size,
      entryPointsAffected: Array.from(entryPointsAffected),
      frictionScore,
      breakingRisk,
      sensitiveDataPaths,
      affectedFiles: affectedFilesList,
    };
  }

  /**
   * Calculate friction score (0-100).
   */
  private calculateFrictionScore(
    filesAffected: number,
    functionsAffected: number,
    entryPointsAffected: number,
    config: ImpactSimulationConfig
  ): number {
    // Weighted score based on thresholds
    const fileScore = Math.min(100, (filesAffected / config.maxFilesAffected) * 100);
    const funcScore = Math.min(100, (functionsAffected / config.maxFunctionsAffected) * 100);
    const entryScore = Math.min(100, (entryPointsAffected / config.maxEntryPointsAffected) * 100);

    // Weighted average (entry points are most important)
    return Math.round((fileScore * 0.3 + funcScore * 0.3 + entryScore * 0.4));
  }

  /**
   * Classify breaking risk level.
   */
  private classifyBreakingRisk(
    filesAffected: number,
    functionsAffected: number,
    entryPointsAffected: number,
    sensitiveDataPaths: number
  ): 'low' | 'medium' | 'high' | 'critical' {
    // Critical: Affects many entry points or sensitive data
    if (entryPointsAffected > 10 || sensitiveDataPaths > 0) {
      return 'critical';
    }

    // High: Large blast radius
    if (filesAffected > 30 || functionsAffected > 50 || entryPointsAffected > 5) {
      return 'high';
    }

    // Medium: Moderate impact
    if (filesAffected > 10 || functionsAffected > 20 || entryPointsAffected > 2) {
      return 'medium';
    }

    return 'low';
  }

  /**
   * Evaluate whether the gate passes based on thresholds.
   */
  private evaluateThresholds(
    impact: {
      filesAffected: number;
      functionsAffected: number;
      entryPointsAffected: string[];
      frictionScore: number;
      sensitiveDataPaths: SensitiveDataPath[];
    },
    config: ImpactSimulationConfig
  ): boolean {
    // Check file threshold
    if (impact.filesAffected > config.maxFilesAffected) {return false;}

    // Check function threshold
    if (impact.functionsAffected > config.maxFunctionsAffected) {return false;}

    // Check entry point threshold
    if (impact.entryPointsAffected.length > config.maxEntryPointsAffected) {return false;}

    // Check friction score
    if (impact.frictionScore > config.maxFrictionScore) {return false;}

    // Check sensitive data (always fails if present and analysis enabled)
    if (config.analyzeSensitiveData && impact.sensitiveDataPaths.length > 0) {
      return false;
    }

    return true;
  }

  /**
   * Build violations from high-impact changes.
   */
  private buildViolations(
    impact: {
      filesAffected: number;
      functionsAffected: number;
      entryPointsAffected: string[];
      frictionScore: number;
      breakingRisk: 'low' | 'medium' | 'high' | 'critical';
      sensitiveDataPaths: SensitiveDataPath[];
    },
    config: ImpactSimulationConfig
  ): GateViolation[] {
    const violations: GateViolation[] = [];

    // Violation for exceeding file threshold
    if (impact.filesAffected > config.maxFilesAffected) {
      violations.push(this.createViolation({
        severity: 'warning',
        file: 'project',
        line: 1,
        column: 1,
        message: `Change affects ${impact.filesAffected} files (threshold: ${config.maxFilesAffected})`,
        explanation: 'Large blast radius increases risk of unintended side effects',
        ruleId: 'impact-files-exceeded',
        suggestedFix: 'Consider breaking the change into smaller, more focused commits',
      }));
    }

    // Violation for exceeding entry point threshold
    if (impact.entryPointsAffected.length > config.maxEntryPointsAffected) {
      violations.push(this.createViolation({
        severity: 'error',
        file: 'project',
        line: 1,
        column: 1,
        message: `Change affects ${impact.entryPointsAffected.length} API entry points (threshold: ${config.maxEntryPointsAffected})`,
        explanation: `Affected entry points: ${impact.entryPointsAffected.slice(0, 5).join(', ')}${impact.entryPointsAffected.length > 5 ? '...' : ''}`,
        ruleId: 'impact-entrypoints-exceeded',
        suggestedFix: 'Review API contract changes and ensure backward compatibility',
      }));
    }

    // Violation for sensitive data paths
    for (const path of impact.sensitiveDataPaths) {
      violations.push(this.createViolation({
        severity: 'error',
        file: path.from,
        line: 1,
        column: 1,
        message: `Change creates path to sensitive data: ${path.sensitiveData}`,
        explanation: `Path: ${path.path.join(' → ')}`,
        ruleId: 'impact-sensitive-data',
        suggestedFix: 'Ensure proper authorization checks are in place',
      }));
    }

    return violations;
  }

  /**
   * Calculate score based on impact.
   */
  private calculateScore(
    impact: {
      filesAffected: number;
      functionsAffected: number;
      entryPointsAffected: string[];
      frictionScore: number;
      breakingRisk: 'low' | 'medium' | 'high' | 'critical';
    },
    _config: ImpactSimulationConfig
  ): number {
    // Inverse of friction score
    return Math.max(0, 100 - impact.frictionScore);
  }

  /**
   * Build human-readable summary.
   */
  private buildSummary(
    impact: {
      filesAffected: number;
      functionsAffected: number;
      entryPointsAffected: string[];
      frictionScore: number;
      breakingRisk: 'low' | 'medium' | 'high' | 'critical';
    },
    passed: boolean
  ): string {
    const riskEmoji = {
      low: '🟢',
      medium: '🟡',
      high: '🟠',
      critical: '🔴',
    }[impact.breakingRisk];

    if (passed) {
      return `${riskEmoji} Impact: ${impact.filesAffected} files, ${impact.functionsAffected} functions, ${impact.entryPointsAffected.length} entry points (${impact.breakingRisk} risk)`;
    }

    return `${riskEmoji} High impact change: ${impact.filesAffected} files, ${impact.functionsAffected} functions, ${impact.entryPointsAffected.length} entry points affected`;
  }

  /**
   * Build warnings for the result.
   */
  private buildWarnings(
    impact: {
      filesAffected: number;
      functionsAffected: number;
      entryPointsAffected: string[];
      frictionScore: number;
      breakingRisk: 'low' | 'medium' | 'high' | 'critical';
    },
    config: ImpactSimulationConfig
  ): string[] {
    const warnings: string[] = [];

    // Warn about approaching thresholds
    if (impact.filesAffected > config.maxFilesAffected * 0.8) {
      warnings.push(`Approaching file impact threshold (${impact.filesAffected}/${config.maxFilesAffected})`);
    }

    if (impact.entryPointsAffected.length > config.maxEntryPointsAffected * 0.8) {
      warnings.push(`Approaching entry point threshold (${impact.entryPointsAffected.length}/${config.maxEntryPointsAffected})`);
    }

    // Warn about high friction
    if (impact.frictionScore > 50 && impact.frictionScore <= config.maxFrictionScore) {
      warnings.push(`Moderate friction score (${impact.frictionScore}/100)`);
    }

    return warnings;
  }
}
