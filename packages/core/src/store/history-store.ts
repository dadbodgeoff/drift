/**
 * History Store - Pattern snapshot and trend tracking
 *
 * Captures pattern state over time to detect regressions and improvements.
 * Stores daily snapshots in .drift/history/snapshots/
 *
 * @requirements 4.4 - Pattern history SHALL be tracked in .drift/history/
 */

import { EventEmitter } from 'node:events';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import type { Pattern, PatternCategory } from './types.js';

// ============================================================================
// Types
// ============================================================================

/**
 * A snapshot of a single pattern's state at a point in time
 */
export interface PatternSnapshot {
  patternId: string;
  patternName: string;
  category: PatternCategory;
  confidence: number;
  locationCount: number;
  outlierCount: number;
  complianceRate: number; // locations / (locations + outliers)
  status: 'discovered' | 'approved' | 'ignored';
}

/**
 * A full snapshot of all patterns at a point in time
 */
export interface HistorySnapshot {
  timestamp: string;
  date: string; // YYYY-MM-DD for grouping
  patterns: PatternSnapshot[];
  summary: {
    totalPatterns: number;
    avgConfidence: number;
    totalLocations: number;
    totalOutliers: number;
    overallComplianceRate: number;
    byCategory: Record<string, CategorySummary>;
  };
}

/**
 * Summary for a single category
 */
export interface CategorySummary {
  patternCount: number;
  avgConfidence: number;
  totalLocations: number;
  totalOutliers: number;
  complianceRate: number;
}

/**
 * A detected regression or improvement
 */
export interface PatternTrend {
  patternId: string;
  patternName: string;
  category: PatternCategory;
  type: 'regression' | 'improvement' | 'stable';
  metric: 'confidence' | 'compliance' | 'outliers';
  previousValue: number;
  currentValue: number;
  change: number; // Absolute change
  changePercent: number; // Percentage change
  severity: 'critical' | 'warning' | 'info';
  firstSeen: string; // When the trend started
  details: string;
}

/**
 * Aggregated trends for the dashboard
 */
export interface TrendSummary {
  period: '7d' | '30d' | '90d';
  startDate: string;
  endDate: string;
  regressions: PatternTrend[];
  improvements: PatternTrend[];
  stable: number;
  overallTrend: 'improving' | 'declining' | 'stable';
  healthDelta: number; // Change in overall health score
  categoryTrends: Record<string, {
    trend: 'improving' | 'declining' | 'stable';
    avgConfidenceChange: number;
    complianceChange: number;
  }>;
}

/**
 * Configuration for the history store
 */
export interface HistoryStoreConfig {
  rootDir: string;
  maxSnapshots: number; // Maximum snapshots to keep (default: 90 days)
  snapshotInterval: 'scan' | 'daily'; // When to create snapshots
}

const DEFAULT_CONFIG: HistoryStoreConfig = {
  rootDir: '.',
  maxSnapshots: 90,
  snapshotInterval: 'scan',
};

// ============================================================================
// Constants
// ============================================================================

const DRIFT_DIR = '.drift';
const HISTORY_DIR = 'history';
const SNAPSHOTS_DIR = 'snapshots';

// Thresholds for detecting significant changes
const REGRESSION_THRESHOLDS = {
  confidence: -0.05, // 5% drop in confidence
  compliance: -0.10, // 10% drop in compliance
  outliers: 3, // 3+ new outliers
};

const CRITICAL_THRESHOLDS = {
  confidence: -0.15, // 15% drop = critical
  compliance: -0.20, // 20% drop = critical
};

// ============================================================================
// Helper Functions
// ============================================================================

async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function getDateString(date: Date = new Date()): string {
  return date.toISOString().split('T')[0]!;
}

function calculateComplianceRate(locations: number, outliers: number): number {
  const total = locations + outliers;
  return total > 0 ? locations / total : 1;
}

// ============================================================================
// History Store Class
// ============================================================================

