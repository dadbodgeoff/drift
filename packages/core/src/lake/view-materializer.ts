/**
 * View Materializer
 *
 * Rebuilds materialized views after scans or data changes.
 * Supports both full rebuilds and incremental updates.
 *
 * Key features:
 * - Automatic view generation after scan
 * - Incremental updates for changed files
 * - Dependency tracking between views
 * - Parallel view generation
 * - Manifest stats sync from actual data files
 */

import { EventEmitter } from 'node:events';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';


import { IndexStore } from './index-store.js';
import { ManifestStore } from './manifest-store.js';
import { DEFAULT_DATA_LAKE_CONFIG } from './types.js';
import { ViewStore } from './view-store.js';

import type {
  IncrementalUpdate,
  ViewType,
  DataLakeConfig,
  SensitiveTableSummary,
  ViolationSummary,
  TrendItem,
  CategoryTrend,
  SecuritySummaryView,
  TrendsView,
} from './types.js';
import type { DataAccessMap, BoundaryViolation } from '../boundaries/types.js';
import type { TrendSummary } from '../store/history-store.js';
import type { Pattern, PatternCategory } from '../store/types.js';

// ============================================================================
// Types
// ============================================================================

export interface MaterializeOptions {
  /** Force rebuild even if views are fresh */
  force?: boolean;
  /** Only rebuild specific views */
  views?: ViewType[];
  /** Incremental update info */
  incremental?: IncrementalUpdate;
}

export interface MaterializeResult {
  viewsRebuilt: ViewType[];
  indexesRebuilt: string[];
  duration: number;
  errors: string[];
}

// ============================================================================
// View Materializer Class
// ============================================================================

export class ViewMaterializer extends EventEmitter {
  private readonly config: DataLakeConfig;
  private readonly manifestStore: ManifestStore;
  private readonly viewStore: ViewStore;
  private readonly indexStore: IndexStore;

  constructor(
    config: Partial<DataLakeConfig> = {},
    manifestStore?: ManifestStore,
    viewStore?: ViewStore,
    indexStore?: IndexStore
  ) {
    super();
    this.config = { ...DEFAULT_DATA_LAKE_CONFIG, ...config };
    this.manifestStore = manifestStore ?? new ManifestStore(this.config);
    this.viewStore = viewStore ?? new ViewStore(this.config);
    this.indexStore = indexStore ?? new IndexStore(this.config);
  }

  // ==========================================================================
  // Initialization
  // ==========================================================================

  async initialize(): Promise<void> {
    await Promise.all([
      this.manifestStore.initialize(),
      this.viewStore.initialize(),
      this.indexStore.initialize(),
    ]);
  }

  // ==========================================================================
  // Full Materialization
  // ==========================================================================

  /**
   * Materialize all views from source data
   */
  async materialize(
    patterns: Pattern[],
    options: MaterializeOptions = {},
    additionalData?: {
      accessMap?: DataAccessMap;
      violations?: BoundaryViolation[];
      trendSummary?: TrendSummary;
      lastScan?: {
        timestamp: string;
        duration: number;
        filesScanned: number;
        patternsFound: number;
        errors: number;
      };
    }
  ): Promise<MaterializeResult> {
    const startTime = Date.now();
    const result: MaterializeResult = {
      viewsRebuilt: [],
      indexesRebuilt: [],
      duration: 0,
      errors: [],
    };

    const viewsToRebuild = options.views ?? this.getViewsToRebuild(options);

    // Rebuild indexes first (views depend on them)
    try {
      await this.rebuildIndexes(patterns, options.incremental);
      result.indexesRebuilt.push('byFile', 'byCategory');
    } catch (error) {
      result.errors.push(`Index rebuild failed: ${error}`);
    }

    // Rebuild views in parallel where possible
    const viewPromises: Promise<void>[] = [];

    if (viewsToRebuild.includes('status')) {
      viewPromises.push(
        this.rebuildStatusView(patterns, additionalData)
          .then(() => { result.viewsRebuilt.push('status'); })
          .catch(e => { result.errors.push(`Status view failed: ${e}`); })
      );
    }

    if (viewsToRebuild.includes('patternIndex')) {
      viewPromises.push(
        this.rebuildPatternIndexView(patterns)
          .then(() => { result.viewsRebuilt.push('patternIndex'); })
          .catch(e => { result.errors.push(`Pattern index view failed: ${e}`); })
      );
    }

    if (viewsToRebuild.includes('securitySummary') && additionalData?.accessMap) {
      viewPromises.push(
        this.rebuildSecuritySummaryView(additionalData.accessMap, additionalData.violations)
          .then(() => { result.viewsRebuilt.push('securitySummary'); })
          .catch(e => { result.errors.push(`Security summary view failed: ${e}`); })
      );
    }

    if (viewsToRebuild.includes('trends') && additionalData?.trendSummary) {
      viewPromises.push(
        this.rebuildTrendsView(additionalData.trendSummary)
          .then(() => { result.viewsRebuilt.push('trends'); })
          .catch(e => { result.errors.push(`Trends view failed: ${e}`); })
      );
    }

    await Promise.all(viewPromises);

    // Update manifest stats
    await this.updateManifestStats(patterns, additionalData);

    // Save manifest
    await this.manifestStore.save();

    result.duration = Date.now() - startTime;
    this.emit('materialized', result);
    return result;
  }

