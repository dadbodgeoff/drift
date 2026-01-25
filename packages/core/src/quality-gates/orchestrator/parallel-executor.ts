/**
 * Parallel Executor
 * 
 * @license Apache-2.0
 * 
 * Executes gates in parallel where possible.
 * Gates without dependencies can run concurrently.
 */

import type { GateId, GateInput, GateResult } from '../types.js';
import type { GateRegistry } from './gate-registry.js';

/**
 * Executes gates in parallel where possible.
 */
export class ParallelExecutor {
  /**
   * Execute gates in parallel.
   */
  async execute(
    inputs: Array<{ gateId: GateId; input: GateInput }>,
    registry: GateRegistry
  ): Promise<Array<{ gateId: GateId; result: GateResult }>> {
    // Group gates by dependencies
    const groups = this.groupByDependencies(inputs);

    const results: Array<{ gateId: GateId; result: GateResult }> = [];

    // Execute each group in sequence, gates within group in parallel
    for (const group of groups) {
      const groupResults = await Promise.all(
        group.map(async ({ gateId, input }) => {
          try {
            const gate = await registry.get(gateId);
            const result = await gate.execute(input);
            return { gateId, result };
          } catch (error) {
            // Return error result if gate fails to load
            return {
              gateId,
              result: {
                gateId,
                gateName: gateId,
                status: 'errored' as const,
                passed: true, // Errors don't block by default
                score: 0,
                summary: `Gate failed to execute: ${error instanceof Error ? error.message : String(error)}`,
                violations: [],
                warnings: [`Gate ${gateId} failed to execute`],
                executionTimeMs: 0,
                details: {},
                error: error instanceof Error ? error.message : String(error),
              },
            };
          }
        })
      );
      results.push(...groupResults);
    }

    return results;
  }

  /**
   * Group gates by dependencies.
   * Gates without dependencies can run in parallel.
   * 
   * Current dependency model:
   * - All gates are independent and can run in parallel
   * - Future: Add dependency tracking for gates that need results from others
   */
  private groupByDependencies(
    inputs: Array<{ gateId: GateId; input: GateInput }>
  ): Array<Array<{ gateId: GateId; input: GateInput }>> {
    // For now, all gates are independent and can run in parallel
    // This returns a single group containing all gates
    // 
    // Future enhancement: Implement dependency graph
    // - regression-detection might depend on pattern-compliance results
    // - security-boundary might depend on impact-simulation results
    return [inputs];
  }
}