export class HistoryStore extends EventEmitter {
  private readonly config: HistoryStoreConfig;
  private readonly historyDir: string;
  private readonly snapshotsDir: string;

  constructor(config: Partial<HistoryStoreConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.historyDir = path.join(this.config.rootDir, DRIFT_DIR, HISTORY_DIR);
    this.snapshotsDir = path.join(this.historyDir, SNAPSHOTS_DIR);
  }

  /**
   * Initialize the history store
   */
  async initialize(): Promise<void> {
    await ensureDir(this.snapshotsDir);
  }

  /**
   * Create a snapshot from current patterns
   */
  async createSnapshot(patterns: Pattern[]): Promise<HistorySnapshot> {
    const now = new Date();
    const timestamp = now.toISOString();
    const date = getDateString(now);

    // Convert patterns to snapshots
    const patternSnapshots: PatternSnapshot[] = patterns.map(p => ({
      patternId: p.id,
      patternName: p.name,
      category: p.category,
      confidence: p.confidence.score,
      locationCount: p.locations.length,
      outlierCount: p.outliers.length,
      complianceRate: calculateComplianceRate(p.locations.length, p.outliers.length),
      status: p.status,
    }));

    // Calculate summary
    const summary = this.calculateSummary(patternSnapshots);

    const snapshot: HistorySnapshot = {
      timestamp,
      date,
      patterns: patternSnapshots,
      summary,
    };

    // Save snapshot
    await this.saveSnapshot(snapshot);

    // Cleanup old snapshots
    await this.cleanupOldSnapshots();

    this.emit('snapshot:created', snapshot);
    return snapshot;
  }

  /**
   * Get snapshots for a date range
   */
  async getSnapshots(startDate?: string, endDate?: string): Promise<HistorySnapshot[]> {
    const snapshots: HistorySnapshot[] = [];

    if (!(await fileExists(this.snapshotsDir))) {
      return snapshots;
    }

    const files = await fs.readdir(this.snapshotsDir);
    const jsonFiles = files.filter(f => f.endsWith('.json')).sort();

    for (const file of jsonFiles) {
      const date = file.replace('.json', '');
      
      // Filter by date range
      if (startDate && date < startDate) {continue;}
      if (endDate && date > endDate) {continue;}

      try {
        const content = await fs.readFile(path.join(this.snapshotsDir, file), 'utf-8');
        const snapshot = JSON.parse(content) as HistorySnapshot;
        snapshots.push(snapshot);
      } catch (error) {
        console.error(`Error reading snapshot ${file}:`, error);
      }
    }

    return snapshots;
  }

  /**
   * Get the most recent snapshot
   */
  async getLatestSnapshot(): Promise<HistorySnapshot | null> {
    const snapshots = await this.getSnapshots();
    return snapshots.length > 0 ? snapshots[snapshots.length - 1]! : null;
  }

  /**
   * Get snapshot from N days ago
   */
  async getSnapshotFromDaysAgo(days: number): Promise<HistorySnapshot | null> {
    const targetDate = new Date();
    targetDate.setDate(targetDate.getDate() - days);
    const dateStr = getDateString(targetDate);

    const filePath = path.join(this.snapshotsDir, `${dateStr}.json`);
    
    if (!(await fileExists(filePath))) {
      // Find closest snapshot before target date
      const snapshots = await this.getSnapshots(undefined, dateStr);
      return snapshots.length > 0 ? snapshots[snapshots.length - 1]! : null;
    }

    try {
      const content = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(content) as HistorySnapshot;
    } catch {
      return null;
    }
  }

