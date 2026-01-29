/**
 * Gate Run Store
 * 
 * @license Apache-2.0
 * 
 * Stores quality gate run history.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import type { QualityGateResult, GateRunRecord, GateId } from '../types.js';

/**
 * Stores quality gate run history.
 */
export class GateRunStore {
  private runsDir: string;
  private maxRuns: number;

  constructor(projectRoot: string, maxRuns = 100) {
    this.runsDir = path.join(projectRoot, '.drift', 'quality-gates', 'history', 'runs');
    this.maxRuns = maxRuns;
  }

  /**
   * Save a gate run result.
   */
  async save(result: QualityGateResult): Promise<string> {
    await fs.mkdir(this.runsDir, { recursive: true });

    const record: GateRunRecord = {
      id: `run-${Date.now()}`,
      timestamp: result.metadata.timestamp,
      branch: result.metadata.branch,
      ...(result.metadata.commitSha ? { commitSha: result.metadata.commitSha } : {}),
      policyId: result.policy.id,
      passed: result.passed,
      score: result.score,
      gates: Object.fromEntries(
        Object.entries(result.gates).map(([id, gate]) => [
          id,
          { passed: gate.passed, score: gate.score },
        ])
      ) as Record<GateId, { passed: boolean; score: number }>,
      violationCount: result.violations.length,
      executionTimeMs: result.metadata.executionTimeMs,
      ci: result.metadata.ci,
    };

    const filePath = path.join(this.runsDir, `${record.id}.json`);
    await fs.writeFile(filePath, JSON.stringify(record, null, 2));

    // Cleanup old runs
    await this.cleanup();

    return record.id;
  }

  /**
   * Get recent runs.
   */
  async getRecent(limit = 20): Promise<GateRunRecord[]> {
    try {
      const files = await fs.readdir(this.runsDir);
      const jsonFiles = files.filter(f => f.endsWith('.json')).sort().reverse();

      const runs: GateRunRecord[] = [];
      for (const file of jsonFiles.slice(0, limit)) {
        const content = await fs.readFile(path.join(this.runsDir, file), 'utf-8');
        runs.push(JSON.parse(content));
      }

      return runs;
    } catch {
      return [];
    }
  }

  /**
   * Get a specific run.
   */
  async get(runId: string): Promise<GateRunRecord | null> {
    try {
      const filePath = path.join(this.runsDir, `${runId}.json`);
      const content = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  /**
   * Get runs for a branch.
   */
  async getByBranch(branch: string, limit = 20): Promise<GateRunRecord[]> {
    const all = await this.getRecent(this.maxRuns);
    return all.filter(r => r.branch === branch).slice(0, limit);
  }

  /**
   * Cleanup old runs.
   */
  private async cleanup(): Promise<void> {
    try {
      const files = await fs.readdir(this.runsDir);
      const jsonFiles = files.filter(f => f.endsWith('.json')).sort();

      if (jsonFiles.length > this.maxRuns) {
        const toDelete = jsonFiles.slice(0, jsonFiles.length - this.maxRuns);
        for (const file of toDelete) {
          await fs.unlink(path.join(this.runsDir, file));
        }
      }
    } catch {
      // Ignore cleanup errors
    }
  }
}