  // ==========================================================================
  // Individual View Rebuilds
  // ==========================================================================

  private async rebuildStatusView(
    patterns: Pattern[],
    additionalData?: {
      accessMap?: DataAccessMap;
      violations?: BoundaryViolation[];
      lastScan?: {
        timestamp: string;
        duration: number;
        filesScanned: number;
        patternsFound: number;
        errors: number;
      };
    }
  ): Promise<void> {
    const securityData = additionalData?.accessMap ? {
      violations: additionalData.violations?.length ?? 0,
      sensitiveExposures: additionalData.accessMap.sensitiveFields.length,
      riskLevel: this.calculateRiskLevel(additionalData.accessMap, additionalData.violations),
    } : undefined;

    const view = this.viewStore.buildStatusView(
      patterns,
      securityData,
      additionalData?.lastScan
    );

    await this.viewStore.saveStatusView(view);
    this.manifestStore.markViewFresh('status');
    this.emit('view:rebuilt', 'status');
  }

  private async rebuildPatternIndexView(patterns: Pattern[]): Promise<void> {
    const view = this.viewStore.buildPatternIndexView(patterns);
    await this.viewStore.savePatternIndexView(view);
    this.manifestStore.markViewFresh('patternIndex');
    this.emit('view:rebuilt', 'patternIndex');
  }

  private async rebuildSecuritySummaryView(
    accessMap: DataAccessMap,
    violations?: BoundaryViolation[]
  ): Promise<void> {
    const view = this.buildSecuritySummaryView(accessMap, violations);
    await this.viewStore.saveSecuritySummaryView(view);
    this.manifestStore.markViewFresh('securitySummary');
    this.emit('view:rebuilt', 'securitySummary');
  }

  private async rebuildTrendsView(trendSummary: TrendSummary): Promise<void> {
    const view = this.buildTrendsView(trendSummary);
    await this.viewStore.saveTrendsView(view);
    this.manifestStore.markViewFresh('trends');
    this.emit('view:rebuilt', 'trends');
  }

  // ==========================================================================
  // Index Rebuilds
  // ==========================================================================

  private async rebuildIndexes(
    patterns: Pattern[],
    incremental?: IncrementalUpdate
  ): Promise<void> {
    if (incremental) {
      // Incremental: only update affected files
      for (const file of incremental.changedFiles) {
        const filePatterns = patterns.filter(p =>
          p.locations.some(l => l.file === file) ||
          p.outliers.some(o => o.file === file)
        );
        const patternIds = filePatterns.map(p => p.id);
        await this.indexStore.updateFileIndex(file, patternIds);
      }
    } else {
      // Full rebuild
      await this.indexStore.rebuildAllIndexes(patterns);
    }

    this.emit('indexes:rebuilt');
  }

  // ==========================================================================
  // View Builders
  // ==========================================================================