  /**
   * Calculate trends between two snapshots
   */
  calculateTrends(
    current: HistorySnapshot,
    previous: HistorySnapshot
  ): PatternTrend[] {
    const trends: PatternTrend[] = [];
    const previousMap = new Map(previous.patterns.map(p => [p.patternId, p]));

    for (const currentPattern of current.patterns) {
      const prevPattern = previousMap.get(currentPattern.patternId);
      
      if (!prevPattern) {
        // New pattern, skip for now
        continue;
      }

      // Check confidence change
      const confidenceChange = currentPattern.confidence - prevPattern.confidence;
      if (Math.abs(confidenceChange) >= Math.abs(REGRESSION_THRESHOLDS.confidence)) {
        const isRegression = confidenceChange < 0;
        const isCritical = confidenceChange <= CRITICAL_THRESHOLDS.confidence;
        
        trends.push({
          patternId: currentPattern.patternId,
          patternName: currentPattern.patternName,
          category: currentPattern.category,
          type: isRegression ? 'regression' : 'improvement',
          metric: 'confidence',
          previousValue: prevPattern.confidence,
          currentValue: currentPattern.confidence,
          change: confidenceChange,
          changePercent: (confidenceChange / prevPattern.confidence) * 100,
          severity: isCritical ? 'critical' : isRegression ? 'warning' : 'info',
          firstSeen: previous.timestamp,
          details: `Confidence ${isRegression ? 'dropped' : 'improved'} from ${(prevPattern.confidence * 100).toFixed(0)}% to ${(currentPattern.confidence * 100).toFixed(0)}%`,
        });
      }

      // Check compliance change
      const complianceChange = currentPattern.complianceRate - prevPattern.complianceRate;
      if (Math.abs(complianceChange) >= Math.abs(REGRESSION_THRESHOLDS.compliance)) {
        const isRegression = complianceChange < 0;
        const isCritical = complianceChange <= CRITICAL_THRESHOLDS.compliance;
        
        trends.push({
          patternId: currentPattern.patternId,
          patternName: currentPattern.patternName,
          category: currentPattern.category,
          type: isRegression ? 'regression' : 'improvement',
          metric: 'compliance',
          previousValue: prevPattern.complianceRate,
          currentValue: currentPattern.complianceRate,
          change: complianceChange,
          changePercent: prevPattern.complianceRate > 0 
            ? (complianceChange / prevPattern.complianceRate) * 100 
            : 0,
          severity: isCritical ? 'critical' : isRegression ? 'warning' : 'info',
          firstSeen: previous.timestamp,
          details: `Compliance ${isRegression ? 'dropped' : 'improved'} from ${(prevPattern.complianceRate * 100).toFixed(0)}% to ${(currentPattern.complianceRate * 100).toFixed(0)}%`,
        });
      }

      // Check outlier increase
      const outlierChange = currentPattern.outlierCount - prevPattern.outlierCount;
      if (outlierChange >= REGRESSION_THRESHOLDS.outliers) {
        trends.push({
          patternId: currentPattern.patternId,
          patternName: currentPattern.patternName,
          category: currentPattern.category,
          type: 'regression',
          metric: 'outliers',
          previousValue: prevPattern.outlierCount,
          currentValue: currentPattern.outlierCount,
          change: outlierChange,
          changePercent: prevPattern.outlierCount > 0 
            ? (outlierChange / prevPattern.outlierCount) * 100 
            : 100,
          severity: outlierChange >= 10 ? 'critical' : 'warning',
          firstSeen: previous.timestamp,
          details: `${outlierChange} new outliers detected (${prevPattern.outlierCount} → ${currentPattern.outlierCount})`,
        });
      }
    }

    return trends;
  }

