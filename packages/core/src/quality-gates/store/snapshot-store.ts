/**
 * Snapshot Store
 * 
 * @license Apache-2.0
 * 
 * Stores health snapshots for regression detection.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import type { HealthSnapshot } from '../types.js';

/**
 * Stores health snapshots for regression detection.
 */
export class SnapshotStore {
  private snapshotsDir: string;
  private maxSnapshotsPerBranch: number;

  constructor(projectRoot: string, maxSnapshotsPerBranch = 50) {
    this.snapshotsDir = path.join(projectRoot, '.drift', 'quality-gates', 'snapshots');
    this.maxSnapshotsPerBranch = maxSnapshotsPerBranch;
  }

  /**
   * Save a health snapshot.
   */
  async save(snapshot: HealthSnapshot): Promise<void> {
    const branchDir = path.join(this.snapshotsDir, this.sanitizeBranch(snapshot.branch));
    await fs.mkdir(branchDir, { recursive: true });

    const filePath = path.join(branchDir, `${snapshot.id}.json`);
    await fs.writeFile(filePath, JSON.stringify(snapshot, null, 2));

    // Cleanup old snapshots
    await this.cleanup(snapshot.branch);
  }

  /**
   * Get the latest snapshot for a branch.
   */
  async getLatest(branch: string): Promise<HealthSnapshot | null> {
    try {
      const branchDir = path.join(this.snapshotsDir, this.sanitizeBranch(branch));
      const files = await fs.readdir(branchDir);
      const jsonFiles = files.filter(f => f.endsWith('.json')).sort().reverse();

      if (jsonFiles.length === 0) {return null;}

      const content = await fs.readFile(path.join(branchDir, jsonFiles[0]!), 'utf-8');
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  /**
   * Get snapshot by commit SHA.
   */
  async getByCommit(branch: string, commitSha: string): Promise<HealthSnapshot | null> {
    if (!commitSha) {return null;}
    
    try {
      const branchDir = path.join(this.snapshotsDir, this.sanitizeBranch(branch));
      const files = await fs.readdir(branchDir);

      for (const file of files) {
        if (!file.endsWith('.json')) {continue;}
        const content = await fs.readFile(path.join(branchDir, file), 'utf-8');
        const snapshot = JSON.parse(content) as HealthSnapshot;
        if (snapshot.commitSha === commitSha) {
          return snapshot;
        }
      }

      return null;
    } catch {
      return null;
    }
  }

  /**
   * Get snapshots for a branch.
   */
  async getByBranch(branch: string, limit = 10): Promise<HealthSnapshot[]> {
    try {
      const branchDir = path.join(this.snapshotsDir, this.sanitizeBranch(branch));
      const files = await fs.readdir(branchDir);
      const jsonFiles = files.filter(f => f.endsWith('.json')).sort().reverse();

      const snapshots: HealthSnapshot[] = [];
      for (const file of jsonFiles.slice(0, limit)) {
        const content = await fs.readFile(path.join(branchDir, file), 'utf-8');
        snapshots.push(JSON.parse(content));
      }

      return snapshots;
    } catch {
      return [];
    }
  }

  /**
   * Sanitize branch name for filesystem.
   */
  private sanitizeBranch(branch: string): string {
    return branch.replace(/[/\\:*?"<>|]/g, '-');
  }

  /**
   * Cleanup old snapshots.
   */
  private async cleanup(branch: string): Promise<void> {
    try {
      const branchDir = path.join(this.snapshotsDir, this.sanitizeBranch(branch));
      const files = await fs.readdir(branchDir);
      const jsonFiles = files.filter(f => f.endsWith('.json')).sort();

      if (jsonFiles.length > this.maxSnapshotsPerBranch) {
        const toDelete = jsonFiles.slice(0, jsonFiles.length - this.maxSnapshotsPerBranch);
        for (const file of toDelete) {
          await fs.unlink(path.join(branchDir, file));
        }
      }
    } catch {
      // Ignore cleanup errors
    }
  }
}