  private buildSecuritySummaryView(
    accessMap: DataAccessMap,
    violations?: BoundaryViolation[]
  ): SecuritySummaryView {
    const now = new Date().toISOString();

    // Calculate sensitive tables
    const sensitiveTables: SensitiveTableSummary[] = [];
    for (const [tableName, tableInfo] of Object.entries(accessMap.tables)) {
      if (tableInfo.sensitiveFields.length > 0) {
        sensitiveTables.push({
          table: tableName,
          sensitiveFields: tableInfo.sensitiveFields.length,
          accessPoints: tableInfo.accessedBy.length,
          riskScore: this.calculateTableRiskScore(tableInfo),
        });
      }
    }

    // Sort by risk score
    sensitiveTables.sort((a, b) => b.riskScore - a.riskScore);

    // Top violations
    const topViolations: ViolationSummary[] = (violations ?? [])
      .slice(0, 10)
      .map(v => ({
        id: v.id,
        severity: v.severity as 'critical' | 'warning' | 'info',
        message: v.message,
        file: v.file,
        table: v.table,
      }));

    return {
      generatedAt: now,
      riskLevel: this.calculateRiskLevel(accessMap, violations),
      summary: {
        totalTables: Object.keys(accessMap.tables).length,
        sensitiveTablesCount: sensitiveTables.length,
        totalAccessPoints: Object.keys(accessMap.accessPoints).length,
        violationCount: violations?.length ?? 0,
      },
      topSensitiveTables: sensitiveTables.slice(0, 5),
      topViolations,
      recentChanges: [], // Would need history to populate
    };
  }

  private buildTrendsView(trendSummary: TrendSummary): TrendsView {
    const now = new Date().toISOString();

    const regressions: TrendItem[] = trendSummary.regressions.map(r => ({
      patternId: r.patternId,
      patternName: r.patternName,
      category: r.category,
      metric: r.metric,
      previousValue: r.previousValue,
      currentValue: r.currentValue,
      change: r.change,
      severity: r.severity,
    }));

    const improvements: TrendItem[] = trendSummary.improvements.map(i => ({
      patternId: i.patternId,
      patternName: i.patternName,
      category: i.category,
      metric: i.metric,
      previousValue: i.previousValue,
      currentValue: i.currentValue,
      change: i.change,
      severity: i.severity,
    }));

    const categoryTrends: Record<string, CategoryTrend> = {};
    for (const [category, trend] of Object.entries(trendSummary.categoryTrends)) {
      categoryTrends[category] = {
        trend: trend.trend,
        avgConfidenceChange: trend.avgConfidenceChange,
        complianceChange: trend.complianceChange,
      };
    }

    return {
      generatedAt: now,
      period: trendSummary.period,
      overallTrend: trendSummary.overallTrend,
      healthDelta: trendSummary.healthDelta,
      regressions,
      improvements,
      stableCount: trendSummary.stable,
      categoryTrends,
    };
  }

  // ==========================================================================
  // Manifest Updates
  // ==========================================================================

  private async updateManifestStats(
    patterns: Pattern[],
    additionalData?: {
      accessMap?: DataAccessMap;
      violations?: BoundaryViolation[];
      lastScan?: {
        timestamp: string;
        duration: number;
        filesScanned: number;
        patternsFound: number;
        errors: number;
      };
    }
  ): Promise<void> {
    // Pattern stats
    const byCategory: Record<PatternCategory, number> = {} as Record<PatternCategory, number>;
    const byStatus = { discovered: 0, approved: 0, ignored: 0 };
    const byConfidence = { high: 0, medium: 0, low: 0, uncertain: 0 };
    let totalLocations = 0;
    let totalOutliers = 0;

    for (const pattern of patterns) {
      byCategory[pattern.category] = (byCategory[pattern.category] ?? 0) + 1;
      byStatus[pattern.status]++;
      byConfidence[pattern.confidence.level]++;
      totalLocations += pattern.locations.length;
      totalOutliers += pattern.outliers.length;
    }

    this.manifestStore.updatePatternStats({
      total: patterns.length,
      byCategory,
      byStatus,
      byConfidence,
      totalLocations,
      totalOutliers,
    });

    // Security stats - sync from actual boundary data
    if (additionalData?.accessMap) {
      const accessMap = additionalData.accessMap;
      this.manifestStore.updateSecurityStats({
        totalTables: Object.keys(accessMap.tables).length,
        totalAccessPoints: Object.keys(accessMap.accessPoints).length,
        sensitiveFields: accessMap.sensitiveFields.length,
        violations: additionalData.violations?.length ?? 0,
        riskLevel: this.calculateRiskLevel(accessMap, additionalData.violations),
      });
    }

    // Sync call graph stats from index file if it exists
    await this.syncCallGraphStats();

    // Sync contract stats from contracts files if they exist
    await this.syncContractStats();

    // Last scan info
    if (additionalData?.lastScan) {
      this.manifestStore.updateLastScan(additionalData.lastScan);
    }
  }