  /**
   * Get trend summary for a period
   */
  async getTrendSummary(period: '7d' | '30d' | '90d' = '7d'): Promise<TrendSummary | null> {
    const days = period === '7d' ? 7 : period === '30d' ? 30 : 90;
    
    const current = await this.getLatestSnapshot();
    const previous = await this.getSnapshotFromDaysAgo(days);

    if (!current || !previous) {
      return null;
    }

    const trends = this.calculateTrends(current, previous);
    const regressions = trends.filter(t => t.type === 'regression');
    const improvements = trends.filter(t => t.type === 'improvement');

    // Calculate category trends
    const categoryTrends: TrendSummary['categoryTrends'] = {};
    const categories = new Set([
      ...current.patterns.map(p => p.category),
      ...previous.patterns.map(p => p.category),
    ]);

    for (const category of categories) {
      const currentCat = current.summary.byCategory[category];
      const prevCat = previous.summary.byCategory[category];

      if (currentCat && prevCat) {
        const avgConfidenceChange = currentCat.avgConfidence - prevCat.avgConfidence;
        const complianceChange = currentCat.complianceRate - prevCat.complianceRate;

        categoryTrends[category] = {
          trend: avgConfidenceChange > 0.02 ? 'improving' 
               : avgConfidenceChange < -0.02 ? 'declining' 
               : 'stable',
          avgConfidenceChange,
          complianceChange,
        };
      }
    }

    // Calculate overall trend
    const healthDelta = current.summary.overallComplianceRate - previous.summary.overallComplianceRate;
    const overallTrend = healthDelta > 0.02 ? 'improving' 
                       : healthDelta < -0.02 ? 'declining' 
                       : 'stable';

    // Count stable patterns
    const changedPatternIds = new Set(trends.map(t => t.patternId));
    const stableCount = current.patterns.filter(p => !changedPatternIds.has(p.patternId)).length;

    return {
      period,
      startDate: previous.date,
      endDate: current.date,
      regressions,
      improvements,
      stable: stableCount,
      overallTrend,
      healthDelta,
      categoryTrends,
    };
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  private calculateSummary(patterns: PatternSnapshot[]): HistorySnapshot['summary'] {
    const byCategory: Record<string, CategorySummary> = {};

    let totalLocations = 0;
    let totalOutliers = 0;
    let totalConfidence = 0;

    for (const pattern of patterns) {
      totalLocations += pattern.locationCount;
      totalOutliers += pattern.outlierCount;
      totalConfidence += pattern.confidence;

      // Aggregate by category
      if (!byCategory[pattern.category]) {
        byCategory[pattern.category] = {
          patternCount: 0,
          avgConfidence: 0,
          totalLocations: 0,
          totalOutliers: 0,
          complianceRate: 0,
        };
      }

      const cat = byCategory[pattern.category]!;
      cat.patternCount++;
      cat.avgConfidence += pattern.confidence;
      cat.totalLocations += pattern.locationCount;
      cat.totalOutliers += pattern.outlierCount;
    }

    // Finalize category averages
    for (const cat of Object.values(byCategory)) {
      if (cat.patternCount > 0) {
        cat.avgConfidence /= cat.patternCount;
      }
      cat.complianceRate = calculateComplianceRate(cat.totalLocations, cat.totalOutliers);
    }

    return {
      totalPatterns: patterns.length,
      avgConfidence: patterns.length > 0 ? totalConfidence / patterns.length : 0,
      totalLocations,
      totalOutliers,
      overallComplianceRate: calculateComplianceRate(totalLocations, totalOutliers),
      byCategory,
    };
  }

  private async saveSnapshot(snapshot: HistorySnapshot): Promise<void> {
    const filePath = path.join(this.snapshotsDir, `${snapshot.date}.json`);
    await fs.writeFile(filePath, JSON.stringify(snapshot, null, 2));
  }

  private async cleanupOldSnapshots(): Promise<void> {
    if (!(await fileExists(this.snapshotsDir))) {
      return;
    }

    const files = await fs.readdir(this.snapshotsDir);
    const jsonFiles = files.filter(f => f.endsWith('.json')).sort();

    // Remove oldest files if over limit
    const toRemove = jsonFiles.slice(0, Math.max(0, jsonFiles.length - this.config.maxSnapshots));
    
    for (const file of toRemove) {
      await fs.unlink(path.join(this.snapshotsDir, file));
    }
  }
}
