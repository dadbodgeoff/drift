/**
 * Base Gate Class
 * 
 * @license Apache-2.0
 * 
 * Abstract base class for all quality gates.
 * Provides common functionality and enforces consistent behavior.
 */

import type {
  Gate,
  GateId,
  GateInput,
  GateResult,
  GateConfig,
  GateStatus,
  GateViolation,
} from '../types.js';

/**
 * Abstract base class for all quality gates.
 * Provides common functionality and enforces consistent behavior.
 */
export abstract class BaseGate implements Gate {
  abstract readonly id: GateId;
  abstract readonly name: string;
  abstract readonly description: string;

  /**
   * Execute the gate. Wraps the implementation with error handling
   * and timing.
   */
  async execute(input: GateInput): Promise<GateResult> {
    const startTime = Date.now();
    
    try {
      // Validate config
      const validation = this.validateConfig(input.config);
      if (!validation.valid) {
        return this.createErrorResult(
          `Invalid configuration: ${validation.errors.join(', ')}`,
          Date.now() - startTime
        );
      }
      
      // Check if gate is enabled
      if (!input.config.enabled) {
        return this.createSkippedResult('Gate is disabled', Date.now() - startTime);
      }
      
      // Execute the actual gate logic
      const result = await this.executeGate(input);
      
      return {
        ...result,
        executionTimeMs: Date.now() - startTime,
      };
    } catch (error) {
      return this.createErrorResult(
        error instanceof Error ? error.message : String(error),
        Date.now() - startTime
      );
    }
  }

  /**
   * Implement this method in subclasses to provide gate-specific logic.
   */
  protected abstract executeGate(input: GateInput): Promise<GateResult>;

  /**
   * Validate the gate configuration.
   */
  abstract validateConfig(config: GateConfig): { valid: boolean; errors: string[] };

  /**
   * Get the default configuration for this gate.
   */
  abstract getDefaultConfig(): GateConfig;

  /**
   * Create a result indicating the gate was skipped.
   */
  protected createSkippedResult(reason: string, executionTimeMs: number): GateResult {
    return {
      gateId: this.id,
      gateName: this.name,
      status: 'skipped',
      passed: true, // Skipped gates don't block
      score: 100,
      summary: `Skipped: ${reason}`,
      violations: [],
      warnings: [],
      executionTimeMs,
      details: { skipReason: reason },
    };
  }

  /**
   * Create a result indicating the gate errored.
   */
  protected createErrorResult(error: string, executionTimeMs: number): GateResult {
    return {
      gateId: this.id,
      gateName: this.name,
      status: 'errored',
      passed: true, // Errored gates don't block by default (fail-safe)
      score: 0,
      summary: `Error: ${error}`,
      violations: [],
      warnings: [`Gate execution failed: ${error}`],
      executionTimeMs,
      details: {},
      error,
    };
  }

  /**
   * Create a violation object.
   */
  protected createViolation(
    params: Omit<GateViolation, 'id' | 'gateId'>
  ): GateViolation {
    return {
      id: `${this.id}-${params.file}-${params.line}-${params.ruleId}`,
      gateId: this.id,
      ...params,
    };
  }

  /**
   * Calculate score from violations.
   */
  protected calculateScoreFromViolations(
    totalChecks: number,
    violations: GateViolation[]
  ): number {
    if (totalChecks === 0) {return 100;}
    
    const errorWeight = 10;
    const warningWeight = 3;
    const infoWeight = 1;
    
    let penalty = 0;
    for (const v of violations) {
      switch (v.severity) {
        case 'error': penalty += errorWeight; break;
        case 'warning': penalty += warningWeight; break;
        case 'info': penalty += infoWeight; break;
        default: penalty += 0.5;
      }
    }
    
    const maxPenalty = totalChecks * errorWeight;
    const score = Math.max(0, 100 - (penalty / maxPenalty) * 100);
    return Math.round(score);
  }

  /**
   * Determine status from score and violations.
   */
  protected determineStatus(
    _score: number,
    violations: GateViolation[],
    blocking: boolean
  ): GateStatus {
    const hasErrors = violations.some(v => v.severity === 'error');
    const hasWarnings = violations.some(v => v.severity === 'warning');
    
    if (hasErrors && blocking) {return 'failed';}
    if (hasWarnings) {return 'warned';}
    return 'passed';
  }

  /**
   * Create a passed result with details.
   */
  protected createPassedResult(
    summary: string,
    details: Record<string, unknown>,
    warnings: string[] = []
  ): GateResult {
    return {
      gateId: this.id,
      gateName: this.name,
      status: 'passed',
      passed: true,
      score: 100,
      summary,
      violations: [],
      warnings,
      executionTimeMs: 0,
      details,
    };
  }

  /**
   * Create a failed result with violations.
   */
  protected createFailedResult(
    summary: string,
    violations: GateViolation[],
    details: Record<string, unknown>,
    score: number,
    warnings: string[] = []
  ): GateResult {
    return {
      gateId: this.id,
      gateName: this.name,
      status: 'failed',
      passed: false,
      score,
      summary,
      violations,
      warnings,
      executionTimeMs: 0,
      details,
    };
  }

  /**
   * Create a warned result.
   */
  protected createWarnedResult(
    summary: string,
    violations: GateViolation[],
    details: Record<string, unknown>,
    score: number,
    warnings: string[] = []
  ): GateResult {
    return {
      gateId: this.id,
      gateName: this.name,
      status: 'warned',
      passed: true, // Warnings don't block
      score,
      summary,
      violations,
      warnings,
      executionTimeMs: 0,
      details,
    };
  }
}