  /**
   * Sync call graph stats from the call graph index file
   */
  private async syncCallGraphStats(): Promise<void> {
    try {
      const callGraphIndexPath = path.join(
        this.config.rootDir,
        '.drift',
        'lake',
        'callgraph',
        'index.json'
      );
      
      const content = await fs.readFile(callGraphIndexPath, 'utf-8');
      const index = JSON.parse(content) as {
        summary?: {
          totalFunctions?: number;
          totalCalls?: number;
          entryPoints?: number;
          dataAccessors?: number;
          avgDepth?: number;
        };
      };
      
      if (index.summary) {
        this.manifestStore.updateCallGraphStats({
          totalFunctions: index.summary.totalFunctions ?? 0,
          totalCalls: index.summary.totalCalls ?? 0,
          entryPoints: index.summary.entryPoints ?? 0,
          dataAccessors: index.summary.dataAccessors ?? 0,
          avgDepth: index.summary.avgDepth ?? 0,
        });
      }
    } catch {
      // Call graph index doesn't exist or is invalid, skip
    }
  }

  /**
   * Sync contract stats from the contracts files
   */
  private async syncContractStats(): Promise<void> {
    try {
      const contractsDir = path.join(this.config.rootDir, '.drift', 'contracts');
      
      let discovered = 0;
      let verified = 0;
      let mismatch = 0;
      let ignored = 0;

      // Count discovered contracts
      try {
        const discoveredPath = path.join(contractsDir, 'discovered', 'contracts.json');
        const content = await fs.readFile(discoveredPath, 'utf-8');
        const data = JSON.parse(content) as { contracts?: unknown[] };
        discovered = data.contracts?.length ?? 0;
      } catch {
        // No discovered contracts
      }

      // Count verified contracts
      try {
        const verifiedDir = path.join(contractsDir, 'verified');
        const files = await fs.readdir(verifiedDir);
        verified = files.filter(f => f.endsWith('.json')).length;
      } catch {
        // No verified contracts
      }

      // Count mismatch contracts
      try {
        const mismatchDir = path.join(contractsDir, 'mismatch');
        const files = await fs.readdir(mismatchDir);
        mismatch = files.filter(f => f.endsWith('.json')).length;
      } catch {
        // No mismatch contracts
      }

      // Count ignored contracts
      try {
        const ignoredDir = path.join(contractsDir, 'ignored');
        const files = await fs.readdir(ignoredDir);
        ignored = files.filter(f => f.endsWith('.json')).length;
      } catch {
        // No ignored contracts
      }

      this.manifestStore.updateContractStats({
        discovered,
        verified,
        mismatch,
        ignored,
      });
    } catch {
      // Contracts directory doesn't exist, skip
    }
  }

  // ==========================================================================
  // Helpers
  // ==========================================================================

  private getViewsToRebuild(options: MaterializeOptions): ViewType[] {
    if (options.force) {
      return ['status', 'patternIndex', 'securitySummary', 'trends', 'examples'];
    }

    const staleViews: ViewType[] = [];
    const viewKeys: (keyof ReturnType<typeof this.manifestStore.getViewFreshness>)[] = [
      'status', 'patternIndex', 'securitySummary', 'trends', 'examples'
    ];

    for (const view of viewKeys) {
      if (this.manifestStore.isViewStale(view)) {
        staleViews.push(view as ViewType);
      }
    }

    return staleViews;
  }

  private calculateRiskLevel(
    accessMap: DataAccessMap,
    violations?: BoundaryViolation[]
  ): 'low' | 'medium' | 'high' | 'critical' {
    const sensitiveCount = accessMap.sensitiveFields.length;
    const violationCount = violations?.length ?? 0;
    // BoundarySeverity uses 'error' for critical violations
    const criticalViolations = violations?.filter(v => v.severity === 'error').length ?? 0;

    if (criticalViolations > 0) {return 'critical';}
    if (violationCount > 5 || sensitiveCount > 20) {return 'high';}
    if (violationCount > 0 || sensitiveCount > 5) {return 'medium';}
    return 'low';
  }

  private calculateTableRiskScore(tableInfo: {
    sensitiveFields: unknown[];
    accessedBy: unknown[];
  }): number {
    // Simple risk score: more sensitive fields + more access points = higher risk
    return tableInfo.sensitiveFields.length * 10 + tableInfo.accessedBy.length;
  }
}

// ============================================================================
// Factory Function
// ============================================================================

export function createViewMaterializer(
  config: Partial<DataLakeConfig> = {},
  manifestStore?: ManifestStore,
  viewStore?: ViewStore,
  indexStore?: IndexStore
): ViewMaterializer {
  return new ViewMaterializer(config, manifestStore, viewStore, indexStore);
}
