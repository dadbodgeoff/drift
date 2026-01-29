/**
 * Audit Store
 *
 * Persistence layer for audit results, snapshots, and degradation tracking.
 *
 * Storage structure:
 * .drift/audit/
 * ├── latest.json           # Current audit state
 * ├── snapshots/            # Historical audits
 * │   └── YYYY-MM-DD.json
 * └── degradation.json      # Quality trends
 *
 * @module audit/audit-store
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import type {
  AuditResult,
  DegradationResult,
  DegradationTracking,
  DegradationAlert,
  AuditHistoryEntry,
  TrendDirection,
} from './types.js';

// =============================================================================
// Constants
// =============================================================================

const DRIFT_DIR = '.drift';
const AUDIT_DIR = 'audit';
const SNAPSHOTS_DIR = 'snapshots';
const LATEST_FILE = 'latest.json';
const DEGRADATION_FILE = 'degradation.json';

const DEFAULT_SNAPSHOT_RETENTION = 30; // days

// Thresholds for degradation alerts
const DEGRADATION_THRESHOLDS = {
  healthDrop: {
    warning: -5,
    critical: -15,
  },
  confidenceDrop: {
    warning: -0.05,
    critical: -0.15,
  },
};

// =============================================================================
// Audit Store Class
// =============================================================================

export interface AuditStoreConfig {
  rootDir: string;
  snapshotRetention?: number;
}

export class AuditStore {
  private readonly config: Required<AuditStoreConfig>;
  private readonly auditDir: string;
  private readonly snapshotsDir: string;

  constructor(config: AuditStoreConfig) {
    this.config = {
      rootDir: config.rootDir,
      snapshotRetention: config.snapshotRetention ?? DEFAULT_SNAPSHOT_RETENTION,
    };
    this.auditDir = path.join(this.config.rootDir, DRIFT_DIR, AUDIT_DIR);
    this.snapshotsDir = path.join(this.auditDir, SNAPSHOTS_DIR);
  }

  /**
   * Initialize the audit store directories
   */
  async initialize(): Promise<void> {
    await fs.mkdir(this.snapshotsDir, { recursive: true });
  }

  /**
   * Save an audit result
   */
  async saveAudit(result: AuditResult): Promise<void> {
    await this.initialize();

    // Save as latest
    const latestPath = path.join(this.auditDir, LATEST_FILE);
    await fs.writeFile(latestPath, JSON.stringify(result, null, 2));

    // Save as snapshot
    const date = result.generatedAt.split('T')[0]!;
    const snapshotPath = path.join(this.snapshotsDir, `${date}.json`);
    await fs.writeFile(snapshotPath, JSON.stringify(result, null, 2));

    // Update degradation tracking
    await this.updateDegradationTracking(result);

    // Cleanup old snapshots
    await this.cleanupSnapshots();
  }

  /**
   * Load the latest audit result
   */
  async loadLatest(): Promise<AuditResult | null> {
    const latestPath = path.join(this.auditDir, LATEST_FILE);
    
    try {
      const content = await fs.readFile(latestPath, 'utf-8');
      return JSON.parse(content) as AuditResult;
    } catch {
      return null;
    }
  }

  /**
   * Load audit from a specific date
   */
  async loadSnapshot(date: string): Promise<AuditResult | null> {
    const snapshotPath = path.join(this.snapshotsDir, `${date}.json`);
    
    try {
      const content = await fs.readFile(snapshotPath, 'utf-8');
      return JSON.parse(content) as AuditResult;
    } catch {
      return null;
    }
  }

  /**
   * List available snapshots
   */
  async listSnapshots(): Promise<string[]> {
    try {
      const files = await fs.readdir(this.snapshotsDir);
      return files
        .filter(f => f.endsWith('.json'))
        .map(f => f.replace('.json', ''))
        .sort()
        .reverse();
    } catch {
      return [];
    }
  }

  /**
   * Compare two audits and generate degradation result
   */
  compareAudits(current: AuditResult, previous: AuditResult): DegradationResult {
    const healthScoreDelta = current.summary.healthScore - previous.summary.healthScore;
    
    // Calculate average confidence for both
    const currentAvgConfidence = current.patterns.length > 0
      ? current.patterns.reduce((sum, p) => sum + p.confidence, 0) / current.patterns.length
      : 0;
    const previousAvgConfidence = previous.patterns.length > 0
      ? previous.patterns.reduce((sum, p) => sum + p.confidence, 0) / previous.patterns.length
      : 0;
    const confidenceDelta = currentAvgConfidence - previousAvgConfidence;

    const patternCountDelta = current.summary.totalPatterns - previous.summary.totalPatterns;

    // Find new and resolved issues
    const currentIssueIds = new Set(
      current.crossValidation.issues.map(i => `${i.type}:${i.patternId || ''}:${i.message}`)
    );
    const previousIssueIds = new Set(
      previous.crossValidation.issues.map(i => `${i.type}:${i.patternId || ''}:${i.message}`)
    );

    const newIssues = Array.from(currentIssueIds).filter(id => !previousIssueIds.has(id));
    const resolvedIssues = Array.from(previousIssueIds).filter(id => !currentIssueIds.has(id));

    // Determine trend
    let trend: TrendDirection;
    if (healthScoreDelta > 2) {
      trend = 'improving';
    } else if (healthScoreDelta < -2) {
      trend = 'declining';
    } else {
      trend = 'stable';
    }

    // Generate alerts
    const alerts: DegradationAlert[] = [];
    const now = new Date().toISOString();

    if (healthScoreDelta <= DEGRADATION_THRESHOLDS.healthDrop.critical) {
      alerts.push({
        type: 'health-drop',
        severity: 'critical',
        message: `Health score dropped ${Math.abs(healthScoreDelta)} points`,
        date: now,
        delta: healthScoreDelta,
      });
    } else if (healthScoreDelta <= DEGRADATION_THRESHOLDS.healthDrop.warning) {
      alerts.push({
        type: 'health-drop',
        severity: 'warning',
        message: `Health score dropped ${Math.abs(healthScoreDelta)} points`,
        date: now,
        delta: healthScoreDelta,
      });
    }

    if (confidenceDelta <= DEGRADATION_THRESHOLDS.confidenceDrop.critical) {
      alerts.push({
        type: 'confidence-drop',
        severity: 'critical',
        message: `Average confidence dropped ${Math.abs(confidenceDelta * 100).toFixed(1)}%`,
        date: now,
        delta: confidenceDelta,
      });
    } else if (confidenceDelta <= DEGRADATION_THRESHOLDS.confidenceDrop.warning) {
      alerts.push({
        type: 'confidence-drop',
        severity: 'warning',
        message: `Average confidence dropped ${Math.abs(confidenceDelta * 100).toFixed(1)}%`,
        date: now,
        delta: confidenceDelta,
      });
    }

    // Check for new false positives
    const newFalsePositives = current.summary.likelyFalsePositives - previous.summary.likelyFalsePositives;
    if (newFalsePositives > 5) {
      alerts.push({
        type: 'new-false-positives',
        severity: newFalsePositives > 10 ? 'critical' : 'warning',
        message: `${newFalsePositives} new likely false positives detected`,
        date: now,
        delta: newFalsePositives,
      });
    }

    // Check for duplicate increase
    const duplicateIncrease = current.summary.duplicateCandidates - previous.summary.duplicateCandidates;
    if (duplicateIncrease > 3) {
      alerts.push({
        type: 'duplicate-increase',
        severity: 'warning',
        message: `${duplicateIncrease} new duplicate groups detected`,
        date: now,
        delta: duplicateIncrease,
      });
    }

    return {
      previousAuditDate: previous.generatedAt,
      healthScoreDelta,
      confidenceDelta,
      patternCountDelta,
      newIssues,
      resolvedIssues,
      trend,
      alerts,
    };
  }

  /**
   * Get degradation tracking data
   */
  async getDegradationTracking(): Promise<DegradationTracking | null> {
    const degradationPath = path.join(this.auditDir, DEGRADATION_FILE);
    
    try {
      const content = await fs.readFile(degradationPath, 'utf-8');
      return JSON.parse(content) as DegradationTracking;
    } catch {
      return null;
    }
  }

  /**
   * Cleanup old snapshots beyond retention period
   */
  async cleanupSnapshots(keepCount?: number): Promise<void> {
    const retention = keepCount ?? this.config.snapshotRetention;
    
    try {
      const files = await fs.readdir(this.snapshotsDir);
      const jsonFiles = files.filter(f => f.endsWith('.json')).sort();

      // Remove oldest files if over limit
      const toRemove = jsonFiles.slice(0, Math.max(0, jsonFiles.length - retention));
      
      for (const file of toRemove) {
        await fs.unlink(path.join(this.snapshotsDir, file));
      }
    } catch {
      // Directory may not exist yet
    }
  }

  /**
   * Update degradation tracking with new audit
   */
  private async updateDegradationTracking(result: AuditResult): Promise<void> {
    const degradationPath = path.join(this.auditDir, DEGRADATION_FILE);
    
    // Load existing tracking or create new
    let tracking: DegradationTracking;
    try {
      const content = await fs.readFile(degradationPath, 'utf-8');
      tracking = JSON.parse(content) as DegradationTracking;
    } catch {
      tracking = {
        history: [],
        trends: {
          healthTrend: 'stable',
          confidenceTrend: 'stable',
          patternGrowth: 'healthy',
        },
        alerts: [],
      };
    }

    // Calculate average confidence
    const avgConfidence = result.patterns.length > 0
      ? result.patterns.reduce((sum, p) => sum + p.confidence, 0) / result.patterns.length
      : 0;

    // Add new history entry
    const entry: AuditHistoryEntry = {
      date: result.generatedAt.split('T')[0]!,
      healthScore: result.summary.healthScore,
      avgConfidence,
      totalPatterns: result.summary.totalPatterns,
      approvedCount: result.patterns.filter(p => p.recommendation === 'auto-approve').length,
      duplicateGroups: result.summary.duplicateCandidates,
      crossValidationScore: result.crossValidation.constraintAlignment,
    };

    // Remove duplicate date entries
    tracking.history = tracking.history.filter(h => h.date !== entry.date);
    tracking.history.push(entry);

    // Keep only last 90 days
    tracking.history = tracking.history
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-90);

    // Update trends based on history
    if (tracking.history.length >= 2) {
      const recent = tracking.history.slice(-7);
      const older = tracking.history.slice(-14, -7);

      if (recent.length > 0 && older.length > 0) {
        const recentAvgHealth = recent.reduce((s, h) => s + h.healthScore, 0) / recent.length;
        const olderAvgHealth = older.reduce((s, h) => s + h.healthScore, 0) / older.length;
        
        tracking.trends.healthTrend = 
          recentAvgHealth > olderAvgHealth + 2 ? 'improving' :
          recentAvgHealth < olderAvgHealth - 2 ? 'declining' : 'stable';

        const recentAvgConf = recent.reduce((s, h) => s + h.avgConfidence, 0) / recent.length;
        const olderAvgConf = older.reduce((s, h) => s + h.avgConfidence, 0) / older.length;
        
        tracking.trends.confidenceTrend = 
          recentAvgConf > olderAvgConf + 0.02 ? 'improving' :
          recentAvgConf < olderAvgConf - 0.02 ? 'declining' : 'stable';

        const patternGrowthRate = (entry.totalPatterns - tracking.history[0]!.totalPatterns) / 
          tracking.history.length;
        
        tracking.trends.patternGrowth = 
          patternGrowthRate > 5 ? 'rapid' :
          patternGrowthRate < 0.5 ? 'stagnant' : 'healthy';
      }
    }

    // Compare to previous audit for alerts
    if (tracking.history.length >= 2) {
      const previousEntry = tracking.history[tracking.history.length - 2]!;
      const healthDelta = entry.healthScore - previousEntry.healthScore;
      const confDelta = entry.avgConfidence - previousEntry.avgConfidence;

      // Clear old alerts and add new ones
      tracking.alerts = [];

      if (healthDelta <= DEGRADATION_THRESHOLDS.healthDrop.critical) {
        tracking.alerts.push({
          type: 'health-drop',
          severity: 'critical',
          message: `Health score dropped ${Math.abs(healthDelta)} points since ${previousEntry.date}`,
          date: entry.date,
          delta: healthDelta,
        });
      } else if (healthDelta <= DEGRADATION_THRESHOLDS.healthDrop.warning) {
        tracking.alerts.push({
          type: 'health-drop',
          severity: 'warning',
          message: `Health score dropped ${Math.abs(healthDelta)} points since ${previousEntry.date}`,
          date: entry.date,
          delta: healthDelta,
        });
      }

      if (confDelta <= DEGRADATION_THRESHOLDS.confidenceDrop.warning) {
        tracking.alerts.push({
          type: 'confidence-drop',
          severity: confDelta <= DEGRADATION_THRESHOLDS.confidenceDrop.critical ? 'critical' : 'warning',
          message: `Average confidence dropped ${Math.abs(confDelta * 100).toFixed(1)}%`,
          date: entry.date,
          delta: confDelta,
        });
      }
    }

    // Save updated tracking
    await fs.writeFile(degradationPath, JSON.stringify(tracking, null, 2));
  }
}
