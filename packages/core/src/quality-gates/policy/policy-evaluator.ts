/**
 * Policy Evaluator
 * 
 * @license Apache-2.0
 * 
 * Evaluates gate results against a policy to determine overall pass/fail.
 */

import type {
  QualityPolicy,
  GateResult,
  GateId,
  GateStatus,
  AggregationConfig,
} from '../types.js';

/**
 * Evaluates gate results against a policy to determine overall pass/fail.
 */
export class PolicyEvaluator {
  /**
   * Evaluate gate results against a policy.
   */
  evaluate(
    gateResults: Record<GateId, GateResult>,
    policy: QualityPolicy
  ): {
    passed: boolean;
    status: GateStatus;
    score: number;
    summary: string;
  } {
    const aggregation = policy.aggregation;

    // Check required gates first
    if (aggregation.requiredGates) {
      for (const gateId of aggregation.requiredGates) {
        const result = gateResults[gateId];
        if (result && !result.passed) {
          return {
            passed: false,
            status: 'failed',
            score: this.calculateScore(gateResults, aggregation),
            summary: `Required gate failed: ${result.gateName}`,
          };
        }
      }
    }

    // Evaluate based on aggregation mode
    switch (aggregation.mode) {
      case 'any':
        return this.evaluateAny(gateResults, aggregation);
      case 'all':
        return this.evaluateAll(gateResults, aggregation);
      case 'weighted':
        return this.evaluateWeighted(gateResults, aggregation);
      case 'threshold':
        return this.evaluateThreshold(gateResults, aggregation);
      default:
        return this.evaluateAny(gateResults, aggregation);
    }
  }

  /**
   * Any gate failure = overall failure.
   */
  private evaluateAny(
    gateResults: Record<GateId, GateResult>,
    aggregation: AggregationConfig
  ): { passed: boolean; status: GateStatus; score: number; summary: string } {
    const results = Object.values(gateResults);
    const failed = results.filter(r => r.status === 'failed');
    const warned = results.filter(r => r.status === 'warned');

    const passed = failed.length === 0;
    const status: GateStatus = failed.length > 0 ? 'failed' : 
                               warned.length > 0 ? 'warned' : 'passed';
    const score = this.calculateScore(gateResults, aggregation);

    let summary: string;
    if (passed) {
      if (warned.length > 0) {
        summary = `All gates passed with ${warned.length} warning${warned.length === 1 ? '' : 's'} (${results.length} gates)`;
      } else {
        summary = `All gates passed (${results.length} gates)`;
      }
    } else {
      summary = `${failed.length} gate${failed.length === 1 ? '' : 's'} failed: ${failed.map(f => f.gateName).join(', ')}`;
    }

    return { passed, status, score, summary };
  }

  /**
   * All gates must fail for overall failure.
   */
  private evaluateAll(
    gateResults: Record<GateId, GateResult>,
    aggregation: AggregationConfig
  ): { passed: boolean; status: GateStatus; score: number; summary: string } {
    const results = Object.values(gateResults);
    const passed = results.filter(r => r.passed);

    const overallPassed = passed.length > 0;
    const status: GateStatus = overallPassed ? 'passed' : 'failed';
    const score = this.calculateScore(gateResults, aggregation);

    const summary = overallPassed
      ? `${passed.length}/${results.length} gates passed`
      : 'All gates failed';

    return { passed: overallPassed, status, score, summary };
  }

  /**
   * Weighted average of gate scores.
   */
  private evaluateWeighted(
    gateResults: Record<GateId, GateResult>,
    aggregation: AggregationConfig
  ): { passed: boolean; status: GateStatus; score: number; summary: string } {
    const weights = aggregation.weights ?? {} as Record<GateId, number>;
    let totalWeight = 0;
    let weightedScore = 0;

    for (const [gateId, result] of Object.entries(gateResults)) {
      const weight = weights[gateId as GateId] ?? 1;
      totalWeight += weight;
      weightedScore += result.score * weight;
    }

    const score = totalWeight > 0 ? Math.round(weightedScore / totalWeight) : 100;
    const minScore = aggregation.minScore ?? 70;
    const passed = score >= minScore;
    const status: GateStatus = passed ? 'passed' : 'failed';

    const summary = passed
      ? `Weighted score: ${score}/100 (min: ${minScore})`
      : `Weighted score below threshold: ${score}/100 (min: ${minScore})`;

    return { passed, status, score, summary };
  }

  /**
   * Overall score must meet threshold.
   */
  private evaluateThreshold(
    gateResults: Record<GateId, GateResult>,
    aggregation: AggregationConfig
  ): { passed: boolean; status: GateStatus; score: number; summary: string } {
    const score = this.calculateScore(gateResults, aggregation);
    const minScore = aggregation.minScore ?? 70;
    const passed = score >= minScore;
    const status: GateStatus = passed ? 'passed' : 'failed';

    const summary = passed
      ? `Score: ${score}/100 (min: ${minScore})`
      : `Score below threshold: ${score}/100 (min: ${minScore})`;

    return { passed, status, score, summary };
  }

  /**
   * Calculate overall score from gate results.
   */
  private calculateScore(
    gateResults: Record<GateId, GateResult>,
    aggregation: AggregationConfig
  ): number {
    const results = Object.values(gateResults);
    if (results.length === 0) {return 100;}

    const weights = aggregation.weights ?? {} as Record<GateId, number>;
    let totalWeight = 0;
    let weightedScore = 0;

    for (const [gateId, result] of Object.entries(gateResults)) {
      const weight = weights[gateId as GateId] ?? 1;
      totalWeight += weight;
      weightedScore += result.score * weight;
    }

    return totalWeight > 0 ? Math.round(weightedScore / totalWeight) : 100;
  }
}
